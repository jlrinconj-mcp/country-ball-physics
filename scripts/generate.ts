/**
 * Content factory CLI: plan → simulate → metadata → thumbnail (→ frames/video).
 *
 *   npm run generate -- --count=10 --mode=race --countries=europe
 *   npm run generate -- --mode=tournament --countries=all --seed=cup-2026
 *   npm run generate -- --mode=random --count=50 --seed=batch --lang=es   # Spanish titles and video text
 *   npm run generate -- --mode=marble-race --frames=30          # PNG sequence
 *   npm run generate -- --mode=race --video                      # MP4 with sound; needs ffmpeg on PATH
 *   npm run generate -- --mode=race --video --no-audio           # silent MP4
 *   npm run generate -- --mode=last-place-elimination --elimination=single   # one out a round (long)
 */
import { spawn, spawnSync } from "node:child_process";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { OfflineMix } from "../src/audio/offlineMix";
import { parseArgs } from "node:util";
import { runPlan, type GeneratedSimulation } from "../src/content/generateSimulation";
import type { Language } from "../src/content/metadata";
import { planSimulation, type ContentMode, type GenerateRequest } from "../src/content/plan";
import type { Country } from "../src/countries/countryTypes";
import { TICK_RATE } from "../src/engine/physicsWorld";
import { createSimulation } from "../src/modes";
import type { TournamentSize } from "../src/modes/tournament";
import type { VideoFormat } from "../src/render/formats";
import { createNodeCountryService } from "./lib/countries";
import { HeadlessRenderer } from "./lib/headlessRenderer";

const { values } = parseArgs({
  options: {
    count: { type: "string", default: "1" },
    mode: { type: "string", default: "random" },
    countries: { type: "string", default: "all" },
    track: { type: "string", default: "random" },
    map: { type: "string" },
    seed: { type: "string" },
    format: { type: "string", default: "9:16" },
    participants: { type: "string" },
    size: { type: "string" },
    lang: { type: "string", default: "en" },
    out: { type: "string", default: "output/runs" },
    thumbnail: { type: "boolean", default: true },
    "no-thumbnail": { type: "boolean", default: false },
    frames: { type: "string" },
    video: { type: "boolean", default: false },
    "no-audio": { type: "boolean", default: false },
    elimination: { type: "string" },
  },
});

const count = Math.max(1, Number(values.count));
const language = (values.lang === "es" ? "es" : "en") as Language;
const service = createNodeCountryService();
const countries = await service.getAllCountries({ includeTerritories: true });
const status = service.getStatus();
console.log(`countries: ${status?.count} from ${status?.source}${status?.stale ? " (offline cache)" : ""}`);

if (values.video && spawnSync("ffmpeg", ["-version"]).status !== 0) {
  console.error("--video needs ffmpeg on PATH. Use --frames=30 to write a PNG sequence instead.");
  process.exit(1);
}

await mkdir(values.out, { recursive: true });
for (let i = 0; i < count; i++) {
  const seed = values.seed ? (count > 1 ? `${values.seed}-${String(i + 1).padStart(3, "0")}` : values.seed) : undefined;
  const request: GenerateRequest = {
    mode: values.mode as ContentMode,
    countries: values.countries,
    track: values.track,
    map: values.map,
    seed,
    format: values.format as VideoFormat,
    participants: values.participants ? Number(values.participants) : undefined,
    tournamentSize: values.size ? (Number(values.size) as TournamentSize) : undefined,
    language,
    elimination: values.elimination === "single" ? "single" : values.elimination === "batch" ? "batch" : undefined,
  };
  const plan = planSimulation(request, countries);
  const generated = runPlan(plan, countries, language);
  const dir = `${values.out}/${plan.seed}`;
  await mkdir(dir, { recursive: true });

  const files: string[] = ["metadata.json"];
  if (values.thumbnail && !values["no-thumbnail"]) {
    await writeFile(`${dir}/thumbnail.png`, await renderThumbnail(generated, countries));
    files.push("thumbnail.png");
  }
  if (values.frames || values.video) {
    const fps = Number(values.frames ?? 30);
    const written = await renderSequence(generated, countries, dir, fps, values.video);
    files.push(values.video ? "video.mp4" : `frames/ (${written} @ ${fps}fps)`);
    if (!values.video && !values["no-audio"]) files.push("audio.wav");
  }

  const record = {
    seed: plan.seed,
    request,
    label: plan.label,
    config: plan.config,
    display: plan.display,
    metadata: generated.metadata,
    result: generated.result,
    tournament: generated.tournament
      ? {
          champion: generated.tournament.champion,
          fingerprint: generated.tournament.fingerprint,
          heats: generated.tournament.outcomes.map((o) => ({
            seed: o.heat.seed,
            countries: o.heat.countries,
            winner: o.result.winner.cca3,
            advanced: o.advanced,
            seconds: o.result.seconds,
          })),
        }
      : null,
    generatedAt: new Date().toISOString(),
    simulationMs: Math.round(generated.elapsedMs),
  };
  await writeFile(`${dir}/metadata.json`, JSON.stringify(record, null, 2));
  await appendFile(`${values.out}/index.jsonl`, `${JSON.stringify({ seed: plan.seed, title: generated.metadata.title, result: generated.metadata.result, dir })}\n`);
  console.log(
    `[${i + 1}/${count}] ${plan.seed}  ${generated.metadata.title}  →  ${generated.metadata.result}  (${files.join(", ")}, ${Math.round(generated.elapsedMs)} ms)`,
  );
}

