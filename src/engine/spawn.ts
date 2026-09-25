import type { Random } from "./random";
import type { SpawnSpec, Vec2 } from "./types";

/**
 * Non-overlapping spawn points on a jittered hex grid. If the area is too
 * small for `count` balls the spacing shrinks until they fit; if it still
 * can't fit, points are stacked in extra rows above the area (they fall in).
 */
export function spawnPoints(spec: SpawnSpec, count: number, radius: number, random: Random): Vec2[] {
  if (count <= 0) return [];
  let spacing = radius * 2.3;
  let points: Vec2[] = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    points = hexGrid(spec, spacing, radius);
    if (points.length >= count) break;
    spacing *= 0.92;
  }
  if (points.length < count) points = [...points, ...overflowRows(spec, count - points.length, radius)];

  // Jitter within the slack between neighbours, then pick in a seeded order.
  const slack = Math.max(0, spacing / 2 - radius) * 0.8;
  const jittered = points.map((p) => ({
    x: p.x + random.float(-slack, slack),
    y: p.y + random.float(-slack, slack),
  }));
  return random.sample(jittered, count);
}

function hexGrid(spec: SpawnSpec, spacing: number, radius: number): Vec2[] {
  const rowHeight = spacing * Math.sin(Math.PI / 3);
  const points: Vec2[] = [];
  const box =
    spec.kind === "circle"
      ? { x: spec.x - spec.r, y: spec.y - spec.r, w: spec.r * 2, h: spec.r * 2 }
      : spec;
  let row = 0;
  for (let y = box.y + radius; y <= box.y + box.h - radius; y += rowHeight, row++) {
    const offset = row % 2 ? spacing / 2 : 0;
    for (let x = box.x + radius + offset; x <= box.x + box.w - radius; x += spacing) {
      if (spec.kind === "circle") {
        const d = Math.hypot(x - spec.x, y - spec.y);
        if (d > spec.r - radius) continue;
        const gap = radius + 4;
        if (spec.avoidBands?.some((b) => d > b.radius - gap && d < b.radius + b.thickness + gap)) continue;
      }
      points.push({ x, y });
    }
  }
  return points;
}

function overflowRows(spec: SpawnSpec, count: number, radius: number): Vec2[] {
  const left = spec.kind === "circle" ? spec.x - spec.r * 0.6 : spec.x + radius;
  const width = spec.kind === "circle" ? spec.r * 1.2 : spec.w - radius * 2;
  const top = spec.kind === "circle" ? spec.y - spec.r * 0.4 : spec.y;
  const perRow = Math.max(1, Math.floor(width / (radius * 2.2)));
  return Array.from({ length: count }, (_, i) => ({
    x: left + (i % perRow) * radius * 2.2 + radius,
    y: top - (Math.floor(i / perRow) + 1) * radius * 2.2,
  }));
}
