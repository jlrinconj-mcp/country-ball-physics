import { randomUUID } from "node:crypto";
import { lstat, unlink } from "node:fs/promises";
import { artifactFor, generateMedia, InterruptedExecution } from "./media";
import { accountFor } from "./publishers";
import { errorMessage, fingerprint, Store } from "./store";
import { OWNER, RETENTION_MS, UncertainPublication, validateSpec, type Job, type Platform, type Publisher } from "./types";

type Publishers = Record<Platform, Publisher>;
const milliseconds = (value: string | undefined) => value ? Date.parse(value) : NaN;

export async function enqueue(store: Store, input: unknown): Promise<Job> {
  const spec = validateSpec(input);
  const active = (await store.jobs()).filter(job => job.state !== "deleted").length;
  const maximum = Number(process.env.PIPELINE_MAX_ACTIVE_JOBS ?? 10);
  if (!Number.isInteger(maximum) || maximum < 1 || active >= maximum) throw new Error("Pending job limit reached; finish uploads/cleanup before generating more");
  const id = randomUUID();
  spec.source.seed ??= `bolworld-${id}`;
  spec.source.maxDuration ??= 180;
  const job: Job = {
    owner: OWNER, version: 1, id, createdAt: store.clock().toISOString(), state: "queued", spec, artifacts: [],
    variants: spec.variants.map(variant => ({
      spec: variant, file: `${variant.id}.mp4`,
      deliveries: variant.destinations.map(platform => ({ platform, account: accountFor(platform), state: "pending", ticket: {}, attempts: 0 })),
    })),
  };
  await store.save(job);
  await store.log("job_queued", { jobId: id, seed: spec.source.seed, variants: spec.variants.map(v => ({ id: v.id, destinations: v.destinations, publishAt: v.publishAt })) });
  return job;
}

/** Do not trust a timer flag alone: every generated variant needs every receipt. */
export function retentionStart(job: Job): number | null {
  if (!job.generationCompleteAt || !job.variants.length || job.variants.length !== job.spec.variants.length) return null;
  let latest = 0;
  for (const variant of job.variants) {
    const artifact = artifactFor(job, variant);
    if (!variant.validatedAt || !artifact.sha256 || !artifact.generatedAt || variant.deliveries.length !== variant.spec.destinations.length) return null;
    for (const platform of variant.spec.destinations) {
      const delivery = variant.deliveries.find(d => d.platform === platform);
      const confirmed = milliseconds(delivery?.confirmedAt);
      if (!delivery || delivery.state !== "confirmed" || !delivery.remoteId || delivery.confirmedSha256 !== artifact.sha256 || !Number.isFinite(confirmed) || confirmed < milliseconds(artifact.generatedAt)) return null;
      latest = Math.max(latest, confirmed);
    }
  }
  if (job.artifacts.some(a => !a.sha256 || !a.generatedAt || !Number.isSafeInteger(a.size))) return null;
  return latest || null;
}

export async function deliver(store: Store, job: Job, publishers: Publishers): Promise<void> {
  for (const variant of job.variants) {
    if (variant.spec.publishAt && milliseconds(variant.spec.publishAt) > store.clock().getTime()) continue;
    const artifact = artifactFor(job, variant);
    for (const delivery of variant.deliveries) {
      if (delivery.state === "confirmed") continue;
      if (milliseconds(delivery.nextAttemptAt) > store.clock().getTime()) continue;
      try {
        if (delivery.account === "unconfigured" && !delivery.ticket.id) {
          const configured = accountFor(delivery.platform);
          if (configured !== "unconfigured") delivery.account = configured;
        }
        const file = await store.owned(job, artifact);
        const current = await fingerprint(file);
        if (current.sha256 !== artifact.sha256 || current.size !== artifact.size || !variant.validatedAt) throw new Error("Local variant changed or has not been validated");
        delivery.attempts++;
        delivery.state = "working";
        await store.save(job);
        await store.log("upload_attempt", { jobId: job.id, variant: variant.spec.id, platform: delivery.platform, account: delivery.account, attempt: delivery.attempts });
        const receipt = await publishers[delivery.platform].advance({ file, artifact, variant, delivery, checkpoint: () => store.save(job) });
        if (receipt) {
          const afterUpload = await fingerprint(await store.owned(job, artifact));
          if (afterUpload.sha256 !== artifact.sha256 || afterUpload.size !== artifact.size) throw new Error("Local video changed during upload; preserving it for review");
          if (!receipt.id) throw new Error("Remote confirmation has no identifier");
          delivery.state = "confirmed";
          delivery.confirmedAt = store.clock().toISOString();
          delivery.confirmedSha256 = artifact.sha256;
          delivery.remoteId = receipt.id;
          delivery.remoteUrl = receipt.url;
          delivery.error = undefined;
          delivery.nextAttemptAt = undefined;
          await store.save(job);
          await store.log("upload_confirmed", { jobId: job.id, variant: variant.spec.id, platform: delivery.platform, account: delivery.account, remoteId: receipt.id, remoteUrl: receipt.url, confirmedAt: delivery.confirmedAt });
        } else {
          delivery.state = "confirming";
          delivery.nextAttemptAt = new Date(store.clock().getTime() + 60_000).toISOString();
          await store.save(job);
          await store.log("upload_pending_confirmation", { jobId: job.id, variant: variant.spec.id, platform: delivery.platform, remoteId: delivery.ticket.id });
        }
      } catch (error) {
        delivery.state = error instanceof UncertainPublication ? "uncertain" : "failed";
        delivery.error = errorMessage(error);
        const delay = Math.min(6 * 60 * 60_000, 60_000 * 2 ** Math.min(9, Math.max(0, delivery.attempts - 1)));
        delivery.nextAttemptAt = new Date(store.clock().getTime() + delay).toISOString();
        await store.save(job);
        await store.log("upload_error", { jobId: job.id, variant: variant.spec.id, platform: delivery.platform, state: delivery.state, error: delivery.error, nextAttemptAt: delivery.nextAttemptAt });
      }
    }
  }
  const since = retentionStart(job);
  if (since !== null) {
    const next = new Date(since + RETENTION_MS).toISOString();
    if (job.deleteAfter !== next) {
      job.deleteAfter = next;
      job.state = "retained";
      await store.save(job);
      await store.log("deletion_scheduled", { jobId: job.id, deleteAfter: next, retentionHours: 24, files: job.artifacts.map(a => a.path) });
    }
  }
}

