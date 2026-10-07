import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Country } from "@/countries/countryTypes";
import type { ExportRequest, VideoExport } from "../types";

export const EXPORT_ROOT = join(process.cwd(), "output", "manual");
export const isExportId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
let creating = false;
const controls = new Map<string, Promise<unknown>>();
export const isActiveExport = (video: VideoExport) => video.status === "queued" || video.status === "recording" || video.status === "paused";

export class ExportCancelledError extends Error {
  constructor() { super("La grabación fue eliminada."); }
}

export interface ExportControl { paused: boolean; cancelled: boolean }

async function withControlLock<T>(id: string, root: string, operation: () => Promise<T>): Promise<T> {
  const key = exportDirectory(id, root);
  const pending = (controls.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
  controls.set(key, pending);
  try { return await pending; } finally { if (controls.get(key) === pending) controls.delete(key); }
}

export function exportDirectory(id: string, root = EXPORT_ROOT): string {
  if (!isExportId(id)) throw new Error("Identificador de exportación inválido.");
  return join(root, id);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** UI controls have their own file: a worker progress update cannot overwrite them. */
export async function readExportControl(id: string, root = EXPORT_ROOT): Promise<ExportControl> {
  const directory = exportDirectory(id, root);
  try {
    return JSON.parse(await readFile(join(directory, "control.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // Exports created before controls were introduced remain readable.
    await stat(directory);
    return { paused: false, cancelled: false };
  }
}

export async function saveExport(video: VideoExport, root = EXPORT_ROOT): Promise<void> {
  const control = await readExportControl(video.id, root);
  if (control.cancelled) throw new ExportCancelledError();
  if (isActiveExport(video)) video.status = control.paused ? "paused" : video.status === "paused" ? "recording" : video.status;
  await writeJson(join(exportDirectory(video.id, root), "job.json"), video);
}

function workerAlive(video: VideoExport): boolean {
  if (!video.workerPid) return Date.now() - Date.parse(video.createdAt) < 30_000;
  try { process.kill(video.workerPid, 0); return true; } catch { return false; }
}

export async function readExport(id: string, root = EXPORT_ROOT): Promise<VideoExport> {
  const path = join(exportDirectory(id, root), "job.json");
  let video: VideoExport = JSON.parse(await readFile(path, "utf8"));
  const control = await readExportControl(id, root);
  if (control.cancelled) throw new ExportCancelledError();
  if (isActiveExport(video)) {
    let alive = workerAlive(video);
    if (!alive) {
      // The worker may have saved its final manifest and exited after our first read.
      // Readers never write recovery status: that could overwrite its final parts.
      video = JSON.parse(await readFile(path, "utf8"));
      if (!isActiveExport(video)) return video;
      alive = workerAlive(video);
    }
    if (!alive) {
      video.status = "failed";
      video.error = "La grabación se interrumpió. Pulsa Grabar video con la misma semilla para repetirla.";
    } else {
      video.status = control.paused ? "paused" : video.status === "paused" ? (video.workerPid ? "recording" : "queued") : video.status;
    }
  }
  return video;
}

export async function setExportPaused(id: string, paused: boolean, root = EXPORT_ROOT): Promise<VideoExport> {
  return withControlLock(id, root, async () => {
    const video = await readExport(id, root);
    if (!isActiveExport(video)) return video;
    const control = await readExportControl(id, root);
    if (control.cancelled) throw new ExportCancelledError();
    await writeJson(join(exportDirectory(id, root), "control.json"), { ...control, paused });
    return readExport(id, root);
  });
}

/** Hide the job immediately, then stop its worker before removing any output files. */
export async function deleteExport(id: string, stop: (id: string) => Promise<void>, root = EXPORT_ROOT): Promise<void> {
  return withControlLock(id, root, async () => {
    await readExport(id, root);
    await writeJson(join(exportDirectory(id, root), "control.json"), { paused: false, cancelled: true });
    await stop(id);
    await rm(exportDirectory(id, root), { recursive: true, force: true });
  });
}

export async function listExports(root = EXPORT_ROOT): Promise<VideoExport[]> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const names = (await readdir(root)).filter(isExportId);
  const results = await Promise.allSettled(names.map(id => readExport(id, root)));
  return results.flatMap(result => result.status === "fulfilled" ? [result.value] : [])
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createExport(request: ExportRequest, countries: Country[], root = EXPORT_ROOT): Promise<VideoExport> {
  if (creating) throw new Error("Ya hay una grabación en curso. Espera a que termine.");
  creating = true;
  try {
    const previous = await listExports(root);
    if (previous.some(isActiveExport)) {
      throw new Error("Ya hay una grabación en curso. Espera a que termine.");
    }
    const video: VideoExport = {
      id: randomUUID(), createdAt: new Date().toISOString(), status: "queued", request,
      frames: 0, parts: [], metadata: null, results: [], tournament: null, fingerprint: null, error: null,
    };
    await mkdir(exportDirectory(video.id, root), { recursive: false, mode: 0o700 });
    await writeJson(join(exportDirectory(video.id, root), "control.json"), { paused: false, cancelled: false });
    // Only the server's normalized records, never client-supplied flags or URLs.
    const selected = new Set(request.config.countries);
    await writeFile(join(exportDirectory(video.id, root), "countries.json"), JSON.stringify(countries.filter(c => selected.has(c.cca3))), { mode: 0o600, flag: "wx" });
    await saveExport(video, root);
    return video;
  } finally {
    creating = false;
  }
}
