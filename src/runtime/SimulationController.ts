import { AudioEngine } from "@/audio/audioEngine";
import type { Country } from "@/countries/countryTypes";
import { Camera } from "@/engine/camera";
import { DEFAULT_CONFIG } from "@/engine/defaults";
import { TICK_DT, TICK_RATE } from "@/engine/physicsWorld";
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
import type { ChatMessage } from "@/live/commands";
import { LiveSession, type LiveOptions, type LiveView } from "@/live/session";
import { createSource, type ChatSource, type SourceConfig, type SourceStatus } from "@/live/sources";
import type { LiveFrame } from "@/render/liveRenderer";
import { localVideoExporter, VideoExportNotFoundError } from "@/export/client";
import { validateExportRequest } from "@/export/configuration";
import type { VideoExport, VideoExportAdapter } from "@/export/types";

/** Keep animating this long after the winner is declared, then idle. */
const OUTRO_TICKS = 6 * TICK_RATE;
/** Pause between tournament heats (the winner card stays up meanwhile). */
const BETWEEN_HEATS_TICKS = 4 * TICK_RATE;
const PUBLISH_INTERVAL_MS = 200;
/** Where live viewers' points are kept between streams. */
const SCORES_KEY = "cbp-live-scores";

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
  recording: boolean;
  videoExport: VideoExport | null;
  /** Smoothed display frame rate (0 until measured). */
  fps: number;
  live: LiveSnapshot | null;
}

export interface LiveSnapshot {
  view: LiveView;
  chat: SourceStatus & { label: string | null };
  /** Latest raw chat messages, newest last. */
  messages: ChatMessage[];
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
  recording: false,
  videoExport: null,
  fps: 0,
  live: null,
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
  private sounds: { afterStep(): void; detach(): void } | null = null;
  private recording = false;
  private videoExport: VideoExport | null = null;
  private exportAbort: AbortController | null = null;
  private exportToken = 0;
  private exportRevision = 0;
  private exportCreation: Promise<VideoExport> | null = null;
  private pauseOperation: Promise<void> = Promise.resolve();
  private pendingPause = 0;
  private deleting = false;
  private error: string | null = null;
  private fps = 0;
  private replay: ControllerSnapshot["replay"] = null;
  private live: LiveSession | null = null;
  private liveBase: SimulationConfig | null = null;
  private liveLoading = false;
  private liveSource: ChatSource | null = null;
  private liveStatus: SourceStatus & { label: string | null } = { state: "closed", label: null };
  private readonly liveBoosts = new Map<string, number>();
  private liveMessages: ChatMessage[] = [];
  private countryIndex = new Map<string, Country>();

  constructor(private readonly exporter: VideoExportAdapter = localVideoExporter) {
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
    ++this.loadToken;
    ++this.exportToken;
    this.exportAbort?.abort();
    this.disconnectChat();
    this.saveScores();
    this.live = null;
    this.liveBase = null;
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
    // Never render above the target output resolution; record at exactly it.
    const scale = Math.min(devicePixelRatio, format.width / Math.max(1, cssWidth));
    const width = Math.max(1, Math.round(cssWidth * scale));
    const height = Math.max(1, Math.round((width * format.height) / format.width));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  setDisplay(display: DisplayOptions): void {
    if (this.recording) return;
    const formatChanged = display.format !== this.display.format || display.hud !== this.display.hud;
    this.display = display;
    this.audio.setVolume(display.volume);
    if (display.audio && !this.audio.enabled) {
      void this.audio.enable().then(() => {
        if (this.display.audio && this.audio.enabled) this.bindAudio();
      });
    } else if (!display.audio) {
      this.audio.disable();
      this.bindAudio();
    }
    if (!this.recording && !this.live) this.loop.speed = display.speed;
    this.camera.options = { mode: display.camera, dynamicZoom: display.dynamicZoom };
    this.applyViewport();
    if (formatChanged && this.sim) this.camera.snap(this.sim);
  }

  /**
   * Prepare a simulation or tournament. A preview tolerates flags still
   * loading; Play requires every real flag before it creates a video job.
   */
  async load(config: SimulationConfig, countries: Country[], paused = false, requireFlags = false): Promise<void> {
    if (this.recording && !requireFlags) return;
    const token = ++this.loadToken;
    this.loop.paused = true;
    this.loop.reset();
    this.disposeSimulation();
    this.tournament = null;
    this.error = null;
    if (countries !== this.countries) this.countryIndex = new Map(countries.map((c) => [c.cca3, c]));
    this.countries = countries;
    this.baseConfig = config;
    this.update({ ...EMPTY_SNAPSHOT, phase: "loading", paused: true, config, recording: this.recording, videoExport: this.videoExport });
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
      const flags = await this.atlas.preload(entrants, requireFlags ? 20000 : 5000);
      if (requireFlags && (flags.loaded !== entrants.length || flags.failed)) throw new Error("No se cargaron todas las banderas. Reintenta cuando estén disponibles.");
      if (token !== this.loadToken) return;
      this.tournament = tournament;
      this.startSimulation(first, paused);
    } catch (error) {
      if (token !== this.loadToken) return;
      console.error(error);
      this.error = error instanceof Error ? error.message : String(error);
      this.update({ ...EMPTY_SNAPSHOT, phase: "error", paused: true, config, recording: this.recording, videoExport: this.videoExport, error: this.error });
    }
  }

