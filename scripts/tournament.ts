/**
 * Custom tournaments, fully automated.
 *
 *   npm run tournament -- --spec=tournaments/copa-america.json
 *   npm run tournament -- --spec=tournaments/world-cup-32.json --count=5 --seed=wc
 *   npm run tournament -- --countries=europe --size=16 --heat-mode=marble-race --name="Euro Marbles"
 *   npm run tournament -- --spec=tournaments/copa-america.json --frames=30   # PNG frames of the final
 *
 * Writes output/tournaments/<seed>/: bracket.md, bracket.json, metadata.json,
 * one thumbnail per heat (heats/r1-h1.png …) and optionally the final's frames.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { bracketMarkdown, parseTournamentSpec, runTournamentSpec, type TournamentRun, type TournamentSpec } from "../src/content/tournamentSpec";
import type { Country } from "../src/countries/countryTypes";
import { TICK_RATE } from "../src/engine/physicsWorld";
import type { SimulationConfig } from "../src/engine/types";
import { createSimulation } from "../src/modes";
import { createNodeCountryService } from "./lib/countries";
import { HeadlessRenderer } from "./lib/headlessRenderer";

const { values } = parseArgs({
  options: {
    spec: { type: "string" },
    count: { type: "string", default: "1" },
    seed: { type: "string" },
    name: { type: "string" },
    countries: { type: "string" },
    size: { type: "string" },
    "heat-mode": { type: "string" },
    "heat-scenario": { type: "string" },
    lang: { type: "string" },
    format: { type: "string" },
    out: { type: "string", default: "output/tournaments" },
    thumbnails: { type: "boolean", default: true },
    "no-thumbnails": { type: "boolean", default: false },
    frames: { type: "string" },
  },
});

// Spec file first, then command-line overrides.
const fromFile: unknown = values.spec ? JSON.parse(await readFile(values.spec, "utf8")) : {};
const merged = {
  ...(fromFile as Record<string, unknown>),
  ...(values.name ? { name: values.name } : {}),
  ...(values.countries ? { countries: values.countries.includes(",") ? values.countries.split(",") : values.countries } : {}),
  ...(values.size ? { size: Number(values.size) } : {}),
  ...(values["heat-mode"] ? { heatMode: values["heat-mode"] } : {}),
  ...(values["heat-scenario"] ? { heatScenario: values["heat-scenario"] } : {}),
  ...(values.lang ? { language: values.lang } : {}),
  ...(values.format ? { format: values.format } : {}),
};
let spec: TournamentSpec;
try {
  spec = parseTournamentSpec(merged);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

const countries = await createNodeCountryService().getAllCountries({ includeTerritories: true });
const count = Math.max(1, Number(values.count));
const baseSeed = values.seed ?? spec.seed;

for (let i = 0; i < count; i++) {
  const seed = baseSeed ? (count > 1 ? `${baseSeed}-${String(i + 1).padStart(3, "0")}` : baseSeed) : undefined;
  let run: TournamentRun;
  try {
    run = runTournamentSpec(spec, countries, seed);
  } catch (error) {
    console.error(`✗ ${(error as Error).message}`);
    process.exit(1);
  }
  const t = run.tournament!;
  const dir = `${values.out}/${run.plan.seed}`;
  await mkdir(`${dir}/heats`, { recursive: true });
  await writeFile(`${dir}/bracket.md`, bracketMarkdown(run, countries));
  await writeFile(
    `${dir}/bracket.json`,
    JSON.stringify(
      {
        seed: run.plan.seed,
        champion: t.champion,
        fingerprint: t.fingerprint,
        heats: t.outcomes.map((o) => ({
          seed: o.heat.seed,
          round: o.heat.round + 1,
          heat: o.heat.heat + 1,
          countries: o.heat.countries,
          ranking: o.result.ranking.map((r) => r.cca3),
          advanced: o.advanced,
          winner: o.result.winner.cca3,
          seconds: o.result.seconds,
          decidedBy: o.result.decidedBy,
          fingerprint: o.result.fingerprint,
        })),
      },
      null,
      2,
    ),
  );
  await writeFile(`${dir}/metadata.json`, JSON.stringify({ spec, config: run.plan.config, display: run.plan.display, metadata: run.metadata }, null, 2));

  if (values.thumbnails && !values["no-thumbnails"]) {
    for (const o of t.outcomes) {
      const png = await heatFrame(heatConfig(run.plan.config, o.heat.seed, o.heat.countries), run, countries, Math.round(o.result.ticks * 0.35), o.advanced.length === 0);
      await writeFile(`${dir}/heats/r${o.heat.round + 1}-h${o.heat.heat + 1}.png`, png);
    }
  }
  if (values.frames) await renderFinal(run, countries, dir, Number(values.frames));

  const total = t.outcomes.reduce((s, o) => s + o.result.seconds, 0);
  const champion = countries.find((c) => c.cca3 === t.champion);
  console.log(
    `[${i + 1}/${count}] ${run.plan.seed}  ${run.metadata.title}  →  🏆 ${champion?.flag.emoji} ${champion?.name}  ` +
      `(${t.outcomes.length} heats, ${total.toFixed(0)} s of racing${run.timeouts.length ? `, ${run.timeouts.length} time-limit heats` : ""}, ${Math.round(run.elapsedMs)} ms) → ${dir}`,
  );
}

function heatConfig(base: SimulationConfig, seed: string, codes: string[]): SimulationConfig {
  const { tournament: _t, ...rest } = base;
  void _t;
  return { ...rest, seed, countries: codes, maxParticipants: codes.length };
}

async function heatFrame(config: SimulationConfig, run: TournamentRun, all: Country[], tick: number, final: boolean): Promise<Buffer> {
  const sim = createSimulation(config, all);
  const renderer = new HeadlessRenderer({ ...run.plan.display, camera: "follow-group" }, 0.5);
  await renderer.preload(sim.balls.map((b) => b.country));
  renderer.attach(sim);
  renderer.advanceTo(tick);
  const png = renderer.png({ status: final ? "FINAL" : `HEAT ${config.seed.split("-h").pop()}` });
  sim.destroy();
  return png;
}

async function renderFinal(run: TournamentRun, all: Country[], dir: string, fps: number): Promise<void> {
  const final = run.tournament!.outcomes.at(-1)!;
  const sim = createSimulation(heatConfig(run.plan.config, final.heat.seed, final.heat.countries), all);
  const renderer = new HeadlessRenderer(run.plan.display, 1);
  await renderer.preload(sim.balls.map((b) => b.country));
  renderer.attach(sim);
  await mkdir(`${dir}/final-frames`, { recursive: true });
  const ticksPerFrame = TICK_RATE / fps;
  const frames = Math.ceil((final.result.ticks + 3 * TICK_RATE) / ticksPerFrame);
  for (let f = 0; f < frames; f++) {
    renderer.advanceTo(Math.round(f * ticksPerFrame));
    await writeFile(`${dir}/final-frames/${String(f).padStart(5, "0")}.png`, renderer.png({ status: "FINAL", winnerTitle: "CHAMPION" }));
  }
  sim.destroy();
  await writeFile(`${dir}/final-frames/README.txt`, `ffmpeg -framerate ${fps} -i final-frames/%05d.png -c:v libx264 -pix_fmt yuv420p -crf 18 final.mp4\n`);
}
