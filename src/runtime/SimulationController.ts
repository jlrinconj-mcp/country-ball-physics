import { AudioEngine } from "@/audio/audioEngine";
import type { Country } from "@/countries/countryTypes";
import { Camera } from "@/engine/camera";
import { TICK_RATE } from "@/engine/physicsWorld";
import { selectParticipants, type Simulation, type SimulationResult } from "@/engine/simulation";
import { SimulationLoop } from "@/engine/simulationLoop";
import type { SimulationConfig } from "@/engine/types";
import { createSimulation } from "@/modes";
import { Tournament, type TournamentSummary } from "@/modes/tournament";
import { CanvasRenderer, type HudOverlay } from "@/render/canvasRenderer";
import { DEFAULT_DISPLAY, type DisplayOptions } from "@/render/displayOptions";
import { FlagAtlas } from "@/render/flagAtlas";
import { FORMATS } from "@/render/formats";
import { HudTracker } from "@/render/hudTracker";
import { setFontFamily } from "@/render/text";
import { viewportFor } from "@/render/viewport";

/** Keep animating this long after the winner is declared, then idle. */
const OUTRO_TICKS = 6 * TICK_RATE;
/** Pause between tournament heats (the winner card stays up meanwhile). */
const BETWEEN_HEATS_TICKS = 4 * TICK_RATE;
const PUBLISH_INTERVAL_MS = 200;

export type Phase = "idle" | "loading" | "running" | "finished" | "error";

export interface RankingRow {
  cca3: string;
  cca2: string;
  name: string;
  emoji: string;
  status: "alive" | "eliminated" | "finished";
  place: number | null;
}

/** Low-frequency view of the simulation for React (never per frame). */
export interface ControllerSnapshot {
  phase: Phase;
  paused: boolean;
  time: number;
  alive: number;
  total: number;
  leader: RankingRow | null;
  winner: RankingRow | null;
  ranking: RankingRow[];
  result: SimulationResult | null;
  config: SimulationConfig | null;
  scenario: string | null;
  error: string | null;
  /** Compared with the previous finished run of the exact same config. */
  replay: "identical" | "different" | null;
  tournament: TournamentSummary | null;
}

export const EMPTY_SNAPSHOT: ControllerSnapshot = {
  phase: "idle",
  paused: false,
  time: 0,
  alive: 0,
  total: 0,
  leader: null,
  winner: null,
  ranking: [],
  result: null,
  config: null,
  scenario: null,
  error: null,
  replay: null,
  tournament: null,
};

/**
 * Browser runtime that wires a Simulation to the canvas, camera and loop.
 * React talks to it imperatively and reads throttled snapshots through
 * `subscribe`/`getSnapshot` (useSyncExternalStore), so the component tree
 * never re-renders at frame rate.
 */
export class SimulationController {
  private sim: Simulation | null = null;
  private hud: HudTracker | null = null;
  private countries: Country[] = [];
  private renderer: CanvasRenderer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private readonly atlas = new FlagAtlas({ border: "#070a12", borderRatio: 0.045, shading: true });
  private readonly camera = new Camera();
  private readonly loop: SimulationLoop;
  private display: DisplayOptions = DEFAULT_DISPLAY;
  private snapshot: ControllerSnapshot = EMPTY_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private lastPublish = 0;
  private dirty = false;
  private loadToken = 0;
  private readonly simListeners: (() => void)[] = [];
  private readonly fingerprints = new Map<string, string>();
  private tournament: Tournament | null = null;
  private baseConfig: SimulationConfig | null = null;
  private overlay: HudOverlay | undefined;
  private readonly audio = new AudioEngine();
  private detachAudio: (() => void) | null = null;
  private lastBanner: string | undefined;
  private replay: ControllerSnapshot["replay"] = null;

  constructor() {
    this.loop = new SimulationLoop({
      step: () => this.step(),
      render: (alpha, dt) => this.render(alpha, dt),
    });
  }

  // ── React bridge ────────────────────────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ControllerSnapshot => this.snapshot;

