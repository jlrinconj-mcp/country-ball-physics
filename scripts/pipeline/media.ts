import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { FORMATS } from "../../src/render/formats";
import type { Artifact, Job, Variant } from "./types";
import { Store } from "./store";

export const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export class InterruptedExecution extends Error {}

/** No shell interpolation, bounded diagnostics and a timeout on every subprocess. */
export async function command(binary: string, args: string[], timeoutMs = 60 * 60 * 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd: PROJECT_ROOT, stdio: ["ignore", "pipe", "pipe"], detached: process.platform === "linux" });
    let stdout = "", stderr = "", timedOut = false, interrupted = false;
    child.stdout.on("data", chunk => { stdout = (stdout + chunk).slice(-128_000); });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-6000); });
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (process.platform === "linux" && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    };
    const timer = setTimeout(() => { timedOut = true; kill("SIGTERM"); }, timeoutMs);
    let hardKill: NodeJS.Timeout | undefined;
    timer.unref();
    // Give an encoder a short opportunity to close; do not leave an orphan indefinitely.
    const hardTimer = setTimeout(() => { hardKill = setTimeout(() => kill("SIGKILL"), 5000); }, timeoutMs);
    hardTimer.unref();
    const onInterrupt = () => { interrupted = true; kill("SIGTERM"); hardKill = setTimeout(() => kill("SIGKILL"), 5000); };
    process.once("SIGINT", onInterrupt);
    process.once("SIGTERM", onInterrupt);
    const finish = () => {
      clearTimeout(timer); clearTimeout(hardTimer); clearTimeout(hardKill);
      process.removeListener("SIGINT", onInterrupt); process.removeListener("SIGTERM", onInterrupt);
    };
    child.once("error", error => { finish(); reject(error); });
    child.once("close", code => {
      finish();
      if (interrupted) reject(new InterruptedExecution("Video pipeline interrupted; pending files preserved"));
      else if (timedOut || code !== 0) reject(new Error(`${binary} ${timedOut ? "timed out" : `exited ${code}`}: ${stderr}`));
      else resolve(stdout);
    });
  });
}

export async function validateVideo(file: string, expected?: { width: number; height: number }): Promise<number> {
  const output = JSON.parse(await command("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", file], 60_000));
  const video = output.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  const audio = output.streams.find((s: { codec_type: string }) => s.codec_type === "audio");
  const duration = Number(output.format.duration);
  if (!video || video.codec_name !== "h264" || video.pix_fmt !== "yuv420p" || !audio || audio.codec_name !== "aac" || !Number.isFinite(duration) || duration <= 0 || video.width % 2 || video.height % 2) throw new Error("Invalid MP4: require H.264/yuv420p, AAC, even dimensions and positive duration");
  if (expected && (video.width !== expected.width || video.height !== expected.height)) throw new Error("Unexpected video dimensions");
  if (Number(video.avg_frame_rate.split("/")[0]) / Number(video.avg_frame_rate.split("/")[1]) !== 30) throw new Error("Expected constant 30 fps");
  await command("ffmpeg", ["-v", "error", "-xerror", "-i", file, "-map", "0:v", "-map", "0:a", "-f", "null", "-"], 10 * 60_000);
  return duration;
}

function dimensions(job: Job, variant: Variant) {
  const format = FORMATS[variant.spec.format ?? "9:16"];
  const scale = job.spec.renderScale ?? 1;
  return { width: Math.max(2, Math.round(format.width * scale / 2) * 2), height: Math.max(2, Math.round(format.height * scale / 2) * 2) };
}

async function makeOverlay(file: string, width: number, height: number, text: string): Promise<void> {
  const canvas = createCanvas(width, height), ctx = canvas.getContext("2d");
  const family = ["Arial", "DejaVu Sans", "Liberation Sans", "Noto Sans"].find(name => GlobalFonts.has(name)) ?? "sans-serif";
  const size = Math.max(12, Math.round(width * 0.041));
  ctx.font = `700 ${size}px "${family}"`;
  const words = text.trim().split(/\s+/), lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && ctx.measureText(`${line} ${word}`).width > width * 0.7) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  const top = height * 0.16;
  ctx.fillStyle = "rgba(7,10,18,0.88)";
  ctx.fillRect(width * 0.07, top, width * 0.75, size * (lines.length * 1.3 + 1));
  ctx.textAlign = "center";
  ctx.fillStyle = "#f5f7ff";
  for (const [index, value] of lines.entries()) ctx.fillText(value, width * 0.445, top + size * (1.2 + index * 1.3));
  ctx.textAlign = "left";
  ctx.font = `700 ${size * 0.8}px "${family}"`;
  ctx.fillStyle = "#36e2c2";
  ctx.fillText("bolworld", width * 0.08, height * 0.74);
  await writeFile(file, canvas.toBuffer("image/png"));
}

