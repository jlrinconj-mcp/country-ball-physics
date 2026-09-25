/**
 * Render PNG snapshots of a simulation without a browser.
 *   npm run render:frames -- --mode=race --seed=world-001 --times=0,2,8,end
 */
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { DEFAULT_CONFIG } from "../src/engine/defaults";
import { TICK_RATE } from "../src/engine/physicsWorld";
import type { CameraMode } from "../src/engine/simulation";
import type { ModeId } from "../src/engine/types";
import { createSimulation, modeDefaults } from "../src/modes";
import { DEFAULT_DISPLAY, type DisplayOptions } from "../src/render/displayOptions";
import type { VideoFormat } from "../src/render/formats";
import { createNodeCountryService } from "./lib/countries";
import { HeadlessRenderer } from "./lib/headlessRenderer";

const { values } = parseArgs({
  options: {
    seed: { type: "string", default: "world-001" },
    mode: { type: "string", default: DEFAULT_CONFIG.mode },
    scenario: { type: "string", default: "" },
    count: { type: "string", default: "48" },
    format: { type: "string", default: "9:16" },
    camera: { type: "string", default: "" },
    times: { type: "string", default: "0,3,10,end" },
    scale: { type: "string", default: "0.5" },
    out: { type: "string", default: "output/frames" },
    eyes: { type: "boolean", default: false },
    "safe-area": { type: "boolean", default: false },
  },
});

const countries = await createNodeCountryService().getAllCountries();
const mode = values.mode as ModeId;
const config = {
  ...DEFAULT_CONFIG,
  ...modeDefaults(mode),
  seed: values.seed,
  countries: countries.map((c) => c.cca3),
  maxParticipants: Number(values.count),
  scenario: values.scenario || modeDefaults(mode).scenario,
};
const sim = createSimulation(config, countries);
const display: DisplayOptions = {
  ...DEFAULT_DISPLAY,
  format: values.format as VideoFormat,
  camera: (values.camera || sim.definition.defaultCamera) as CameraMode,
  eyes: values.eyes,
  safeArea: values["safe-area"],
};

// Run once headless to know when it ends.
const probe = createSimulation(config, countries);
const result = probe.runToEnd();
probe.destroy();

const renderer = new HeadlessRenderer(display, Number(values.scale));
const loaded = await renderer.preload(sim.balls.map((b) => b.country));
renderer.attach(sim);

const endTick = (result?.ticks ?? sim.maxTicks) + Math.round(1.5 * TICK_RATE);
const targets = values.times
  .split(",")
  .map((t) => (t === "end" ? endTick : Math.round(Number(t) * TICK_RATE)))
  .sort((a, b) => a - b);

await mkdir(values.out, { recursive: true });
const slug = `${mode}-${sim.scenario}-${values.seed}-${display.format.replace(":", "x")}`;
for (const target of targets) {
  renderer.advanceTo(target);
  const file = `${values.out}/${slug}-t${String(target).padStart(5, "0")}.png`;
  await writeFile(file, renderer.png());
  console.log(`${file}  alive=${sim.aliveCount} status=${sim.status}`);
}
console.log(`flags loaded=${loaded.loaded} failed=${loaded.failed} winner=${result?.winner.name} t=${result?.seconds.toFixed(1)}s`);
