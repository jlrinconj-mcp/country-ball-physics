import type { CountryBall } from "@/entities/CountryBall";
import type { Random } from "@/engine/random";
import type { Simulation } from "@/engine/simulation";
import type { ObstacleSpec, Vec2 } from "@/engine/types";
import { TICK_DT, TICK_RATE } from "@/engine/physicsWorld";

const TAU = Math.PI * 2;

export interface RingOptions {
  id: string;
  center: Vec2;
  radius: number;
  thickness: number;
  /** Angle of the gap's centre at motion time 0 (radians, canvas convention). */
  gapAngle: number;
  /** Gap width in radians. 0 = closed ring. */
  gap: number;
  /** Rotation speed in rad/s (positive = clockwise on screen). */
  speed: number;
}

/** A rotating ring with an opening, as a single kinematic obstacle. */
export function ringObstacle(o: RingOptions): ObstacleSpec {
  const half = Math.min(o.gap, TAU - 0.05) / 2;
  return {
    id: o.id,
    style: "ring",
    restitution: 1,
    friction: 0.02,
    shapes: [
      {
        kind: "arc",
        x: o.center.x,
        y: o.center.y,
        radius: o.radius,
        thickness: o.thickness,
        start: o.gapAngle + half,
        end: o.gapAngle + TAU - half,
        resolution: 120,
      },
    ],
    motion: { type: "rotate", speed: o.speed, pivot: o.center },
  };
}

/** Periodic seeded kicks that keep balls lively ("chaos"). */
export function createChaos(sim: Simulation, random: Random, options: { interval?: number; upward?: number } = {}) {
  const intervalTicks = Math.round((options.interval ?? 1.2) * TICK_RATE);
  const upward = options.upward ?? 0.6;
  return (intensity: number) => {
    const chaos = sim.config.physics.chaos * intensity;
    if (chaos <= 0 || sim.tick === 0 || sim.tick % intervalTicks !== 0) return;
    const alive = sim.aliveBalls;
    if (alive.length === 0) return;
    const count = Math.max(1, Math.ceil(alive.length * 0.25 * Math.min(1, chaos)));
    for (const ball of random.sample(alive, count)) {
      const angle = -Math.PI / 2 + random.float(-1.2, 1.2);
      const magnitude = random.float(6, 14) * Math.min(1.5, 0.4 + chaos);
      sim.nudge(ball, Math.cos(angle) * magnitude, Math.sin(angle) * magnitude * (1 + upward));
    }
  };
}

/** Survivors first (by `aliveOrder`), then eliminated balls, latest out first. */
export function rankSurvival(balls: CountryBall[], aliveOrder: (a: CountryBall, b: CountryBall) => number) {
  return [...balls].sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.alive) return aliveOrder(a, b) || a.id - b.id;
    return (b.eliminatedTick ?? 0) - (a.eliminatedTick ?? 0) || (a.place ?? 0) - (b.place ?? 0) || a.id - b.id;
  });
}

/**
 * Eliminate the given candidates (farthest-first ordering is up to the
 * caller) but never the last ball alive; declare it the winner instead.
 */
export function eliminateKeepingOne(sim: Simulation, candidates: CountryBall[], options: { fall?: boolean } = {}): void {
  for (const ball of candidates) {
    if (sim.aliveCount <= 1) break;
    sim.eliminate(ball, options);
  }
  if (sim.aliveCount === 1) sim.declareWinner(sim.aliveBalls[0]);
}

export function autoRadius(area: number, count: number, fill: number, min: number, max: number): number {
  const r = Math.sqrt((fill * area) / Math.PI / Math.max(1, count));
  return Math.min(max, Math.max(min, r));
}

export interface StartGate {
  /** Start opening at simulated time `at` (default: now). */
  open(at?: number): void;
  /** Snap shut (new round). */
  close(): void;
  /** Pose the gate for the coming tick. Call from `beforeStep`. */
  update(): void;
  readonly opening: boolean;
}

/**
 * The two sliding halves of a start gate (`…gate-l` / `…gate-r`, manual
 * motion). Modes decide when it opens, and can close it again between rounds.
 */
export function startGate(sim: Simulation, duration = 0.45): StartGate {
  const halves = sim.obstacles
    .filter((o) => /(^|-)gate-[lr]$/.test(o.id) && o.motion?.type === "manual")
    .map((o) => {
      const shape = o.spec.shapes[0];
      const travel = (shape && shape.kind === "rect" ? shape.w : 0) + 60;
      return { obstacle: o, dx: (o.id.endsWith("l") ? -1 : 1) * travel };
    });
  let openedAt: number | null = null;
  const set = (amount: number) => {
    for (const { obstacle, dx } of halves) obstacle.manualOffset = { x: dx * amount, y: 0 };
  };
  return {
    open(at = sim.time) {
      openedAt ??= at;
    },
    close() {
      openedAt = null;
      set(0);
    },
    update() {
      if (openedAt === null) return set(0);
      // Pose for the end of the coming tick.
      const t = Math.min(1, Math.max(0, (sim.time + TICK_DT - openedAt) / duration));
      set(t * t * (3 - 2 * t));
    },
    get opening() {
      return openedAt !== null;
    },
  };
}
