import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "@/engine/defaults";
import { makeTestCountries } from "@/engine/testing";
import { DEFAULT_DISPLAY } from "@/render/displayOptions";
import { createExport, deleteExport, exportDirectory, listExports, readExport, saveExport, setExportPaused } from "./store";

const countries = makeTestCountries(4);
const request = { config: { ...DEFAULT_CONFIG, seed: "saved-config", countries: countries.slice(0, 2).map(c => c.cca3) }, display: DEFAULT_DISPLAY };
let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "bolworld-store-")); });
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

describe("persistent manual exports", () => {
  it("prevents duplicate concurrent Play requests and persists only server-selected countries", async () => {
    const results = await Promise.allSettled([createExport(request, countries, root), createExport(request, countries, root)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    const saved = await listExports(root);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.request).toEqual(request);
    const records = JSON.parse(await readFile(join(exportDirectory(saved[0]!.id, root), "countries.json"), "utf8"));
    expect(records.map((c: { cca3: string }) => c.cca3)).toEqual(request.config.countries);
    await expect(createExport(request, countries, root)).rejects.toThrow(/en curso/);
    const video = saved[0]!;
    video.status = "complete";
    await saveExport(video, root);
    expect(await readExport(video.id, root)).toEqual(video);
    expect((await createExport(request, countries, root)).id).not.toBe(video.id);
  });

  it("recovers an interrupted recording and allows repeating the seed", async () => {
    const video = await createExport(request, countries, root);
    video.status = "recording";
    video.workerPid = 2_000_000_000;
    await saveExport(video, root);
    const interrupted = await readExport(video.id, root);
    expect(interrupted.status).toBe("failed");
    expect(interrupted.error).toContain("misma semilla");
    expect((await createExport(request, countries, root)).request.config.seed).toBe(video.request.config.seed);
    expect(() => exportDirectory("../../outside", root)).toThrow(/inválido/);
  });

  it("preserves the completed manifest when the worker exits during a status read", async () => {
    const video = await createExport(request, countries, root);
    video.status = "recording";
    video.workerPid = 2_000_000_000;
    await saveExport(video, root);
    const completed = { ...video, status: "complete" as const, frames: 300, fingerprint: "final-result" };
    delete completed.workerPid;
    const path = join(exportDirectory(video.id, root), "job.json");
    vi.spyOn(process, "kill").mockImplementationOnce(() => {
      writeFileSync(path, JSON.stringify(completed));
      throw Object.assign(new Error("Worker exited"), { code: "ESRCH" });
    });
    expect(await readExport(video.id, root)).toEqual(completed);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(completed);
  });

  it("keeps pause controls across worker progress, blocks another recording, and releases after completion", async () => {
    const worker = await createExport(request, countries, root);
    expect((await setExportPaused(worker.id, true, root)).status).toBe("paused");
    worker.workerPid = process.pid;
    worker.status = "recording";
    worker.frames = 30;
    await saveExport(worker, root);
    expect((await readExport(worker.id, root)).status).toBe("paused");
    await expect(createExport(request, countries, root)).rejects.toThrow(/en curso/);
    expect((await setExportPaused(worker.id, false, root)).status).toBe("recording");
    worker.status = "complete";
    delete worker.workerPid;
    await saveExport(worker, root);
    expect((await createExport(request, countries, root)).id).not.toBe(worker.id);
  });

  it("hides a cancelled job before stopping its worker and never recreates its deleted folder", async () => {
    const worker = await createExport(request, countries, root);
    let stopped!: () => void;
    const stopGate = new Promise<void>(resolve => { stopped = resolve; });
    let stopping!: () => void;
    const stopStarted = new Promise<void>(resolve => { stopping = resolve; });
    const removing = deleteExport(worker.id, async () => { stopping(); await stopGate; }, root);
    await stopStarted;
    expect(await listExports(root)).toEqual([]);
    await expect(saveExport(worker, root)).rejects.toThrow(/eliminada/);
    const lateResume = setExportPaused(worker.id, false, root);
    void lateResume.catch(() => {});
    stopped();
    await removing;
    await expect(lateResume).rejects.toThrow();
    await expect(saveExport(worker, root)).rejects.toThrow();
    await expect(stat(exportDirectory(worker.id, root))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await createExport(request, countries, root)).id).not.toBe(worker.id);
  });
});
