import type { Random } from "@/engine/random";
import type { WorldLayout } from "@/engine/types";
import { ringObstacle, type RingOptions } from "./shared";

/**
 * Ring arenas (the Last Country Standing "circle"): nested spinning rings with
 * gaps. Any mode can play on them; see `course.ts` for what escaping means.
 */
const WIDTH = 1080;
const HEIGHT = 1920;
export const RING_CENTER = { x: WIDTH / 2, y: 900 };
const CENTER = RING_CENTER;
const DEG = Math.PI / 180;

export interface RingPlan extends RingOptions {
  /** Gap grows to this over time (radians). */
  maxGap: number;
}

/** Seeded variation: each seed spins the rings differently. */
export function ringsFor(scenario: string, ballRadius: number, random: Random): RingPlan[] {
  const direction = random.sign();
  return baseRings(scenario, ballRadius).map((ring) => ({
    ...ring,
    gapAngle: ring.gapAngle + random.float(-0.6, 0.6),
    speed: ring.speed * direction * random.float(0.85, 1.2),
  }));
}

function baseRings(scenario: string, ballRadius: number): RingPlan[] {
  // Gap must comfortably pass a ball, whatever its size.
  const gapFor = (radius: number) => Math.max(10 * DEG, (ballRadius * 2.8) / radius);
  switch (scenario) {
    case "double-ring":
      return [
        { id: "ring-inner", center: CENTER, radius: 300, thickness: 16, gapAngle: -Math.PI / 2, gap: gapFor(300), maxGap: 140 * DEG, speed: 0.75 },
        { id: "ring-outer", center: CENTER, radius: 470, thickness: 18, gapAngle: Math.PI / 2, gap: gapFor(470), maxGap: 120 * DEG, speed: -0.45 },
      ];
    case "triple-ring":
      return [
        { id: "ring-1", center: CENTER, radius: 230, thickness: 14, gapAngle: -Math.PI / 2, gap: gapFor(230), maxGap: 150 * DEG, speed: 0.9 },
        { id: "ring-2", center: CENTER, radius: 350, thickness: 16, gapAngle: Math.PI / 6, gap: gapFor(350), maxGap: 140 * DEG, speed: -0.6 },
        { id: "ring-3", center: CENTER, radius: 470, thickness: 18, gapAngle: (5 * Math.PI) / 6, gap: gapFor(470), maxGap: 120 * DEG, speed: 0.4 },
      ];
    default:
      return [
        { id: "ring", center: CENTER, radius: 460, thickness: 18, gapAngle: -Math.PI / 2, gap: gapFor(460), maxGap: 130 * DEG, speed: 0.55 },
      ];
  }
}

/** Balls spawn anywhere inside the outer ring (440), clear of inner rings. */
export const SPAWN_RADIUS = 440;

export const ARENA_WIDTH = WIDTH;
export const ARENA_HEIGHT = HEIGHT;

/** The arena as a world: rings, the "outside" zone, spawn inside the rings. */
export function arenaLayout(scenario: string, ballRadius: number, random: Random, options: { spin?: number } = {}): WorldLayout {
  const rings = ringsFor(scenario, ballRadius, random.fork("rings"));
  const outer = rings[rings.length - 1] as RingPlan;
  const outerEdge = outer.radius + outer.thickness;
  const spawn = SPAWN_RADIUS - ballRadius * 0.5;
  const spin = options.spin ?? 1;
  return {
    bounds: { x: 0, y: 0, w: WIDTH, h: HEIGHT },
    focus: {
      x: CENTER.x - outerEdge - 40,
      y: CENTER.y - outerEdge - 40,
      w: (outerEdge + 40) * 2,
      h: (outerEdge + 40) * 2,
    },
    obstacles: rings.map((ring) => ringObstacle({ ...ring, speed: ring.speed * spin })),
    zones: [
      { id: "outside", kind: "eliminate", shape: { kind: "outside-circle", x: CENTER.x, y: CENTER.y, r: outerEdge + 2 }, visible: false },
    ],
    spawn: {
      kind: "circle",
      x: CENTER.x,
      y: CENTER.y,
      r: spawn,
      speed: 7,
      avoidBands: rings.slice(0, -1).map((ring) => ({ radius: ring.radius, thickness: ring.thickness })),
    },
  };
}