  /** Animate the draft without creating a video, so it can be reviewed first. */
  async preview(config: SimulationConfig, countries: Country[]): Promise<void> {
    if (this.recording || this.live) return;
    this.videoExport = null;
    await this.load(config, countries);
  }

  /** Same config, same seed, from tick 0: an identical replay (whole tournament too). */
  restart(): Promise<void> {
    if (this.recording || this.live) return Promise.resolve();
    const config = this.baseConfig ?? this.snapshot.config;
    if (!config) return Promise.resolve();
    this.videoExport = null;
    return this.load(config, this.countries, true);
  }

  get canRecord(): boolean {
    return typeof window !== "undefined" && typeof fetch !== "undefined";
  }

  /**
   * Export the current run, including recorded live inputs, through the same
   * persistent workflow as Play. Kept for existing runtime integrations.
   */
  async record(): Promise<void> {
    const config = this.baseConfig;
    if (config) await this.playAndRecord(config, this.countries);
  }

  /** Play commits the draft once and starts a persistent, local MP4 export. */
  async playAndRecord(config: SimulationConfig, countries: Country[]): Promise<void> {
    if (this.recording || this.live || this.deleting) return;
    const token = ++this.exportToken;
    try {
      const request = validateExportRequest({ config, display: this.display }, countries);
      this.exportAbort?.abort();
      this.exportCreation = null;
      this.pauseOperation = Promise.resolve();
      this.pendingPause = 0;
      ++this.exportRevision;
      this.error = null;
      this.recording = true;
      this.videoExport = null;
      await this.load(request.config, countries, true, true);
      if (token !== this.exportToken) return;
      if (this.snapshot.phase === "error") throw new Error(this.snapshot.error ?? "No se pudo iniciar la simulación.");
      const creation = this.exporter.create(request);
      this.exportCreation = creation;
      const video = await creation;
      if (token !== this.exportToken) return;
      this.exportCreation = null;
      this.loop.speed = 1;
      this.applyExport(video);
      if (this.recording) this.startExportMonitor(video.id, token);
    } catch (error) {
      if (token !== this.exportToken) return;
      this.exportCreation = null;
      this.recording = false;
      this.loop.paused = true;
      this.loop.speed = this.display.speed;
      this.loop.reset();
      this.error = error instanceof Error ? error.message : String(error);
      this.publish(true);
    }
  }

  private startExportMonitor(id: string, token: number): void {
    this.exportAbort?.abort();
    this.exportAbort = new AbortController();
    void this.monitorExport(id, token, this.exportAbort.signal);
  }

