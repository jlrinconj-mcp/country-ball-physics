import type { Country } from "../../src/countries/countryTypes";
import { Camera } from "../../src/engine/camera";
import { TICK_RATE } from "../../src/engine/physicsWorld";
import type { Simulation } from "../../src/engine/simulation";
import { CanvasRenderer, type HudOverlay } from "../../src/render/canvasRenderer";
import type { DisplayOptions } from "../../src/render/displayOptions";
import { FlagAtlas } from "../../src/render/flagAtlas";
import { FORMATS } from "../../src/render/formats";
import { HudTracker } from "../../src/render/hudTracker";
import { viewportFor } from "../../src/render/viewport";
import { createOutputCanvas, nodePlatform, setupNodeFonts } from "./nodeCanvas";

/**
 * Renders simulation frames to PNG in Node with the exact browser renderer.
 * The camera advances with simulated time, so frames are reproducible.
 */
export class HeadlessRenderer {
  private readonly canvas;
  private readonly atlas = new FlagAtlas({ border: "#070a12", borderRatio: 0.045, shading: true }, 256, nodePlatform);
  private readonly renderer: CanvasRenderer;
  private readonly camera = new Camera();
  private sim: Simulation | null = null;
  private hud: HudTracker | null = null;

  constructor(
    private readonly display: DisplayOptions,
    scale = 1,
  ) {
    setupNodeFonts();
    const format = FORMATS[display.format];
    this.canvas = createOutputCanvas(Math.round(format.width * scale), Math.round(format.height * scale));
    this.renderer = new CanvasRenderer(this.canvas as unknown as HTMLCanvasElement, this.atlas);
    this.camera.options = { mode: display.camera, dynamicZoom: display.dynamicZoom };
    this.camera.setViewport(viewportFor(display));
  }

  preload(countries: Country[]) {
    return this.atlas.preload(countries, 20000);
  }

  /** Follow a (fresh) simulation from its current tick. */
  attach(sim: Simulation): void {
    this.hud?.dispose();
    this.sim = sim;
    this.hud = new HudTracker(sim);
    this.camera.snap(sim);
  }

  /** Step the simulation (and camera) up to `tick`. */
  advanceTo(tick: number): void {
    const sim = this.sim;
    if (!sim) throw new Error("No simulation attached");
    while (sim.tick < tick) {
      sim.step();
      this.camera.update(sim, 1, 1 / TICK_RATE);
    }
  }

  png(overlay?: HudOverlay): Buffer {
    const sim = this.sim;
    if (!sim || !this.hud) throw new Error("No simulation attached");
    this.renderer.render({ sim, camera: this.camera, alpha: 1, display: this.display, hud: this.hud, overlay });
    return this.canvas.toBuffer("image/png");
  }
}
