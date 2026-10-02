import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { appendFile, lstat, mkdir, open, readFile, readdir, realpath, rename, statfs } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { OWNER, validateSpec, type Artifact, type Job } from "./types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

/** Refuse symlinks at every existing ancestor, including the configured root. */
export async function assertPlainPath(path: string): Promise<void> {
  let current = resolve(path);
  for (;;) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error("Symlinks are forbidden in managed storage"); }
    catch (error) { if (!absent(error)) throw error; }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

export async function fingerprint(path: string): Promise<{ size: number; sha256: string }> {
  const digest = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path)) { digest.update(chunk); size += chunk.length; }
  return { size, sha256: digest.digest("hex") };
}

export class Store {
  readonly root: string;
  constructor(root: string, readonly clock = () => new Date()) { this.root = resolve(root); }

  async init(): Promise<void> {
    await assertPlainPath(this.root);
    await mkdir(dirname(this.root), { recursive: true, mode: 0o700 });
    try { await mkdir(this.root, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const marker = resolve(this.root, "owner.json");
    const initialEntries = await readdir(this.root);
    if (!initialEntries.includes("owner.json") && initialEntries.length) throw new Error("Managed storage must start as an empty directory");
    try {
      const handle = await open(marker, "wx", 0o600);
      try {
        const entries = await readdir(this.root);
        if (entries.some(name => name !== "owner.json")) throw new Error("Managed storage must start as an empty directory");
        await handle.writeFile(JSON.stringify({ owner: OWNER, root: this.root }));
        await handle.sync();
      } finally { await handle.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    await this.guard();
    await mkdir(resolve(this.root, "jobs"), { recursive: true, mode: 0o700 });
    await mkdir(resolve(this.root, "logs"), { recursive: true, mode: 0o700 });
  }

  async guard(): Promise<void> {
    await assertPlainPath(this.root);
    await assertPlainPath(resolve(this.root, "owner.json"));
    const marker = JSON.parse(await readFile(resolve(this.root, "owner.json"), "utf8"));
    if (marker.owner !== OWNER || marker.root !== this.root || await realpath(this.root) !== this.root) throw new Error("Invalid storage ownership marker");
    await assertPlainPath(resolve(this.root, "jobs"));
    await assertPlainPath(resolve(this.root, "logs"));
  }

  path(id: string, path = ""): string {
    if (!uuid.test(id)) throw new Error("Invalid job ID");
    const base = resolve(this.root, "jobs", id);
    const target = resolve(base, path);
    const inside = relative(base, target);
    if (isAbsolute(path) || inside === ".." || inside.startsWith(`..${sep}`)) throw new Error("Path escapes job directory");
    return target;
  }

  async save(job: Job): Promise<void> {
    await this.guard();
    const path = this.path(job.id, "job.json");
    await assertPlainPath(path);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = this.path(job.id, `job-${randomUUID()}.tmp`);
    const handle = await open(tmp, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(job, null, 2) + "\n"); await handle.sync(); }
    finally { await handle.close(); }
    await rename(tmp, path);
    // Persist the rename as well as the JSON, so a reboot cannot lose a confirmation.
    if (process.platform === "linux") {
      const dir = await open(dirname(path), "r");
      try { await dir.sync(); } finally { await dir.close(); }
    }
  }

  async jobs(): Promise<Job[]> {
    await this.guard();
    const jobs: Job[] = [];
    for (const entry of await readdir(resolve(this.root, "jobs"), { withFileTypes: true })) {
      if (!uuid.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
      try {
        const path = this.path(entry.name, "job.json");
        await assertPlainPath(path);
        const job = JSON.parse(await readFile(path, "utf8")) as Job;
        if (job.owner !== OWNER || job.version !== 1 || job.id !== entry.name || !Array.isArray(job.artifacts) || !Array.isArray(job.variants)) throw new Error("Invalid job manifest");
        validateSpec(job.spec);
        if (job.variants.length !== job.spec.variants.length || job.variants.some((variant, index) => JSON.stringify(variant.spec) !== JSON.stringify(job.spec.variants[index]) || !Array.isArray(variant.deliveries) || variant.file !== `${variant.spec.id}.mp4`)) throw new Error("Corrupt variant manifest");
        if (new Set(job.artifacts.map(a => a.path)).size !== job.artifacts.length) throw new Error("Duplicate ownership records");
        for (const artifact of job.artifacts) {
          this.path(job.id, artifact.path);
          if (!Number.isSafeInteger(artifact.dev) || !Number.isSafeInteger(artifact.ino) || !Number.isFinite(artifact.birthtimeMs) || !["video", "scratch", "overlay"].includes(artifact.kind)) throw new Error("Invalid file ownership record");
        }
        jobs.push(job);
      } catch (error) { await this.log("manifest_error", { jobId: entry.name, error: errorMessage(error) }); }
    }
    return jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async reserve(job: Job, path: string, kind: Artifact["kind"]): Promise<Artifact> {
    const existing = job.artifacts.find(a => a.path === path);
    if (existing) {
      const file = await this.owned(job, existing);
      if (existing.sha256 && (await fingerprint(file)).sha256 !== existing.sha256) throw new Error(`Generated file was modified: ${path}`);
      return existing;
    }
    const target = this.path(job.id, path);
    await this.guard();
    await assertPlainPath(target);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const handle = await open(target, "wx", 0o600);
    const info = await handle.stat();
    await handle.close();
    const artifact: Artifact = { path, kind, dev: info.dev, ino: info.ino, birthtimeMs: info.birthtimeMs };
    job.artifacts.push(artifact);
    await this.save(job);
    return artifact;
  }

  async owned(job: Job, artifact: Artifact): Promise<string> {
    await this.guard();
    const path = this.path(job.id, artifact.path);
    await assertPlainPath(path);
    const info = await lstat(path);
    if (!info.isFile() || info.nlink !== 1 || info.dev !== artifact.dev || info.ino !== artifact.ino || info.birthtimeMs !== artifact.birthtimeMs) throw new Error(`File ownership changed: ${artifact.path}`);
    return path;
  }

  async seal(job: Job, artifact: Artifact): Promise<void> {
    Object.assign(artifact, await fingerprint(await this.owned(job, artifact)));
    artifact.generatedAt = this.clock().toISOString();
    await this.save(job);
    await this.log("file_generated", { jobId: job.id, file: artifact.path, generatedAt: artifact.generatedAt, bytes: artifact.size, sha256: artifact.sha256 });
  }

  async log(event: string, fields: Record<string, unknown> = {}): Promise<void> {
    await this.guard();
    const now = this.clock().toISOString();
    const file = resolve(this.root, "logs", `${now.slice(0, 10)}.jsonl`);
    await assertPlainPath(file);
    const record = JSON.stringify({ at: now, event, ...fields });
    await appendFile(file, record + "\n", { mode: 0o600 });
    console.log(record);
  }

  async capacity(): Promise<void> {
    const info = await statfs(this.root);
    const free = info.bavail * info.bsize;
    const minimum = Number(process.env.PIPELINE_MIN_FREE_BYTES ?? 2 * 1024 ** 3);
    if (!Number.isFinite(minimum) || minimum < 0) throw new Error("Invalid PIPELINE_MIN_FREE_BYTES");
    if (free < minimum) throw new Error("Insufficient disk space; generation paused, pending files preserved");
  }

  /** Linux flock acts on the inherited open-file description, held by this process.
   * The kernel releases it after a crash; there is no stale-lock deletion race. */
  async lock(): Promise<() => Promise<void>> {
    await this.guard();
    const path = resolve(this.root, "worker.lock");
    await assertPlainPath(path);
    const handle = await open(path, "a+", 0o600);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1) throw new Error("Invalid worker lock file");
      await new Promise<void>((resolve, reject) => {
        const child = spawn("flock", ["--exclusive", "--nonblock", "3"], { stdio: ["ignore", "ignore", "pipe", handle.fd] });
        child.once("error", reject);
        child.once("close", code => code === 0 ? resolve() : reject(new Error("Another pipeline command is running")));
      });
      return () => handle.close();
    } catch (error) { await handle.close(); throw error; }
  }
}

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Signed upload URLs and any token values must never appear in logs.
  let safe = message.replace(/https?:\/\/\S+/g, "[url]");
  for (const [key, value] of Object.entries(process.env)) if (/TOKEN|SECRET|PASSWORD/.test(key) && value) safe = safe.replaceAll(value, "[redacted]");
  return safe.slice(0, 1000);
}
