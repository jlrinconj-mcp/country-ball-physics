import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { artifactFor } from "./media";
import { SocialPublisher } from "./publishers";
import { deliver, enqueue } from "./runner";
import { Store } from "./store";
import { apiFixture, TEST_ENV } from "./testing/api-fixture";
import type { Job, JobSpec } from "./types";

let directory: string, store: Store, job: Job, now: Date, fixture: Awaited<ReturnType<typeof apiFixture>>;
const spec: JobSpec = { source: { mode: "race" }, variants: [
  { id: "test-first", hook: "Pick", caption: "Who wins?", destinations: ["tiktok", "instagram", "facebook"] },
  { id: "test-second", hook: "Win", caption: "Who wins?", destinations: ["instagram"], publishAt: "2099-01-01T00:00:00Z" },
] };
beforeEach(async () => {
  directory = await mkdtemp(resolve(tmpdir(), "bolworld-api-test-"));
  now = new Date("2026-10-02T10:00:00Z");
  store = new Store(resolve(directory, "managed"), () => now); await store.init();
  vi.spyOn(console, "log").mockImplementation(() => {});
  for (const [key, value] of Object.entries(TEST_ENV)) vi.stubEnv(key, value);
  fixture = await apiFixture(); job = await enqueue(store, spec);
  for (const variant of job.variants) {
    const artifact = await store.reserve(job, variant.file, "video");
    await writeFile(await store.owned(job, artifact), Buffer.alloc(128, variant.spec.id));
    await store.seal(job, artifact); variant.duration = 15; variant.validatedAt = now.toISOString();
  }
  job.generationCompleteAt = now.toISOString(); await store.save(job);
});
afterEach(async () => { await fixture.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

it("uploads actual bytes to all three APIs, polls confirmation and does not repeat initialization", async () => {
  await deliver(store, job, fixture.publishers);
  for (const delivery of job.variants[0]!.deliveries) expect(delivery.state).toBe("confirming");
  for (const platform of ["tiktok", "instagram", "facebook"] as const) {
    const uploaded = createHash("sha256").update(fixture.files[platform]!).digest("hex");
    expect(uploaded).toBe(artifactFor(job, job.variants[0]!).sha256);
  }
  expect(job.deleteAfter).toBeUndefined();
  fixture.control.confirmed = true; now = new Date(now.getTime() + 60_000);
  await deliver(store, job, fixture.publishers);
  for (const delivery of job.variants[0]!.deliveries) expect(delivery.state).toBe("confirmed");
  expect(fixture.calls.filter(p => p.includes("/video/init/")).length).toBe(1);
  expect(fixture.calls.filter(p => p.endsWith("/ig-account/media")).length).toBe(1);
});

it("keeps an ambiguous Instagram publication pending instead of posting twice", async () => {
  const variant = job.variants[0]!, delivery = variant.deliveries.find(d => d.platform === "instagram")!;
  fixture.control.confirmed = true; fixture.control.loseInstagramPublishResponse = true;
  const context = { file: store.path(job.id, variant.file), artifact: artifactFor(job, variant), variant, delivery, checkpoint: () => store.save(job) };
  await expect(fixture.publishers.instagram.advance(context)).rejects.toThrow();
  expect(delivery.ticket.phase).toBe("publishing");
  await expect(fixture.publishers.instagram.advance(context)).rejects.toThrow("response was lost");
  expect(fixture.calls.filter(p => p.endsWith("/media_publish")).length).toBe(1);
});

it("retries a definite creation rejection after fixing credentials", async () => {
  const variant = job.variants[0]!, delivery = variant.deliveries.find(d => d.platform === "instagram")!;
  const context = { file: store.path(job.id, variant.file), artifact: artifactFor(job, variant), variant, delivery, checkpoint: () => store.save(job) };
  fixture.control.rejectCreateOnce = true;
  await expect(fixture.publishers.instagram.advance(context)).rejects.toThrow("190");
  expect(delivery.ticket.phase).toBe("");
  await expect(fixture.publishers.instagram.advance(context)).resolves.toBeNull();
  expect(delivery.ticket.id).toBe("ig-container");
});

it("detects missing configuration before writing an ambiguous publication stage", async () => {
  const variant = job.variants[0]!, delivery = variant.deliveries.find(d => d.platform === "instagram")!;
  const context = { file: store.path(job.id, variant.file), artifact: artifactFor(job, variant), variant, delivery, checkpoint: () => store.save(job) };
  const missing = new SocialPublisher("instagram", { INSTAGRAM_ACCOUNT_ID: TEST_ENV.INSTAGRAM_ACCOUNT_ID });
  await expect(missing.advance(context)).rejects.toThrow("INSTAGRAM_ACCESS_TOKEN");
  expect(delivery.ticket.phase).toBeUndefined();
});

it("refuses tokens bound to a different destination", async () => {
  const variant = job.variants[0]!, delivery = variant.deliveries.find(d => d.platform === "tiktok")!;
  const context = { file: store.path(job.id, variant.file), artifact: artifactFor(job, variant), variant, delivery, checkpoint: () => store.save(job) };
  await expect(new SocialPublisher("tiktok", { ...TEST_ENV, TIKTOK_OPEN_ID: "other" }).advance(context)).rejects.toThrow("Account changed");
});

it("retries an interrupted Meta transfer using the same container", async () => {
  const variant = job.variants[0]!, delivery = variant.deliveries.find(d => d.platform === "instagram")!;
  const context = { file: store.path(job.id, variant.file), artifact: artifactFor(job, variant), variant, delivery, checkpoint: () => store.save(job) };
  fixture.control.rejectInstagramUploadOnce = true;
  await expect(fixture.publishers.instagram.advance(context)).rejects.toThrow("503");
  fixture.control.confirmed = true;
  await expect(fixture.publishers.instagram.advance(context)).resolves.toMatchObject({ id: "ig-post" });
  expect(fixture.calls.filter(p => p.endsWith("/ig-account/media")).length).toBe(1);
  expect(fixture.calls.filter(p => p.includes("/ig-api-upload/")).length).toBe(2);
});

it("recovers a lost acknowledgement midway through a multi-chunk TikTok upload", async () => {
  const variant = job.variants[0]!, delivery = variant.deliveries.find(d => d.platform === "tiktok")!;
  const artifact = artifactFor(job, variant);
  const bytes = Buffer.alloc(21 * 1024 ** 2, "video");
  await writeFile(store.path(job.id, variant.file), bytes); await store.seal(job, artifact);
  const context = { file: store.path(job.id, variant.file), artifact, variant, delivery, checkpoint: () => store.save(job) };
  fixture.control.loseTikTokChunkResponseOnce = true;
  await expect(fixture.publishers.tiktok.advance(context)).rejects.toThrow();
  expect(delivery.ticket.nextChunk).toBe("0");
  await expect(fixture.publishers.tiktok.advance(context)).resolves.toBeNull();
  expect(fixture.files.tiktok!.equals(bytes)).toBe(true);
  expect(fixture.calls.filter(p => p.includes("/video/init/")).length).toBe(1);
  expect(fixture.calls.filter(p => p.includes("upload.us.tiktokapis.com/video")).length).toBe(2);
});

it("redacts tokens from logs and does not expose signed upload tickets in receipts", async () => {
  await deliver(store, job, fixture.publishers);
  const logs = await readFile(resolve(store.root, "logs", "2026-10-02.jsonl"), "utf8");
  expect(logs).not.toContain(TEST_ENV.INSTAGRAM_ACCESS_TOKEN);
  expect(logs).not.toContain(TEST_ENV.TIKTOK_ACCESS_TOKEN);
  expect(logs).not.toContain("rupload.facebook.com");
});