export async function generateMedia(store: Store, job: Job): Promise<void> {
  await store.capacity();
  job.state = "generating";
  await store.save(job);
  const seed = job.spec.source.seed!;
  const raw = `raw/${seed}`;
  const source = await store.reserve(job, `${raw}/video.mp4`, "video");
  const silent = await store.reserve(job, `${raw}/video.silent.mp4`, "scratch");
  const wav = await store.reserve(job, `${raw}/audio.wav`, "scratch");
  if (!source.generatedAt) {
    const requestFile = store.path(job.id, "request.json");
    await writeFile(requestFile, JSON.stringify({ ...job.spec.source, format: "9:16" }), { mode: 0o600, flag: "wx" }).catch(async error => {
      if (error.code !== "EEXIST" || await readFile(requestFile, "utf8") !== JSON.stringify({ ...job.spec.source, format: "9:16" })) throw error;
    });
    await store.log("generation_started", { jobId: job.id, seed, variants: job.variants.map(v => v.spec.id) });
    await command(process.execPath, ["--import", "tsx", "scripts/generate.ts", `--request-file=${requestFile}`, `--headline=${job.spec.source.headline ?? ""}`, "--video", "--no-thumbnail", "--frames=30", "--keep-intermediates", `--render-scale=${job.spec.renderScale ?? 1}`, `--out=${store.path(job.id, "raw")}`]);
    await validateVideo(await store.owned(job, source));
    for (const artifact of [source, silent, wav]) await store.seal(job, artifact);
  }
  // Recover a crash between sealing the source and sealing its encoder intermediates.
  for (const artifact of [silent, wav]) if (!artifact.generatedAt) await store.seal(job, artifact);
  for (const variant of job.variants) {
    if (variant.validatedAt) continue;
    await store.capacity();
    const artifact = await store.reserve(job, variant.file, "video");
    const overlay = await store.reserve(job, `${variant.spec.id}-hook.png`, "overlay");
    const { width, height } = dimensions(job, variant);
    await makeOverlay(await store.owned(job, overlay), width, height, variant.spec.hook);
    await store.seal(job, overlay);
    const rate = variant.spec.playbackRate ?? 1;
    const duration = await validateVideo(await store.owned(job, source));
    // Reuse the existing source render; retain the whole challenge and winner at different speeds.
    const filter = `[0:v]setpts=(PTS-STARTPTS)/${rate},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x070a12,fps=30[base];[base][1:v]overlay=enable='lt(t,2.5)':eof_action=repeat,format=yuv420p[v];[0:a]atempo=${rate},${variant.spec.audio === "muted" ? "volume=0" : "loudnorm=I=-16:LRA=11:TP=-1.5"},aresample=48000[a]`;
    await command("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", await store.owned(job, source), "-i", await store.owned(job, overlay), "-filter_complex_threads", "1", "-filter_complex", filter, "-map", "[v]", "-map", "[a]", "-t", String(duration / rate), "-c:v", "libx264", "-threads", "2", "-preset", "fast", "-crf", "19", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", await store.owned(job, artifact)]);
    variant.duration = await validateVideo(await store.owned(job, artifact), { width, height });
    await store.seal(job, artifact);
    variant.generatedAt = artifact.generatedAt;
    variant.validatedAt = store.clock().toISOString();
    await store.save(job);
    await store.log("variant_validated", { jobId: job.id, variant: variant.spec.id, file: variant.file, seconds: variant.duration, width, height, hook: variant.spec.hook, rate, format: variant.spec.format ?? "9:16", destinations: variant.spec.destinations });
  }
  job.generationCompleteAt = store.clock().toISOString();
  job.state = "delivering";
  job.error = undefined;
  await store.save(job);
}

export function artifactFor(job: Job, variant: Variant): Artifact {
  const artifact = job.artifacts.find(a => a.path === variant.file);
  if (!artifact) throw new Error("Variant ownership record missing");
  return artifact;
}
