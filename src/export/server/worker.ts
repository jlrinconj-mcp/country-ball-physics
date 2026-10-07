import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { isActiveExport, readExport, saveExport } from "./store";

type Worker = { child: ReturnType<typeof spawn>; finished: Promise<void> };
// Next can reload the route modules during a recording; retain the running process.
const globals = globalThis as typeof globalThis & { manualExportWorkers?: Map<string, Worker> };
const workers = globals.manualExportWorkers ??= new Map<string, Worker>();

function stopProcess(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  try {
    if (process.platform === "linux" && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
}

export async function stopExportWorker(id: string): Promise<void> {
  const worker = workers.get(id);
  if (!worker) return;
  stopProcess(worker.child, "SIGTERM");
  const hardKill = setTimeout(() => stopProcess(worker.child, "SIGKILL"), 3000);
  try { await worker.finished; } finally { clearTimeout(hardKill); }
}

export async function checkEncoder(): Promise<void> {
  for (const binary of ["ffmpeg", "ffprobe"]) {
    await new Promise<void>((accept, reject) => {
      // Literal executable names keep Next's output tracing scoped to the worker.
      const child = binary === "ffmpeg"
        ? spawn("ffmpeg", ["-version"], { stdio: "ignore" })
        : spawn("ffprobe", ["-version"], { stdio: "ignore" });
      child.once("error", () => reject(new Error(`Instala ${binary} para guardar los MP4 desde la aplicación.`)));
      child.once("close", code => code === 0 ? accept() : reject(new Error(`${binary} no está disponible.`)));
    });
  }
}

/** Separate Node worker keeps native canvas/encoding off the Next request thread. */
export async function runExportWorker(id: string): Promise<void> {
  try {
    const initial = await readExport(id);
    if (!isActiveExport(initial) || initial.workerPid || workers.has(id)) return;
    const child = spawn(process.execPath, ["--import", "tsx", resolve("scripts/manual-export-worker.ts"), id], {
      cwd: process.cwd(), stdio: ["ignore", "ignore", "pipe"], detached: process.platform === "linux",
    });
    let complete!: () => void;
    const finished = new Promise<void>(accept => { complete = accept; });
    workers.set(id, { child, finished });
    const result = new Promise<void>((accept, reject) => {
      let diagnostic = "";
      child.stderr?.on("data", chunk => { diagnostic = (diagnostic + chunk).slice(-3000); });
      child.once("error", reject);
      child.once("close", code => code === 0 ? accept() : reject(new Error(diagnostic || "Se interrumpió la grabación local.")));
    });
    try { await result; } finally {
      // Also close a leftover encoder if a worker failed before its own finally block.
      stopProcess(child, "SIGTERM");
      workers.delete(id);
      complete();
    }
  } catch (error) {
    try {
      const video = await readExport(id);
      if (!isActiveExport(video)) return;
      video.status = "failed";
      video.error ??= error instanceof Error ? error.message : String(error);
      delete video.workerPid;
      await saveExport(video);
    } catch {
      // Deletion can race startup or completion. Never recreate an erased job.
    }
  }
}
