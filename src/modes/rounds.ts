import { TICK_RATE } from "@/engine/physicsWorld";
import type { Simulation } from "@/engine/simulation";

export type RoundPhase = "intro" | "racing" | "result";

export interface RoundManagerOptions {
  /** Seconds between setting a round up and the start (banners, countdown). */
  intro(round: number): number;
  /** Seconds a round may race before it has to be decided. */
  limit: number;
  /** Seconds the outcome stays on screen before the next round. */
  result: number;
  /** Place the field for a round (the gate is shut). */
  onSetup(round: number): void;
  /** The intro is over: open the gate. */
  onStart(round: number): void;
  /** The race hit the limit: decide the round now. */
  onLimit(round: number): void;
}

/**
 * Round-based flow for any mode: intro → racing → result → next round, on
 * simulated time, so it replays identically. The mode decides what a round
 * is and calls `end()` once it's decided; the manager handles timing, the
 * `roundStarted` event and camera cuts.
 */
export class RoundManager {
  round = 0;
  phase: RoundPhase = "intro";
  private phaseTick = 0;

  constructor(
    private readonly sim: Simulation,
    private readonly options: RoundManagerOptions,
  ) {}

  /** Seconds since the current phase began. */
  get elapsed(): number {
    return (this.sim.tick - this.phaseTick) / TICK_RATE;
  }

  get racing(): boolean {
    return this.phase === "racing";
  }

  /** Advance the phase machine. Call from `beforeStep`. */
  update(): void {
    if (this.round === 0) {
      this.begin();
      return;
    }
    if (this.phase === "intro" && this.elapsed >= this.options.intro(this.round)) {
      this.enter("racing");
      this.options.onStart(this.round);
    } else if (this.phase === "racing" && this.elapsed >= this.options.limit) {
      this.options.onLimit(this.round);
      this.end();
    } else if (this.phase === "result" && this.elapsed >= this.options.result && this.sim.status === "running") {
      this.begin();
    }
  }

  /** The current round is decided: show the result, then move on. */
  end(): void {
    if (this.phase === "racing") this.enter("result");
  }

  private begin(): void {
    this.round++;
    this.enter("intro");
    this.sim.cameraCut++;
    this.options.onSetup(this.round);
    this.sim.events.emit("roundStarted", { round: this.round, remaining: this.sim.aliveCount, tick: this.sim.tick });
  }

  private enter(phase: RoundPhase): void {
    this.phase = phase;
    this.phaseTick = this.sim.tick;
  }
}
