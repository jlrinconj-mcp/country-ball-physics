import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";

/** Preserve the encoder diagnostic when its input fails before its close event. */
export async function writeEncoderFrame(child: ChildProcess, frame: Buffer, closed: Promise<void>): Promise<void> {
  const input = child.stdin;
  try {
    if (!input || input.destroyed) throw new Error("Se cerró el codificador de video.");
    if (!input.write(frame)) await Promise.race([
      once(input, "drain"),
      closed.then(() => { throw new Error("Se cerró el codificador de video."); }),
    ]);
  } catch (error) {
    const hardKill = setTimeout(() => child.kill("SIGKILL"), 3000);
    try {
      await closed;
    } finally {
      clearTimeout(hardKill);
    }
    throw error;
  }
}

/** Wait for encoder exit and always reap it after cancellation or timeout. */
export function watchEncoder(child: ChildProcess, signal?: AbortSignal, timeoutMs = 30 * 60_000, isPaused: () => boolean = () => false): Promise<void> {
  return new Promise((resolve, reject) => {
    let diagnostic = "", timedOut = false;
    let activeMs = 0;
    const intervalMs = Math.min(1000, Math.max(10, timeoutMs));
    let hardKill: NodeJS.Timeout | undefined;
    const stop = () => {
      child.kill("SIGTERM");
      hardKill ??= setTimeout(() => child.kill("SIGKILL"), 3000);
    };
    const timeout = setInterval(() => {
      if (isPaused()) return;
      activeMs += intervalMs;
      if (!timedOut && activeMs >= timeoutMs) { timedOut = true; stop(); }
    }, intervalMs);
    const finish = () => { clearInterval(timeout); clearTimeout(hardKill); signal?.removeEventListener("abort", stop); };
    child.stderr?.on("data", chunk => { diagnostic = (diagnostic + chunk).slice(-3000); });
    child.once("error", error => { finish(); reject(error); });
    child.once("close", code => {
      finish();
      if (signal?.aborted) reject(signal.reason ?? new Error("Grabación eliminada."));
      else if (timedOut) reject(new Error("El codificador de video superó el tiempo permitido."));
      else if (code !== 0) reject(new Error(diagnostic || "Falló el codificador de video."));
      else resolve();
    });
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
  });
}

export async function exportCommand(binary: "ffmpeg" | "ffprobe", args: string[], signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", chunk => { output = (output + chunk).slice(-128_000); });
  await watchEncoder(child, signal);
  return output;
}

export async function validateExportVideo(file: string, signal?: AbortSignal): Promise<number> {
  const output = JSON.parse(await exportCommand("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", file], signal));
  const video = output.streams.find((stream: { codec_type: string }) => stream.codec_type === "video");
  const audio = output.streams.find((stream: { codec_type: string }) => stream.codec_type === "audio");
  const duration = Number(output.format.duration);
  if (!video || video.codec_name !== "h264" || video.pix_fmt !== "yuv420p" || !audio || audio.codec_name !== "aac" || !Number.isFinite(duration) || duration <= 0 || video.width % 2 || video.height % 2) throw new Error("El MP4 no tiene video H.264 y audio AAC válidos.");
  const [numerator, denominator] = video.avg_frame_rate.split("/").map(Number);
  if (numerator / denominator !== 30) throw new Error("El video debe mantener 30 cuadros por segundo.");
  await exportCommand("ffmpeg", ["-v", "error", "-xerror", "-i", file, "-map", "0:v", "-map", "0:a", "-f", "null", "-"], signal);
  return duration;
}
