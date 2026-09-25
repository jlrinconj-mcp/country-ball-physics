import { TICK_DT } from "./physicsWorld";

export interface LoopHooks {
  /** Advance one fixed tick. Return false when there is nothing left to simulate. */
  step(): boolean;
  /** Draw; alpha interpolates between the last two ticks, dt is real seconds. */
  render(alpha: number, dt: number): void;
}

/** Most ticks run in one frame before we drop time (avoids a death spiral). */
const MAX_TICKS_PER_FRAME = 12;

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
    const dt = Math.min(0.25, Math.max(0, (now - this.last) / 1000));
    this.last = now;

    if (!this.paused) {
      this.accumulator += dt * this.speed;
      let ticks = 0;
      while (this.accumulator >= TICK_DT && ticks < MAX_TICKS_PER_FRAME) {
        if (!this.hooks.step()) {
          this.accumulator = 0;
          break;
        }
        this.accumulator -= TICK_DT;
        ticks++;
      }
      if (ticks === MAX_TICKS_PER_FRAME) this.accumulator = Math.min(this.accumulator, TICK_DT);
    }

    const alpha = this.paused ? 1 : Math.min(1, this.accumulator / TICK_DT);
    this.hooks.render(alpha, dt);
    this.handle = requestAnimationFrame(this.frame);
  };
}
