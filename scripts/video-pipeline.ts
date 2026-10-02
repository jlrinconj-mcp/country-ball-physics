import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { command, PROJECT_ROOT } from "./pipeline/media";
import { accountFor, publishers } from "./pipeline/publishers";
import { enqueue, work } from "./pipeline/runner";
import { errorMessage, Store } from "./pipeline/store";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { spec: { type: "string" }, job: { type: "string" } } });
const action = positionals[0] ?? "status";
const root = resolve(process.env.PIPELINE_ROOT || resolve(PROJECT_ROOT, "output/pipeline"));
await mkdir(resolve(PROJECT_ROOT, "output"), { recursive: true });
const store = new Store(root);
try {
  if (process.platform !== "linux") throw new Error("This worker uses Linux process locking; run it on Linux");
  await store.init();
  const unlock = await store.lock();
  try {
    if (action === "enqueue") {
      if (!values.spec) throw new Error("Use enqueue --spec=publications/pipeline.example.json");
      await enqueue(store, JSON.parse(await readFile(resolve(values.spec), "utf8")));
    } else if (action === "work" || action === "cleanup") {
      await work(store, publishers(), undefined, action === "cleanup");
    } else if (action === "retry") {
      const job = (await store.jobs()).find(job => job.id === values.job);
      if (!job) throw new Error("Use retry --job=<existing-job-id>");
      if (job.state === "generation_failed") { job.state = "queued"; job.error = undefined; }
      for (const variant of job.variants) for (const delivery of variant.deliveries) delivery.nextAttemptAt = undefined;
      await store.save(job);
      await store.log("retry_requested", { jobId: job.id });
    } else if (action === "status") {
      console.log(JSON.stringify((await store.jobs()).map(job => ({ id: job.id, state: job.state, createdAt: job.createdAt, deleteAfter: job.deleteAfter, error: job.error, variants: job.variants.map(v => ({ id: v.spec.id, file: store.path(job.id, v.file), generatedAt: v.generatedAt, deliveries: v.deliveries.map(d => ({ platform: d.platform, account: d.account, state: d.state, attempts: d.attempts, nextAttemptAt: d.nextAttemptAt, error: d.error, remoteId: d.remoteId, remoteUrl: d.remoteUrl, confirmedAt: d.confirmedAt })) })) })), null, 2));
    } else if (action === "doctor") {
      await command("ffmpeg", ["-version"], 10_000);
      await command("ffprobe", ["-version"], 10_000);
      await command("flock", ["--version"], 10_000);
      await store.capacity();
      const keys = ["META_GRAPH_VERSION", "INSTAGRAM_ACCESS_TOKEN", "FACEBOOK_PAGE_ACCESS_TOKEN", "TIKTOK_ACCESS_TOKEN", "TIKTOK_PRIVACY_LEVEL"];
      const missing = keys.filter(key => !process.env[key]);
      for (const platform of ["tiktok", "instagram", "facebook"] as const) if (accountFor(platform) === "unconfigured") missing.push(`${platform}: account ID`);
      console.log(JSON.stringify({ node: process.version, storage: root, ffmpeg: "available", ffprobe: "available", missing, readyToPublish: missing.length === 0, note: "Configuration check only; account permissions still require an actual API check" }, null, 2));
      if (missing.length) process.exitCode = 2;
    } else throw new Error("Commands: enqueue, work, cleanup, status, retry, doctor");
  } finally { await unlock(); }
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
