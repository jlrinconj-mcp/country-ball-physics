import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { artifactFor, command, generateMedia } from "./media";
import { cleanup, deliver, enqueue } from "./runner";
import { Store } from "./store";
import { apiFixture, TEST_ENV } from "./testing/api-fixture";
import { RETENTION_MS, type JobSpec } from "./types";

it.runIf(process.env.PIPELINE_E2E === "1")("real simulation → three MP4 variants → validation → HTTP uploads → confirmation → 24h retention → safe cleanup", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "bolworld-real-e2e-"));
  let now = new Date("2026-10-02T10:00:00Z");
  const store = new Store(resolve(directory, "managed"), () => now);
  await store.init();
  await mkdir(resolve("output"), { recursive: true });
  const fixture = await apiFixture();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    for (const [key, value] of Object.entries(TEST_ENV)) vi.stubEnv(key, value);
    const spec = JSON.parse(await readFile(resolve("publications/pipeline.example.json"), "utf8")) as JobSpec;
    spec.source.seed = "global-launch-02";
    spec.renderScale = Number(process.env.PIPELINE_E2E_SCALE ?? "0.25");
    const job = await enqueue(store, spec);
    await generateMedia(store, job);
    expect(job.variants).toHaveLength(3);
    expect(job.variants[0]!.duration).toBeGreaterThan(job.variants[1]!.duration!);
    await command("ffmpeg", ["-y", "-v", "error", "-ss", "1", "-i", store.path(job.id, job.variants[0]!.file), "-vf", "scale=360:-1", "-frames:v", "1", resolve(`output/pipeline-e2e-preview-${spec.renderScale}.png`)], 60_000);
    const metadata = JSON.parse(await readFile(store.path(job.id, "raw/global-launch-02/metadata.json"), "utf8"));
    expect(metadata.result.decidedBy).toBe("physics");
    const manual = store.path(job.id, "manual.mp4"); await writeFile(manual, "do not delete");
    await deliver(store, job, fixture.publishers);
    expect(job.deleteAfter).toBeUndefined();
    for (const variant of job.variants) {
      const platform = variant.spec.destinations[0]!;
      expect(createHash("sha256").update(fixture.files[platform]!).digest("hex")).toBe(artifactFor(job, variant).sha256);
    }
    // No confirmation, no deletion, even after two days.
    now = new Date(now.getTime() + 2 * RETENTION_MS);
    await cleanup(store, job, fixture.publishers);
    expect((await readFile(store.path(job.id, job.variants[0]!.file))).length).toBeGreaterThan(0);
    fixture.control.confirmed = true;
    const restored = (await store.jobs())[0]!;
    await deliver(store, restored, fixture.publishers);
    expect(restored.state).toBe("retained");
    now = new Date(now.getTime() + RETENTION_MS - 1);
    await cleanup(store, restored, fixture.publishers);
    expect((await readFile(store.path(job.id, job.variants[0]!.file))).length).toBeGreaterThan(0);
    now = new Date(now.getTime() + 1);
    await cleanup(store, restored, fixture.publishers);
    expect(restored.state).toBe("deleted");
    expect(await readFile(manual, "utf8")).toBe("do not delete");
    for (const artifact of restored.artifacts) await expect(readFile(store.path(job.id, artifact.path))).rejects.toMatchObject({ code: "ENOENT" });
    const report = { passedAt: new Date().toISOString(), remote: "local HTTP fixture; no real social accounts used", scale: spec.renderScale, variants: restored.variants.map(v => ({ id: v.spec.id, duration: v.duration, sha256: artifactFor(restored, v).sha256, deliveryState: v.deliveries[0]!.state })), retentionHours: 24, generatedArtifactsDeleted: restored.artifacts.length, manualFilePreserved: true };
    await writeFile(resolve(`output/pipeline-e2e-report-${spec.renderScale}.json`), JSON.stringify(report, null, 2) + "\n");
  } finally { log.mockRestore(); vi.unstubAllEnvs(); await fixture.close(); await rm(directory, { recursive: true, force: true }); }
}, 15 * 60_000);
