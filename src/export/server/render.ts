import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { OfflineMix } from "@/audio/offlineMix";
import { buildMetadata } from "@/content/metadata";
import type { Country } from "@/countries/countryTypes";
import { hashString } from "@/engine/random";
import { TICK_RATE } from "@/engine/physicsWorld";
import type { HudOverlay } from "@/render/canvasRenderer";
import { HeadlessRenderer } from "../../../scripts/lib/headlessRenderer";
import { exportCommand, validateExportVideo, watchEncoder, writeEncoderFrame } from "./encoder";
import { RecordingTimeline } from "../timeline";
import { MAX_VIDEO_SECONDS, PART_SECONDS, VIDEO_FPS, type VideoExport } from "../types";

export interface RenderOptions {
  /** Test-only: production exports always use the format's full resolution. */
  scale?: number;
  partSeconds?: number;
  progress?: (video: VideoExport) => Promise<void>;
  /** Persisted pause/cancel check, called before each frame and each output phase. */
  checkpoint?: () => Promise<void>;
  /** Pause state used to exclude intentional pauses from encoder timeout. */
  isPaused?: () => boolean;
  signal?: AbortSignal;
}

/** Stream one chosen run into independently playable parts. No full-length video is ever written. */
export async function renderVideoExport(video: VideoExport, countries: Country[], directory: string, options: RenderOptions = {}): Promise<void> {
  const { config, display } = video.request;
  const maxFrames = Math.floor(Math.min(PART_SECONDS, options.partSeconds ?? PART_SECONDS) * VIDEO_FPS);
  if (!Number.isFinite(maxFrames) || maxFrames < 1) throw new Error("La duración de las partes debe ser positiva.");
  const timeline = new RecordingTimeline(config, countries);
  const renderer = new HeadlessRenderer({ ...display, speed: 1, safeArea: false }, options.scale ?? 1);
  const mix = new OfflineMix();
  let cues: ReturnType<OfflineMix["attach"]> | undefined;
  let overlay: HudOverlay | undefined;
  const attach = () => {
    renderer.attach(timeline.sim);
    cues?.detach();
    cues = mix.attach(timeline.sim, x => renderer.panOf(x));
    const round = timeline.tournament?.current()?.round;
    overlay = timeline.tournament ? { status: timeline.tournament.label(), winnerTitle: round?.advance === 0 ? "CHAMPION" : "HEAT WINNER" } : undefined;
  };
  let encoder: ReturnType<typeof spawn> | null = null;
  let encoderClosed: Promise<void> | undefined;
  const checkpoint = async () => { options.signal?.throwIfAborted(); await options.checkpoint?.(); options.signal?.throwIfAborted(); };
  try {
    await checkpoint();
    const { loaded, failed } = await renderer.preload(countries);
    await checkpoint();
    if (failed || loaded !== countries.length) throw new Error("No se cargaron todas las banderas. Reintenta cuando estén disponibles.");
    attach();
    video.status = "recording";
    await options.progress?.(video);
    while (!timeline.done) {
      await checkpoint();
      const number = video.parts.length + 1;
      const name = `part-${String(number).padStart(3, "0")}`;
      const silent = join(directory, `${name}.silent.mp4`);
      const wav = join(directory, `${name}.wav`);
      const file = `${name}.mp4`;
      const start = timeline.position;
      const firstFrame = video.frames;
      encoder = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(VIDEO_FPS), "-i", "-", "-c:v", "libx264", "-threads", "2", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", silent], { stdio: ["pipe", "ignore", "pipe"] });
      const input = encoder.stdin!;
      input.on("error", () => {});
      const closed = encoderClosed = watchEncoder(encoder, options.signal, undefined, options.isPaused);
      void closed.catch(() => {});
      let frames = 0;
      while (frames < maxFrames && !timeline.done) {
        await checkpoint();
        await writeEncoderFrame(encoder, renderer.png(overlay), closed);
        frames++;
        video.frames++;
        timeline.advance(TICK_RATE / VIDEO_FPS, {
          beforeStep: () => { mix.time = (timeline.tick + 1) / TICK_RATE; },
          afterStep: () => { cues?.afterStep(); renderer.advanceCamera(); }, newHeat: attach,
        });
        if (video.frames % VIDEO_FPS === 0) {
          video.results = [...timeline.results];
          video.tournament = timeline.tournament?.summary() ?? null;
          await options.progress?.(video);
        }
        if (timeline.tick > TICK_RATE * 3 * 3600) throw new Error("El torneo superó el límite operativo de tres horas.");
      }
      input.end();
      await closed;
      encoder = null;
      encoderClosed = undefined;
      await checkpoint();
      await writeFile(wav, mix.wav(frames / VIDEO_FPS, firstFrame / VIDEO_FPS));
      await exportCommand("ffmpeg", ["-y", "-loglevel", "error", "-i", silent, "-i", wav, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", join(directory, file)], options.signal);
      await checkpoint();
      const duration = await validateExportVideo(join(directory, file), options.signal);
      await checkpoint();
      if (duration > MAX_VIDEO_SECONDS) throw new Error(`La parte ${number} excedió 120 segundos.`);
      video.parts.push({ number, file, frames, duration, start, end: timeline.position });
      mix.discardBefore(video.frames / VIDEO_FPS);
      await rm(silent);
      await rm(wav);
      await options.progress?.(video);
    }
    video.results = [...timeline.results];
    video.tournament = timeline.tournament?.summary() ?? null;
    const result = video.results.at(-1);
    if (!result) throw new Error("La grabación no produjo un resultado.");
    const participants = config.tournament?.size ?? timeline.sim.balls.length;
    video.metadata = buildMetadata({
      request: { mode: config.tournament ? "tournament" : config.mode, seed: config.seed },
      config, display, seed: config.seed, participants,
      label: display.language === "es" ? `${participants} países` : `${participants} Countries`,
    }, { winnerName: result.winner.name, winnerEmoji: countries.find(c => c.cca3 === result.winner.cca3)?.flag.emoji ?? "", seconds: video.frames / VIDEO_FPS }, display.language);
    video.fingerprint = config.tournament ? hashString(video.results.map(r => r.fingerprint).join("|")).toString(16).padStart(8, "0") : result.fingerprint;
    for (const part of video.parts) {
      await checkpoint();
      const label = display.language === "es" ? "Parte" : "Part";
      part.metadata = { ...video.metadata, title: `${video.metadata.title} · ${label} ${part.number}/${video.parts.length}` };
      await writeFile(join(directory, part.file.replace(/\.mp4$/, ".json")), JSON.stringify({ ...part.metadata, part, config, display }, null, 2), { mode: 0o600 });
    }
    await checkpoint();
    video.status = "complete";
    delete video.workerPid;
    await writeFile(join(directory, "metadata.json"), JSON.stringify(video, null, 2), { mode: 0o600 });
    await options.progress?.(video);
  } finally {
    encoder?.kill("SIGTERM");
    if (encoderClosed) {
      const hardKill = setTimeout(() => encoder?.kill("SIGKILL"), 3000);
      try { await encoderClosed.catch(() => {}); } finally { clearTimeout(hardKill); }
    }
    cues?.detach();
    timeline.dispose();
  }
}
