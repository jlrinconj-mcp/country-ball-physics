import { mkdtemp, mkdir, readFile, rename, rm, symlink, link, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, deliver, enqueue, work } from "./runner";
import { fingerprint, Store } from "./store";
import { RETENTION_MS, UncertainPublication, validateSpec, type Job, type JobSpec, type Platform, type Publisher } from "./types";

const spec: JobSpec = { source: { mode: "race", countries: ["BRA", "FRA", "JPN"], track: "sprint" }, variants: [
  { id: "first", hook: "Pick your flag", caption: "Pick", destinations: ["tiktok", "instagram"] },
  { id: "second", hook: "Who wins?", caption: "Win", destinations: ["facebook"] },
] };
const success: Publisher = { advance: async context => ({ id: `${context.variant.spec.id}-${context.delivery.platform}`, url: "https://example.com/published" }) };
const publishers: Record<Platform, Publisher> = { tiktok: success, instagram: success, facebook: success };

let directory: string, store: Store, now: Date;
beforeEach(async () => {
  directory = await mkdtemp(resolve(tmpdir(), "bolworld-pipeline-test-"));
  now = new Date("2026-10-02T10:00:00Z");
  store = new Store(resolve(directory, "managed"), () => now);
  await store.init();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

async function media(store: Store, job: Job): Promise<void> {
  for (const variant of job.variants) {
    const artifact = await store.reserve(job, variant.file, "video");
    await writeFile(await store.owned(job, artifact), `generated-video-${variant.spec.id}`);
    await store.seal(job, artifact);
    variant.generatedAt = artifact.generatedAt;
    variant.validatedAt = now.toISOString();
    variant.duration = 12;
  }
  job.generationCompleteAt = now.toISOString();
  job.state = "delivering";
  await store.save(job);
}
async function prepared(): Promise<Job> { const job = await enqueue(store, spec); await media(store, job); return job; }

describe("safe retention and durable queue", () => {
  it("retains for a full 24 hours after the last confirmed upload, then deletes only its own files", async () => {
    const job = await prepared();
    const manual = store.path(job.id, "manual.mp4");
    const source = resolve(directory, "permanent-source.mp4");
    await writeFile(manual, "manual"); await writeFile(source, "permanent");
    now = new Date(now.getTime() + 4 * 60 * 60_000);
    await deliver(store, job, publishers);
    expect(job.deleteAfter).toBe(new Date(now.getTime() + RETENTION_MS).toISOString());
    now = new Date(now.getTime() + RETENTION_MS - 1);
    await cleanup(store, job);
    expect(await readFile(store.path(job.id, "first.mp4"), "utf8")).toContain("generated");
    now = new Date(now.getTime() + 1);
    // A fresh process restores durable state and can clean without the original worker.
    store = new Store(store.root, () => now); await store.init();
    const restored = (await store.jobs())[0]!;
    await cleanup(store, restored);
    expect(restored.state).toBe("deleted");
    await expect(readFile(store.path(job.id, "first.mp4"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(manual, "utf8")).toBe("manual");
    expect(await readFile(source, "utf8")).toBe("permanent");
    expect(await readFile(store.path(job.id, "job.json"), "utf8")).toContain('"deleted"');
    expect(await readFile(resolve(store.root, "logs", "2026-10-03.jsonl"), "utf8")).toContain("file_deleted");
  });

  it("never schedules cleanup while one destination failed", async () => {
    const job = await prepared();
    await deliver(store, job, { ...publishers, instagram: { advance: async () => { throw new Error("upload failed"); } } });
    expect(job.deleteAfter).toBeUndefined();
    now = new Date(now.getTime() + 10 * RETENTION_MS);
    job.deleteAfter = new Date(0).toISOString(); // A forged timer is insufficient.
    await cleanup(store, job);
    expect(await readFile(store.path(job.id, "first.mp4"), "utf8")).toContain("generated");
  });

  it("does not treat a received/processing response as confirmation", async () => {
    const job = await prepared();
    await deliver(store, job, { ...publishers, facebook: { advance: async () => null } });
    expect(job.variants[1]!.deliveries[0]!.state).toBe("confirming");
    now = new Date(now.getTime() + 2 * RETENTION_MS);
    await cleanup(store, job);
    expect(await readFile(store.path(job.id, "second.mp4"), "utf8")).toContain("generated");
  });

  it("recovers a failed upload without repeating successful destinations", async () => {
    const job = await prepared(), calls = vi.fn(success.advance);
    const flakey = vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementation(success.advance);
    const adapters = { tiktok: { advance: calls }, instagram: { advance: flakey }, facebook: success };
    await deliver(store, job, adapters);
    now = new Date(now.getTime() + 60_000);
    const restored = (await store.jobs())[0]!;
    await deliver(store, restored, adapters);
    expect(calls).toHaveBeenCalledTimes(1);
    expect(flakey).toHaveBeenCalledTimes(2);
    expect(restored.state).toBe("retained");
  });

  it("cleans confirmed files after 24 hours without depending on token renewal", async () => {
    const job = await prepared();
    const remote = vi.fn(success.advance);
    await deliver(store, job, { ...publishers, tiktok: { advance: remote } });
    remote.mockRejectedValue(new Error("expired token"));
    now = new Date(now.getTime() + RETENTION_MS);
    await cleanup(store, job);
    await expect(readFile(store.path(job.id, "first.mp4"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(remote).toHaveBeenCalledTimes(1);
  });

  it("preserves a generated file edited manually after upload", async () => {
    const job = await prepared(); await deliver(store, job, publishers);
    await writeFile(store.path(job.id, "first.mp4"), "manual edits");
    now = new Date(now.getTime() + RETENTION_MS); await cleanup(store, job);
    expect(await readFile(store.path(job.id, "first.mp4"), "utf8")).toBe("manual edits");
    expect(job.state).toBe("retained");
  });

  it("preserves a manual replacement even if it has identical bytes", async () => {
    const job = await prepared(); await deliver(store, job, publishers);
    const target = store.path(job.id, "first.mp4");
    const replacement = resolve(directory, "replacement.mp4");
    await writeFile(replacement, await readFile(target)); await rename(replacement, target);
    now = new Date(now.getTime() + RETENTION_MS); await cleanup(store, job);
    expect(await readFile(target, "utf8")).toContain("generated");
  });

  it("rejects symlinks, hardlinks and escaping paths", async () => {
    const job = await prepared();
    expect(() => store.path(job.id, "../../project.ts")).toThrow("escapes");
    const permanent = resolve(directory, "permanent.mp4"); await writeFile(permanent, "permanent");
    await rm(store.path(job.id, "first.mp4")); await symlink(permanent, store.path(job.id, "first.mp4"));
    await expect(store.owned(job, job.artifacts[0]!)).rejects.toThrow("Symlinks");
    await link(store.path(job.id, "second.mp4"), resolve(directory, "hardlink"));
    await expect(store.owned(job, job.artifacts[1]!)).rejects.toThrow("ownership");
    expect(await readFile(permanent, "utf8")).toBe("permanent");
  });

  it("refuses to adopt a nonempty directory or overwrite an untracked file", async () => {
    const bad = resolve(directory, "project"); await mkdir(bad); await writeFile(resolve(bad, "code.ts"), "source");
    await expect(new Store(bad).init()).rejects.toThrow("empty");
    await expect(readFile(resolve(bad, "owner.json"))).rejects.toMatchObject({ code: "ENOENT" });
    const job = await enqueue(store, spec); await writeFile(store.path(job.id, "first.mp4"), "manual");
    await expect(store.reserve(job, "first.mp4", "video")).rejects.toMatchObject({ code: "EEXIST" });
  });

  it("uses an exclusive worker lock", async () => {
    const release = await store.lock();
    await expect(store.lock()).rejects.toThrow("running");
    await release(); const releaseAgain = await store.lock(); await releaseAgain();
  });

  it("records an ambiguous publication and does not delete it", async () => {
    const job = await prepared();
    await deliver(store, job, { ...publishers, facebook: { advance: async () => { throw new UncertainPublication("lost response"); } } });
    expect(job.variants[1]!.deliveries[0]!.state).toBe("uncertain");
    expect(job.deleteAfter).toBeUndefined();
  });

  it("requires the confirmation to match the generated checksum", async () => {
    const job = await prepared(); await deliver(store, job, publishers);
    job.variants[0]!.deliveries[0]!.confirmedSha256 = "wrong";
    now = new Date(now.getTime() + RETENTION_MS); await cleanup(store, job);
    expect(await readFile(store.path(job.id, "first.mp4"), "utf8")).toContain("generated");
  });

  it("resumes generation after restart and logs generation failures without deleting", async () => {
    await enqueue(store, spec);
    await work(store, publishers, async () => { throw new Error("encoder failed"); });
    const restored = (await store.jobs())[0]!;
    expect(restored.state).toBe("generation_failed");
    restored.state = "queued"; await store.save(restored);
    await work(store, publishers, media);
    expect((await store.jobs())[0]!.state).toBe("retained");
  });

  it("recovers an interrupted deletion but never recursively removes the job directory", async () => {
    const job = await prepared(); await deliver(store, job, publishers);
    now = new Date(now.getTime() + RETENTION_MS);
    job.artifacts[0]!.deletionPendingAt = now.toISOString(); await store.save(job);
    await rm(store.path(job.id, "first.mp4"));
    await cleanup(store, job);
    expect(job.state).toBe("deleted");
    expect(await readFile(store.path(job.id, "job.json"), "utf8")).toContain("deletionPendingAt");
  });

  it("blocks new jobs at the queue limit instead of deleting failed jobs", async () => {
    vi.stubEnv("PIPELINE_MAX_ACTIVE_JOBS", "1"); await enqueue(store, spec);
    await expect(enqueue(store, spec)).rejects.toThrow("limit");
  });

  it("ignores corrupted manifests and leaves their files untouched", async () => {
    const job = await prepared();
    await writeFile(store.path(job.id, "job.json"), "{broken");
    expect(await store.jobs()).toEqual([]);
    expect((await fingerprint(store.path(job.id, "first.mp4"))).size).toBeGreaterThan(0);
  });

  it("honors publishAt without changing retention rules", async () => {
    const input = structuredClone(spec); input.variants[0]!.publishAt = new Date(now.getTime() + RETENTION_MS).toISOString();
    const job = await enqueue(store, input); await media(store, job); await deliver(store, job, publishers);
    expect(job.variants[0]!.deliveries[0]!.attempts).toBe(0);
    expect(job.deleteAfter).toBeUndefined();
  });
});

describe("input validation", () => {
  it.each([
    { ...spec, source: { ...spec.source, seed: "../../source" } },
    { ...spec, variants: [] },
    { ...spec, renderScale: NaN },
    { ...spec, variants: [{ ...spec.variants[0]!, playbackRate: 0 }, spec.variants[1]!] },
    { ...spec, variants: [{ ...spec.variants[0]!, destinations: [] }, spec.variants[1]!] },
    { ...spec, variants: [{ ...spec.variants[0]!, publishAt: "invalid" }, spec.variants[1]!] },
  ])("rejects unsafe/invalid specifications", input => { expect(() => validateSpec(input)).toThrow(); });
});
