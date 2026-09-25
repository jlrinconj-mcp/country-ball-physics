import { TICK_DT } from "./physicsWorld";

export interface LoopHooks {
  /** Advance one fixed tick. Return false when there is nothing left to simulate. */
  step(): boolean;
  /** Draw; alpha interpolates between the last two ticks, dt is real seconds. */
  render(alpha: number, dt: number): void;
}

/** Real time credited per frame at most; longer stalls (tab switches) are dropped. */
const MAX_FRAME_SECONDS = 0.5;
/**
 * CPU time a frame may spend catching up on ticks. A time budget (rather
 * than a tick count) keeps playback real-time on slow or throttled frames
 * while avoiding a death spiral when the machine can't keep up.
 */
const STEP_BUDGET_MS = 30;

/**
 * Fixed-timestep loop with an accumulator. Real time only decides *how many*
 * ticks run per frame; each tick is always TICK_DT of simulated time, so
 * frame rate and playback speed never change the outcome.
 */
export class SimulationLoop {
  speed = 1;
  paused = false;
  private accumulator = 0;
  private last = 0;
  private handle = 0;
  private running = false;

  constructor(private readonly hooks: LoopHooks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.handle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.handle);
  }

  /** Forget accumulated time (after loading a new simulation). */
  reset(): void {
    this.accumulator = 0;
    this.last = performance.now();
  }

  /** Advance exactly one tick while paused (frame-by-frame inspection). */
  stepOnce(): void {
    this.hooks.step();
    this.hooks.render(1, 0);
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    const dt = Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - this.last) / 1000));
    this.last = now;

    if (!this.paused) {
      this.accumulator += dt * this.speed;
      const started = performance.now();
      while (this.accumulator >= TICK_DT) {
        if (!this.hooks.step()) {
          this.accumulator = 0;
          break;
        }
        this.accumulator -= TICK_DT;
        if (performance.now() - started > STEP_BUDGET_MS) {
          // Can't keep up: drop the backlog instead of spiralling.
          this.accumulator = Math.min(this.accumulator, TICK_DT);
          break;
        }
      }
    }

    const alpha = this.paused ? 1 : Math.min(1, this.accumulator / TICK_DT);
    this.hooks.render(alpha, dt);
    this.handle = requestAnimationFrame(this.frame);
  };
}
