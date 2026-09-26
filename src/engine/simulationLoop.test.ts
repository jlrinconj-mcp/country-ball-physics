import { describe, expect, it } from "vitest";
import { TICK_RATE } from "./physicsWorld";
import { SimulationLoop, type LoopClock } from "./simulationLoop";

/** Deterministic stand-in for performance.now + requestAnimationFrame. */
class FakeClock implements LoopClock {
  time = 0;
  private callback: ((t: number) => void) | null = null;
  now = () => this.time;
  request = (cb: (t: number) => void) => {
    this.callback = cb;
    return 1;
  };
  cancel = () => {
    this.callback = null;
  };
  /** Advance wall time by `ms` and deliver one animation frame. */
  frame(ms: number) {
    this.time += ms;
    const cb = this.callback;
    this.callback = null;
    cb?.(this.time);
  }
}

function run(options: { fps: number; seconds: number; speed?: number; stepCostMs?: number }) {
  const clock = new FakeClock();
  let ticks = 0;
  const alphas: number[] = [];
  const loop = new SimulationLoop(
    {
      step: () => {
        ticks++;
        clock.time += options.stepCostMs ?? 0;
        return true;
      },
      render: (alpha) => alphas.push(alpha),
    },
    clock,
  );
  loop.speed = options.speed ?? 1;
  loop.start();
  const frameMs = 1000 / options.fps;
  const frames = Math.round((options.seconds * 1000) / frameMs);
  for (let i = 0; i < frames; i++) clock.frame(frameMs);
  loop.stop();
  return { ticks, alphas };
}

describe("SimulationLoop", () => {
  it.each([144, 60, 30, 5, 1.5])("plays in real time at %s fps", (fps) => {
    const { ticks } = run({ fps, seconds: 20 });
    expect(Math.abs(ticks - 20 * TICK_RATE)).toBeLessThanOrEqual(2);
  });

  it("scales with playback speed without changing the tick size", () => {
    expect(run({ fps: 60, seconds: 10, speed: 2 }).ticks).toBeCloseTo(1200, -1);
    expect(run({ fps: 60, seconds: 10, speed: 0.25 }).ticks).toBeCloseTo(150, -1);
  });

  it("keeps interpolation alpha within [0, 1]", () => {
    const { alphas } = run({ fps: 144, seconds: 5 });
    expect(Math.min(...alphas)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...alphas)).toBeLessThanOrEqual(1);
  });

  it("drops long stalls instead of fast-forwarding", () => {
    const clock = new FakeClock();
    let ticks = 0;
    const loop = new SimulationLoop({ step: () => (ticks++, true), render: () => {} }, clock);
    loop.start();
    clock.frame(16);
    clock.frame(5000); // tab was in the background for 5 s
    expect(ticks).toBeLessThanOrEqual(TICK_RATE + 2);
  });

  it("never spirals when steps are too expensive for real time", () => {
    // 20 ms per tick can't keep 60 ticks/s; each frame must stay bounded.
    const clock = new FakeClock();
    let ticks = 0;
    let maxFrameWork = 0;
    const loop = new SimulationLoop(
      {
        step: () => {
          ticks++;
          clock.time += 20;
          return true;
        },
        render: () => {},
      },
      clock,
    );
    loop.start();
    for (let i = 0; i < 100; i++) {
      const before = clock.time;
      clock.frame(16);
      maxFrameWork = Math.max(maxFrameWork, clock.time - before - 16);
    }
    expect(maxFrameWork).toBeLessThanOrEqual(60);
    expect(ticks).toBeGreaterThan(50);
  });

  it("does not advance while paused", () => {
    const clock = new FakeClock();
    let ticks = 0;
    let renders = 0;
    const loop = new SimulationLoop({ step: () => (ticks++, true), render: () => renders++ }, clock);
    loop.paused = true;
    loop.start();
    for (let i = 0; i < 60; i++) clock.frame(16);
    expect(ticks).toBe(0);
    expect(renders).toBe(60);
  });
});