/** The heat a video focuses on: the simulation itself, or a tournament's final. */
function videoConfig(generated: GeneratedSimulation) {
  const final = generated.tournament?.outcomes.at(-1);
  return final ? { ...generated.plan.config, seed: final.heat.seed, countries: final.heat.countries, maxParticipants: final.heat.countries.length } : generated.plan.config;
}

async function renderThumbnail(generated: GeneratedSimulation, all: Country[]): Promise<Buffer> {
  const sim = createSimulation(videoConfig(generated), all);
  // The main group fills a still frame better than a lone leader.
  const renderer = new HeadlessRenderer({ ...generated.plan.display, camera: "follow-group" }, 1);
  await renderer.preload(sim.balls.map((b) => b.country));
  renderer.attach(sim);
  // A frame from the thick of it, well before the result.
  renderer.advanceTo(Math.round(generated.result.ticks * 0.35));
  const png = renderer.png(generated.tournament ? { status: "FINAL" } : undefined);
  sim.destroy();
  return png;
}

async function renderSequence(generated: GeneratedSimulation, all: Country[], dir: string, fps: number, video: boolean): Promise<number> {
  const sim = createSimulation(videoConfig(generated), all);
  const renderer = new HeadlessRenderer(generated.plan.display, 1);
  await renderer.preload(sim.balls.map((b) => b.country));
  renderer.attach(sim);
  const ticksPerFrame = TICK_RATE / fps;
  const totalTicks = generated.result.ticks + 3 * TICK_RATE;
  const frames = Math.ceil(totalTicks / ticksPerFrame);
  const overlay = generated.tournament ? { status: "FINAL", winnerTitle: "CHAMPION" } : undefined;

  // The soundtrack, mixed on simulated time while the frames render.
  const mix = values["no-audio"] ? null : new OfflineMix();
  if (mix) {
    const cues = mix.attach(sim, (x) => renderer.panOf(x));
    renderer.beforeStep = () => (mix.time = (sim.tick + 1) / TICK_RATE);
    renderer.afterStep = () => cues.afterStep();
  }
  const silent = mix ? `${dir}/video.silent.mp4` : `${dir}/video.mp4`;

  const ffmpeg = video
    ? spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", silent], { stdio: ["pipe", "inherit", "inherit"] })
    : null;
  if (!video) await mkdir(`${dir}/frames`, { recursive: true });

  for (let f = 0; f < frames; f++) {
    renderer.advanceTo(Math.round(f * ticksPerFrame));
    const png = renderer.png(overlay);
    if (ffmpeg) {
      if (!ffmpeg.stdin.write(png)) await new Promise((resolve) => ffmpeg.stdin.once("drain", resolve));
    } else {
      await writeFile(`${dir}/frames/${String(f).padStart(5, "0")}.png`, png);
    }
  }
  sim.destroy();
  if (mix) await writeFile(`${dir}/audio.wav`, mix.wav(frames / fps));
  if (ffmpeg) {
    ffmpeg.stdin.end();
    await exited(ffmpeg);
    if (mix) {
      await exited(spawn("ffmpeg", ["-y", "-loglevel", "error", "-i", silent, "-i", `${dir}/audio.wav`, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", `${dir}/video.mp4`], { stdio: "inherit" }));
      await rm(silent);
      await rm(`${dir}/audio.wav`);
    }
  } else {
    const audio = mix ? " -i audio.wav -c:a aac -b:a 192k -shortest" : "";
    await writeFile(`${dir}/frames/README.txt`, `Assemble with:\nffmpeg -framerate ${fps} -i frames/%05d.png${audio} -c:v libx264 -pix_fmt yuv420p -crf 18 video.mp4\n`);
  }
  return frames;
}

function exited(process: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => process.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`)))));
}