  // ── Lifecycle ───────────────────────────────────────────────────────────

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.renderer = new CanvasRenderer(canvas, this.atlas);
    setFontFamily(getComputedStyle(canvas).fontFamily);
    this.loop.start();
  }

  detach(): void {
    this.loop.stop();
    this.renderer = null;
    this.canvas = null;
  }

  dispose(): void {
    this.detach();
    this.disposeSimulation();
    this.audio.dispose();
    this.listeners.clear();
  }

  /** Size the backing store for the element's CSS size. */
  resize(cssWidth: number, devicePixelRatio: number): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const format = FORMATS[this.display.format];
    // Never render above the target output resolution.
    const scale = Math.min(devicePixelRatio, format.width / Math.max(1, cssWidth));
    const width = Math.max(1, Math.round(cssWidth * scale));
    const height = Math.max(1, Math.round((width * format.height) / format.width));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  setDisplay(display: DisplayOptions): void {
    const formatChanged = display.format !== this.display.format || display.hud !== this.display.hud;
    this.display = display;
    this.audio.setVolume(display.volume);
    if (display.audio && !this.audio.enabled) {
      void this.audio.enable().then(() => this.bindAudio());
    } else if (!display.audio && this.audio.enabled) {
      this.audio.disable();
      this.bindAudio();
    }
    this.loop.speed = display.speed;
    this.camera.options = { mode: display.camera, dynamicZoom: display.dynamicZoom };
    this.applyViewport();
    if (formatChanged && this.sim) this.camera.snap(this.sim);
  }

  /**
   * Build and start a simulation (or a whole tournament). Flags are preloaded
   * first, with a timeout, so the video never starts on placeholders.
   */
  async load(config: SimulationConfig, countries: Country[]): Promise<void> {
    const token = ++this.loadToken;
    this.countries = countries;
    this.baseConfig = config;
    this.update({ ...EMPTY_SNAPSHOT, phase: "loading", config });
    try {
      let first: SimulationConfig;
      let tournament: Tournament | null = null;
      let entrants: Country[];
      if (config.tournament) {
        tournament = new Tournament(config, config.tournament);
        const next = tournament.current();
        if (!next) throw new Error("Tournament has no heats");
        first = next.config;
        const codes = new Set(tournament.rounds[0]?.heats.flatMap((h) => h.countries));
        entrants = countries.filter((c) => codes.has(c.cca3));
      } else {
        first = config;
        entrants = selectParticipants(config, countries);
      }
      await this.atlas.preload(entrants, 6000);
      if (token !== this.loadToken) return;
      this.tournament = tournament;
      this.startSimulation(first);
    } catch (error) {
      console.error(error);
      this.update({ ...EMPTY_SNAPSHOT, phase: "error", config, error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Same config, same seed, from tick 0: an identical replay (whole tournament too). */
  restart(): Promise<void> {
    const config = this.baseConfig ?? this.snapshot.config;
    if (!config) return Promise.resolve();
    return this.load(config, this.countries);
  }

  setPaused(paused: boolean): void {
    this.loop.paused = paused;
    this.publish(true);
  }

  stepOnce(): void {
    if (!this.sim) return;
    this.loop.paused = true;
    this.loop.stepOnce();
    this.publish(true);
  }

  /** The live simulation, for tooling and debugging (e.g. window.__cbp). */
  get simulation(): Simulation | null {
    return this.sim;
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private startSimulation(config: SimulationConfig): void {
    const sim = createSimulation(config, this.countries);
    this.disposeSimulation();
    this.sim = sim;
    this.hud = new HudTracker(sim);
    this.replay = null;
    this.overlay = this.tournament
      ? { status: this.tournament.label(), winnerTitle: this.isFinalHeat() ? "CHAMPION" : "HEAT WINNER" }
      : undefined;
    this.bindEvents(sim);
    this.bindAudio();
    this.lastBanner = undefined;
    this.applyViewport();
    this.camera.snap(sim);
    this.loop.paused = false;
    this.loop.reset();
    this.publish(true);
  }

  private isFinalHeat(): boolean {
    return this.tournament?.current()?.round.advance === 0;
  }

  private step(): boolean {
    const sim = this.sim;
    if (!sim) return false;
    if (sim.finishedTick !== null) {
      const since = sim.tick - sim.finishedTick;
      const next = this.tournament?.current();
      // Tournaments roll straight into the next heat after a short outro.
      if (next && since > BETWEEN_HEATS_TICKS) {
        this.startSimulation(next.config);
        return true;
      }
      if (since > OUTRO_TICKS) return false;
    }
    sim.step();
    if (this.audio.enabled && sim.status === "running") {
      // Countdown beeps follow the HUD banner ("3", "2", "1", "GO!").
      const banner = sim.rules.hud().banner;
      if (banner !== this.lastBanner && banner && !banner.startsWith("ROUND")) {
        this.audio.play(banner === "GO!" ? "go" : "countdown");
      }
      this.lastBanner = banner;
    }
    return true;
  }

  private bindAudio(): void {
    this.detachAudio?.();
    this.detachAudio = null;
    const sim = this.sim;
    if (!sim || !this.audio.enabled) return;
    const width = viewportFor(this.display).width;
    this.detachAudio = this.audio.attach(sim, (x) => ((this.camera.worldToScreen(x, 0).x / width) * 2 - 1) * 0.7);
  }

  private render(alpha: number, dt: number): void {
    const sim = this.sim;
    const renderer = this.renderer;
    if (!sim || !renderer || !this.hud) return;
    this.camera.update(sim, alpha, dt);
    renderer.render({ sim, camera: this.camera, alpha, display: this.display, hud: this.hud, overlay: this.overlay });
    if (this.dirty || performance.now() - this.lastPublish > 500) this.publish(false);
  }

  private applyViewport(): void {
    this.camera.setViewport(viewportFor(this.display));
    if (this.canvas) this.resize(this.canvas.clientWidth, window.devicePixelRatio || 1);
  }

  private bindEvents(sim: Simulation): void {
    const mark = () => {
      this.dirty = true;
    };
    this.simListeners.push(
      sim.events.on("countryEliminated", mark),
      sim.events.on("countryFinished", mark),
      sim.events.on("leaderChanged", mark),
      sim.events.on("simulationFinished", ({ result }) => {
        this.tournament?.record(result);
        const key = JSON.stringify({ ...sim.config, countries: [...sim.config.countries].sort() });
        const previous = this.fingerprints.get(key);
        this.fingerprints.set(key, result.fingerprint);
        this.replay = previous === undefined ? null : previous === result.fingerprint ? "identical" : "different";
        this.publish(true);
      }),
    );
  }

  private disposeSimulation(): void {
    this.detachAudio?.();
    this.detachAudio = null;
    for (const off of this.simListeners) off();
    this.simListeners.length = 0;
    this.hud?.dispose();
    this.hud = null;
    this.sim?.destroy();
    this.sim = null;
  }

  private publish(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastPublish < PUBLISH_INTERVAL_MS) return;
    this.lastPublish = now;
    this.dirty = false;
    const sim = this.sim;
    if (!sim) return;
    const row = (b: Simulation["balls"][number]): RankingRow => ({
      cca3: b.code,
      cca2: b.country.cca2,
      name: b.name,
      emoji: b.country.flag.emoji,
      status: b.status,
      place: b.place,
    });
    this.update({
      phase: sim.status === "finished" ? "finished" : "running",
      paused: this.loop.paused,
      time: sim.time,
      alive: sim.aliveCount,
      total: sim.balls.length,
      leader: sim.leader ? row(sim.leader) : null,
      winner: sim.winner ? row(sim.winner) : null,
      ranking: (sim.status === "finished" ? sim.sortedByPlace() : sim.rules.rank()).map(row),
      result: sim.result,
      config: this.baseConfig ?? sim.config,
      scenario: sim.scenario,
      error: null,
      replay: this.replay,
      tournament: this.tournament?.summary() ?? null,
    });
  }

  private update(snapshot: ControllerSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}
