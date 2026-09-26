import { TICK_DT } from "./physicsWorld";

/** Time source and frame scheduler (injectable for tests). */
export interface LoopClock {
  now(): number;
  request(callback: (time: number) => void): number;
  cancel(handle: number): void;
}

const browserClock: LoopClock = {
  now: () => performance.now(),
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export interface LoopHooks {
  /** Advance one fixed tick. Return false when there is nothing left to simulate. */
  step(): boolean;
  /** Draw; alpha interpolates between the last two ticks, dt is real seconds. */
  render(alpha: number, dt: number): void;
}

/**
 * Real time credited per frame at most. Up to this, playback stays real-time
 * even on very slow frames (throttled previews, weak phones); longer stalls
 * (switching tabs) are dropped instead of fast-forwarded.
 */
const MAX_FRAME_SECONDS = 1;
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

  constructor(
    private readonly hooks: LoopHooks,
    private readonly clock: LoopClock = browserClock,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = this.clock.now();
    this.handle = this.clock.request(this.frame);
  }

  stop(): void {
    this.running = false;
    this.clock.cancel(this.handle);
  }

  /** Forget accumulated time (after loading a new simulation). */
  reset(): void {
    this.accumulator = 0;
    this.last = this.clock.now();
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
      const started = this.clock.now();
      while (this.accumulator >= TICK_DT) {
        if (!this.hooks.step()) {
          this.accumulator = 0;
          break;
        }
        this.accumulator -= TICK_DT;
        if (this.clock.now() - started > STEP_BUDGET_MS) {
          // Can't keep up: drop the backlog instead of spiralling.
          this.accumulator = Math.min(this.accumulator, TICK_DT);
          break;
        }
      }
    }

    const alpha = this.paused ? 1 : Math.min(1, this.accumulator / TICK_DT);
    this.hooks.render(alpha, dt);
    this.handle = this.clock.request(this.frame);
  };
}
