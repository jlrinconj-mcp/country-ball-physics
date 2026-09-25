/**
 * Render PNG snapshots of a simulation without a browser.
 *   npm run render:frames -- --seed=world-001 --scenario=ring --times=0,2,8,end
 */
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { Camera } from "../src/engine/camera";
import { DEFAULT_CONFIG } from "../src/engine/defaults";
import { TICK_RATE } from "../src/engine/physicsWorld";
import type { ModeId } from "../src/engine/types";
import { createSimulation, modeDefaults } from "../src/modes";
import { CanvasRenderer } from "../src/render/canvasRenderer";
import { DEFAULT_DISPLAY, type DisplayOptions } from "../src/render/displayOptions";
import { FlagAtlas } from "../src/render/flagAtlas";
import { FORMATS, type VideoFormat } from "../src/render/formats";
import { viewportFor } from "../src/render/viewport";
import { HudTracker } from "../src/render/hudTracker";
import type { CameraMode } from "../src/engine/simulation";
import { createNodeCountryService } from "./lib/countries";
import { createOutputCanvas, nodePlatform, setupNodeFonts } from "./lib/nodeCanvas";

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

setupNodeFonts();
const service = createNodeCountryService();
const countries = await service.getAllCountries();
const mode = values.mode as ModeId;
const sim = createSimulation(
  {
    ...DEFAULT_CONFIG,
    ...modeDefaults(mode),
    seed: values.seed,
    countries: countries.map((c) => c.cca3),
    maxParticipants: Number(values.count),
    scenario: values.scenario || modeDefaults(mode).scenario,
  },
  countries,
);
const format = FORMATS[values.format as VideoFormat];
const display: DisplayOptions = {
  ...DEFAULT_DISPLAY,
  format: format.id,
  camera: (values.camera || sim.definition.defaultCamera) as CameraMode,
  eyes: values.eyes,
  safeArea: values["safe-area"],
};
const scale = Number(values.scale);
const canvas = createOutputCanvas(Math.round(format.width * scale), Math.round(format.height * scale));
const atlas = new FlagAtlas({ border: "#070a12", borderRatio: 0.045, shading: true }, 256, nodePlatform);
const loaded = await atlas.preload(sim.balls.map((b) => b.country), 15000);
const renderer = new CanvasRenderer(canvas as unknown as HTMLCanvasElement, atlas);
const camera = new Camera();
camera.options = { mode: display.camera, dynamicZoom: display.dynamicZoom };
camera.setViewport(viewportFor(display));
camera.snap(sim);
const hud = new HudTracker(sim);

const result = (() => {
  const probe = createSimulation(sim.config, countries);
  const r = probe.runToEnd();
  probe.destroy();
  return r;
})();
const endTick = (result?.ticks ?? sim.maxTicks) + Math.round(1.5 * TICK_RATE);
const targets = values.times
  .split(",")
  .map((t) => (t === "end" ? endTick : Math.round(Number(t) * TICK_RATE)))
  .sort((a, b) => a - b);

await mkdir(values.out, { recursive: true });
const slug = `${mode}-${sim.scenario}-${values.seed}-${format.id.replace(":", "x")}`;
for (const target of targets) {
  while (sim.tick < target) {
    sim.step();
    camera.update(sim, 1, 1 / TICK_RATE);
  }
  renderer.render({ sim, camera, alpha: 1, display, hud });
  const file = `${values.out}/${slug}-t${String(target).padStart(5, "0")}.png`;
  await writeFile(file, canvas.toBuffer("image/png"));
  console.log(`${file}  alive=${sim.aliveCount} status=${sim.status}`);
}
console.log(`flags loaded=${loaded.loaded} failed=${loaded.failed} winner=${result?.winner.name} t=${result?.seconds.toFixed(1)}s`);