export async function cleanup(store: Store, job: Job, publishers: Publishers): Promise<void> {
  if (job.state === "deleted") return;
  const since = retentionStart(job);
  if (since === null || store.clock().getTime() < since + RETENTION_MS) return;
  // Recheck publication at deletion time. Expired tokens/offline APIs preserve the files.
  try {
    for (const variant of job.variants) for (const delivery of variant.deliveries) {
      const artifact = artifactFor(job, variant);
      const receipt = await publishers[delivery.platform].advance({ file: store.path(job.id, variant.file), artifact, variant, delivery, checkpoint: () => store.save(job) });
      if (!receipt || receipt.id !== delivery.remoteId) throw new Error("Remote publication could not be reconfirmed; cleanup postponed");
    }
  } catch (error) {
    await store.log("cleanup_postponed", { jobId: job.id, error: errorMessage(error) });
    return;
  }
  for (const artifact of job.artifacts) {
    if (artifact.deletedAt) continue;
    try {
      const path = await store.owned(job, artifact);
      const current = await fingerprint(path);
      if (current.sha256 !== artifact.sha256 || current.size !== artifact.size) throw new Error(`Generated file was modified; preserving ${artifact.path}`);
      artifact.deletionPendingAt = store.clock().toISOString();
      await store.save(job);
      // Repeat the inode/regular-file checks immediately before unlinking.
      await store.owned(job, artifact);
      await unlink(path);
      artifact.deletedAt = store.clock().toISOString();
      await store.save(job);
      await store.log("file_deleted", { jobId: job.id, file: artifact.path, deletedAt: artifact.deletedAt, bytes: artifact.size });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && artifact.deletionPendingAt) {
        // Recover a crash between our unlink and the persisted deletion receipt.
        try { await lstat(store.path(job.id, artifact.path)); }
        catch (missing) {
          if ((missing as NodeJS.ErrnoException).code === "ENOENT") {
            artifact.deletedAt = artifact.deletionPendingAt;
            await store.save(job);
            await store.log("file_deleted_recovered", { jobId: job.id, file: artifact.path, deletedAt: artifact.deletedAt });
            continue;
          }
        }
      }
      await store.log("cleanup_error", { jobId: job.id, file: artifact.path, error: errorMessage(error) });
    }
  }
  if (job.artifacts.every(a => a.deletedAt)) {
    job.state = "deleted";
    await store.save(job);
    await store.log("job_cleaned", { jobId: job.id });
  }
}

export async function work(store: Store, publishers: Publishers, media = generateMedia, onlyCleanup = false): Promise<void> {
  const jobs = await store.jobs();
  // Always free eligible space before starting the next render.
  for (const job of jobs) await cleanup(store, job, publishers);
  if (onlyCleanup) return;
  for (const job of jobs) {
    if (job.state === "deleted" || job.state === "retained") continue;
    if (!job.generationCompleteAt) {
      if (job.state === "generation_failed") continue; // explicit retry avoids a tight, expensive failure loop
      try { await media(store, job); }
      catch (error) {
        job.state = "generation_failed";
        job.error = errorMessage(error);
        await store.save(job);
        await store.log("generation_error", { jobId: job.id, error: job.error });
        if (error instanceof InterruptedExecution) throw error;
        continue;
      }
    }
    await deliver(store, job, publishers);
  }
}