  private async monitorExport(id: string, token: number, signal: AbortSignal): Promise<void> {
    while (!signal.aborted && token === this.exportToken) {
      const revision = this.exportRevision;
      try {
        const video = await this.exporter.get(id, signal);
        if (signal.aborted || token !== this.exportToken || this.videoExport?.id !== id) return;
        // An older poll must never undo a pause/resume request or deletion.
        if (revision === this.exportRevision && this.pendingPause === 0) {
          this.applyExport(video);
          if (!this.recording) return;
        }
      } catch (error) {
        if (signal.aborted || token !== this.exportToken) return;
        if (error instanceof VideoExportNotFoundError) {
          this.markExportMissing(id);
          return;
        }
        this.error = error instanceof Error ? error.message : String(error);
        this.publish(true);
      }
      await new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
        const timer = setTimeout(finish, 1000);
        signal.addEventListener("abort", finish, { once: true });
      });
    }
  }

  /** Pause both the canvas and its encoder; preview pauses remain local. */
  async setPaused(paused: boolean): Promise<void> {
    if (this.deleting || this.snapshot.phase === "loading") return;
    const video = this.videoExport;
    if (!this.recording || !video) {
      this.loop.paused = paused || this.outroFinished() || video?.status === "complete" || video?.status === "failed";
      this.loop.reset();
      this.publish(true);
      return;
    }
    const token = this.exportToken;
    const revision = ++this.exportRevision;
    this.loop.paused = paused || this.outroFinished();
    this.loop.reset();
    ++this.pendingPause;
    this.publish(true);
    const operation = this.pauseOperation.then(async () => {
      if (token !== this.exportToken || this.videoExport?.id !== video.id) return;
      try {
        const updated = await this.exporter.setPaused(video.id, paused);
        if (token !== this.exportToken || this.videoExport?.id !== video.id) return;
        if (revision !== this.exportRevision) {
          // Retain the last acknowledged server state for rollback if the
          // next queued control request fails, without undoing its canvas state.
          this.videoExport = updated;
          return;
        }
        this.error = null;
        this.applyExport(updated);
      } catch (error) {
        if (token !== this.exportToken || revision !== this.exportRevision) return;
        if (error instanceof VideoExportNotFoundError) {
          this.markExportMissing(video.id);
          throw error;
        }
        this.loop.paused = this.videoExport?.status === "paused" || this.outroFinished();
        this.error = error instanceof Error ? error.message : String(error);
        this.publish(true);
        throw error;
      } finally {
        if (token === this.exportToken) --this.pendingPause;
      }
    });
    this.pauseOperation = operation.catch(() => {});
    await operation;
  }

  /** Cancel creation or delete an active job, then return to its editable draft. */
  async deleteRecording(): Promise<void> {
    if ((!this.recording && !this.exportCreation) || this.deleting) return;
    this.deleting = true;
    const token = ++this.exportToken;
    ++this.loadToken;
    ++this.exportRevision;
    this.exportAbort?.abort();
    const creation = this.exportCreation;
    this.exportCreation = null;
    const config = this.baseConfig;
    let video = this.videoExport;
    this.loop.paused = true;
    this.loop.reset();
    this.publish(true);
    try {
      if (creation) {
        // A rejected create has no job to remove; a successful one must be
        // deleted even if the user cancelled before its response arrived.
        video = await creation.catch(() => null);
      }
      if (video) await this.exporter.delete(video.id);
      if (token !== this.exportToken) return;
      this.recording = false;
      this.videoExport = null;
      this.pendingPause = 0;
      this.loop.speed = this.display.speed;
      this.error = null;
      if (config) await this.load(config, this.countries, true);
      else this.update({ ...EMPTY_SNAPSHOT });
    } catch (error) {
      if (token !== this.exportToken) return;
      if (error instanceof VideoExportNotFoundError && video) {
        this.markExportMissing(video.id);
        return;
      }
      this.error = error instanceof Error ? error.message : String(error);
      if (video) {
        this.applyExport(video);
        if (this.recording) this.startExportMonitor(video.id, token);
      } else {
        this.recording = false;
        this.loop.speed = this.display.speed;
        this.publish(true);
      }
      throw error;
    } finally {
      if (token === this.exportToken) this.deleting = false;
    }
  }

  /** Remove a deleted library entry from the current view as well. */
  forgetExport(id: string): void {
    if (this.videoExport?.id !== id) return;
    this.clearExportReference();
    this.publish(true);
  }

  private clearExportReference(): void {
    ++this.exportToken;
    ++this.exportRevision;
    this.exportAbort?.abort();
    this.recording = false;
    this.videoExport = null;
    this.pendingPause = 0;
    this.loop.paused = true;
    this.loop.speed = this.display.speed;
    this.loop.reset();
    this.error = null;
  }

  private markExportMissing(id: string): void {
    if (this.videoExport && this.videoExport.id !== id) return;
    this.clearExportReference();
    this.deleting = false;
    this.error = "Esta grabación fue eliminada desde otra ventana. Puedes crear una nueva.";
    this.publish(true);
  }

  private applyExport(video: VideoExport): void {
    this.videoExport = video;
    this.recording = video.status === "queued" || video.status === "recording" || video.status === "paused";
    this.loop.paused = !this.recording || video.status === "paused" || this.outroFinished();
    if (!this.recording) {
      this.loop.speed = this.display.speed;
      this.loop.reset();
    }
    if (video.error) this.error = video.error;
    this.publish(true);
  }

  private outroFinished(): boolean {
    return !!this.sim && this.sim.finishedTick !== null &&
      (!this.tournament || this.tournament.finished) && this.sim.tick - this.sim.finishedTick >= OUTRO_TICKS;
  }

  stepOnce(): void {
    if (!this.sim || this.recording) return;
    this.loop.paused = true;
    this.loop.stepOnce();
    this.publish(true);
  }

  /** The live simulation, for tooling and debugging (e.g. window.__cbp). */
  get simulation(): Simulation | null {
    return this.sim;
  }

  // ── Live mode ───────────────────────────────────────────────────────────

  /**
   * Run the canvas as a live game show: lobby (viewers join and vote), the
   * voted game, results with points, and again. `base` supplies everything
   * the vote doesn't decide (physics overrides, time limit…).
   */
  startLive(options: Omit<LiveOptions, "fill"> & { fill?: string[] }, base: SimulationConfig, countries: Country[]): void {
    this.stopLive();
    if (countries !== this.countries) this.countryIndex = new Map(countries.map((c) => [c.cca3, c]));
    this.countries = countries;
    const fill = options.fill?.length ? options.fill : countries.filter((c) => c.sovereign).map((c) => c.cca3);
    const live = new LiveSession(countries, { ...options, fill });
    try {
      const saved = window.localStorage.getItem(SCORES_KEY);
      if (saved) live.importScores(JSON.parse(saved));
    } catch {
      // No storage (private window…): points last for this stream only.
    }
    this.live = live;
    this.liveBase = base;
    this.loop.speed = 1;
    this.loop.paused = false;
    void this.atlas.preload(countries.filter((c) => fill.includes(c.cca3)), 6000);
    this.publish(true);
  }

  stopLive(): void {
    this.disconnectChat();
    this.saveScores();
    this.live = null;
    this.liveBase = null;
    this.liveLoading = false;
    this.liveBoosts.clear();
    this.liveMessages = [];
    this.loop.speed = this.display.speed;
    this.update({ ...this.snapshot, live: null });
  }

  get liveRunning(): boolean {
    return this.live !== null;
  }

  /** Host shortcut: end the lobby now. */
  startLiveGameNow(): void {
    this.live?.startNow();
  }

  connectChat(config: SourceConfig): void {
    this.disconnectChat();
    const source = createSource(config);
    this.liveSource = source;
    this.liveStatus = { state: "connecting", label: source.label };
    source.connect(
      (message) => {
        if (this.liveSource === source) this.chat(message);
      },
      (status) => {
        if (this.liveSource !== source) return;
        this.liveStatus = { ...status, label: source.label };
        this.publish(true);
      },
    );
    this.publish(true);
  }

  disconnectChat(): void {
    this.liveSource?.disconnect();
    this.liveSource = null;
    this.liveStatus = { state: "closed", label: null };
  }

  /** A chat message from any source (or the test console). */
  chat(message: ChatMessage): void {
    const live = this.live;
    if (!live) return;
    this.liveMessages = [...this.liveMessages.slice(-29), message];
    const before = live.view().teams.length;
    for (const action of live.handle(message)) {
      if (action.type === "boost") this.sim?.input("boost", action.cca3);
    }
    // A new team in the lobby: get its flag ready.
    const teams = live.view().teams;
    if (teams.length > before) void this.atlas.preload(teams.map((t) => this.countryIndex.get(t.cca3)).filter((c): c is Country => !!c), 3000);
    if (this.audio.enabled && live.phase === "lobby" && teams.length > before) this.audio.play("leader", { intensity: 0.6 });
    this.dirty = true;
  }

  private stepLive(live: LiveSession): boolean {
    const before = Math.ceil(live.view().countdown);
    const signal = live.advance(TICK_DT);
    if (signal === "start") void this.startLiveGame(live);
    if (live.phase === "lobby") {
      // Beeps for the last five seconds of the lobby.
      const left = Math.ceil(live.view().countdown);
      if (this.audio.enabled && left !== before && left <= 5 && left > 0) this.audio.play("countdown");
      return true;
    }
    const sim = this.sim;
    if (!sim || this.liveLoading) return true;
    if (sim.finishedTick === null || sim.tick - sim.finishedTick < OUTRO_TICKS) {
      sim.step();
      this.sounds?.afterStep();
    }
    return true;
  }

  private async startLiveGame(live: LiveSession): Promise<void> {
    const config = live.startConfig(this.liveBase ?? this.baseConfig ?? DEFAULT_CONFIG);
    this.liveLoading = true;
    this.liveBoosts.clear();
    await this.load(config, this.countries);
    if (this.live !== live) return;
    this.liveLoading = false;
    const sim = this.sim;
    if (!sim) return live.cancel();
    this.loop.speed = 1;
    this.simListeners.push(
      sim.events.on("boosted", ({ ball, tick }) => this.liveBoosts.set(ball.code, tick * TICK_DT)),
      sim.events.on("simulationFinished", ({ result }) => {
        live.finish(result);
        this.saveScores();
        // "Record video" now replays this game, viewers' boosts included.
        this.baseConfig = { ...config, inputs: [...sim.inputs] };
      }),
    );
  }

  private liveFrame(live: LiveSession): LiveFrame {
    return { view: live.view(), countries: this.countryIndex, team: (cca3) => live.team(cca3), boosts: this.liveBoosts };
  }

  private saveScores(): void {
    if (!this.live) return;
    try {
      window.localStorage.setItem(SCORES_KEY, JSON.stringify(this.live.exportScores()));
    } catch {
      // Storage unavailable: nothing to keep.
    }
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private startSimulation(config: SimulationConfig, paused = false): void {
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
    this.applyViewport();
    this.camera.snap(sim);
    this.loop.paused = paused;
    this.loop.reset();
    this.publish(true);
  }

  private isFinalHeat(): boolean {
    return this.tournament?.current()?.round.advance === 0;
  }

  private step(): boolean {
    if (this.live) return this.stepLive(this.live);
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
      if (since >= OUTRO_TICKS) {
        this.loop.paused = true;
        this.publish(true);
        return false;
      }
    }
    sim.step();
    this.sounds?.afterStep();
    return true;
  }

  private bindAudio(): void {
    this.sounds?.detach();
    this.sounds = null;
    const sim = this.sim;
    if (!sim || !this.audio.enabled) return;
    const width = viewportFor(this.display).width;
    this.sounds = this.audio.attach(sim, (x) => ((this.camera.worldToScreen(x, 0).x / width) * 2 - 1) * 0.7);
  }

  private render(alpha: number, dt: number): void {
    // Exponential moving average of the frame rate (ignores idle gaps).
    if (dt > 0 && dt < 1) this.fps = this.fps === 0 ? 1 / dt : this.fps * 0.9 + (1 / dt) * 0.1;
    const sim = this.sim;
    const renderer = this.renderer;
    if (renderer && this.live && (this.live.phase === "lobby" || !sim || this.liveLoading)) {
      renderer.renderLobby(this.liveFrame(this.live), this.display, this.live.clock);
      if (performance.now() - this.lastPublish > 250) this.publish(true);
      return;
    }
    if (!sim || !renderer || !this.hud) return;
    this.camera.update(sim, alpha, dt);
    renderer.render({ sim, camera: this.camera, alpha, display: this.display, hud: this.hud, overlay: this.overlay, live: this.live ? this.liveFrame(this.live) : undefined });
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
    this.sounds?.detach();
    this.sounds = null;
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
    const live: LiveSnapshot | null = this.live ? { view: this.live.view(), chat: { ...this.liveStatus }, messages: [...this.liveMessages] } : null;
    if (!sim) {
      if (live) this.update({ ...this.snapshot, live });
      else this.update({ ...this.snapshot, paused: this.loop.paused, recording: this.recording, videoExport: this.videoExport, error: this.error });
      return;
    }
    const row = (b: Simulation["balls"][number]): RankingRow => ({
      cca3: b.code,
      cca2: b.country.cca2,
      name: b.name,
      emoji: b.country.flag.emoji,
      status: b.status,
      place: b.place,
    });
    const exportStatus = this.live ? null : this.videoExport?.status;
    this.update({
      phase: exportStatus === "failed" ? "error" :
        exportStatus === "complete" || (sim.status === "finished" && (!this.tournament || this.tournament.finished)) ? "finished" : "running",
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
      error: this.error,
      replay: this.replay,
      tournament: this.tournament?.summary() ?? null,
      recording: this.recording,
      videoExport: this.videoExport,
      fps: Math.round(this.fps),
      live,
    });
  }

  private update(snapshot: ControllerSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}
