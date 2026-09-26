import type { ObstacleSpec, ShapeSpec, Vec2 } from "@/engine/types";

/**
 * Corridor detector. A corridor is a vertical lane where a ball can drop
 * straight through a stretch of track without ever touching anything: the
 * module does nothing to it. Moving parts count by the area they sweep
 * (a spinner blocks its whole disc, a platform its whole stroke), because a
 * ball in that lane will meet them sooner or later.
 */

/** Convex polygon or capsule (segment + radius; a circle is a zero-length capsule). */
type Primitive = { kind: "poly"; points: Vec2[] } | { kind: "capsule"; a: Vec2; b: Vec2; r: number };

export interface CorridorOptions {
  ballRadius: number;
  /** Horizontal range the ball's centre can take is [left + r, right - r]. */
  left: number;
  right: number;
  /** Vertical stretch the ball drops through. */
  top: number;
  bottom: number;
  /**
   * A touch shallower than this (fraction of the ball radius) doesn't count:
   * grazing a peg barely deflects a ball. Default 0.2.
   */
  minOverlap?: number;
  /** Sampling step in px. Default 1. */
  step?: number;
}

export interface Corridor {
  /** Range of ball-centre x positions that fall straight through. */
  from: number;
  to: number;
  width: number;
}

/** Every open vertical lane through the given obstacles (empty = none). */
export function findCorridors(obstacles: ObstacleSpec[], options: CorridorOptions): Corridor[] {
  const r = options.ballRadius;
  const reach = r * (1 - (options.minOverlap ?? 0.2));
  const step = options.step ?? 1;
  const { top, bottom } = options;
  const primitives = obstacles.flatMap(sweep).filter((p) => overlapsBand(p, top - reach, bottom + reach));

  const corridors: Corridor[] = [];
  let open: number | null = null;
  const lo = options.left + r;
  const hi = options.right - r;
  for (let x = lo; x <= hi + 1e-9; x += step) {
    const a = { x, y: top };
    const b = { x, y: bottom };
    const blocked = primitives.some((p) => distanceToSegment(p, a, b) < reach);
    if (!blocked && open === null) open = x;
    if (blocked && open !== null) {
      corridors.push({ from: open, to: x - step, width: x - step - open });
      open = null;
    }
  }
  if (open !== null) corridors.push({ from: open, to: hi, width: hi - open });
  return corridors;
}

// ── Swept geometry ───────────────────────────────────────────────────────

function sweep(spec: ObstacleSpec): Primitive[] {
  const base = spec.shapes.flatMap(toPrimitives);
  const motion = spec.motion;
  if (!motion || motion.type === "slide" || motion.type === "manual") {
    // Gates are judged closed: that's how they meet a ball dropping on them.
    return base;
  }
  if (motion.type === "rotate") {
    const p = motion.pivot;
    const radius = Math.max(...base.map((prim) => farthest(prim, p)));
    return [{ kind: "capsule", a: p, b: p, r: radius }];
  }
  const d = { x: motion.axis.x * motion.amplitude, y: motion.axis.y * motion.amplitude };
  return base.map((prim): Primitive => {
    if (prim.kind === "capsule") {
      // Capsule swept along d: hull of its two end discs, both shifted ±d.
      const pts = [prim.a, prim.b].flatMap((q) => [add(q, d, -1), add(q, d, 1)]);
      const [a, b] = extremes(pts, d);
      return { kind: "capsule", a, b, r: prim.r };
    }
    return { kind: "poly", points: hull(prim.points.flatMap((q) => [add(q, d, -1), add(q, d, 1)])) };
  });
}

function toPrimitives(shape: ShapeSpec): Primitive[] {
  switch (shape.kind) {
    case "circle":
      return [{ kind: "capsule", a: { x: shape.x, y: shape.y }, b: { x: shape.x, y: shape.y }, r: shape.r }];
    case "polygon":
      return [{ kind: "poly", points: shape.points }];
    case "rect": {
      const c = Math.cos(shape.angle ?? 0);
      const s = Math.sin(shape.angle ?? 0);
      const hw = shape.w / 2;
      const hh = shape.h / 2;
      const corners: [number, number][] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
      return [{ kind: "poly", points: corners.map(([px, py]) => ({ x: shape.x + px * c - py * s, y: shape.y + px * s + py * c })) }];
    }
    case "arc": {
      const mid = shape.radius + shape.thickness / 2;
      const segments = Math.max(2, Math.ceil(((shape.end - shape.start) / (Math.PI * 2)) * (shape.resolution ?? 64)));
      const out: Primitive[] = [];
      for (let i = 0; i < segments; i++) {
        const a0 = shape.start + ((shape.end - shape.start) * i) / segments;
        const a1 = shape.start + ((shape.end - shape.start) * (i + 1)) / segments;
        out.push({
          kind: "capsule",
          a: { x: shape.x + Math.cos(a0) * mid, y: shape.y + Math.sin(a0) * mid },
          b: { x: shape.x + Math.cos(a1) * mid, y: shape.y + Math.sin(a1) * mid },
          r: shape.thickness / 2,
        });
      }
      return out;
    }
  }
}

function farthest(prim: Primitive, p: Vec2): number {
  if (prim.kind === "capsule") return Math.max(dist(prim.a, p), dist(prim.b, p)) + prim.r;
  return Math.max(...prim.points.map((q) => dist(q, p)));
}

function overlapsBand(prim: Primitive, top: number, bottom: number): boolean {
  const ys = prim.kind === "capsule" ? [prim.a.y - prim.r, prim.b.y - prim.r, prim.a.y + prim.r, prim.b.y + prim.r] : prim.points.map((p) => p.y);
  return Math.max(...ys) >= top && Math.min(...ys) <= bottom;
}

// ── Distances ────────────────────────────────────────────────────────────

function distanceToSegment(prim: Primitive, a: Vec2, b: Vec2): number {
  if (prim.kind === "capsule") return segmentDistance(a, b, prim.a, prim.b) - prim.r;
  const pts = prim.points;
  if (pointInConvex(a, pts) || pointInConvex(b, pts)) return 0;
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    best = Math.min(best, segmentDistance(a, b, pts[i] as Vec2, pts[(i + 1) % pts.length] as Vec2));
    if (best === 0) break;
  }
  return best;
}

function segmentDistance(p1: Vec2, q1: Vec2, p2: Vec2, q2: Vec2): number {
  if (segmentsIntersect(p1, q1, p2, q2)) return 0;
  return Math.min(pointSegment(p1, p2, q2), pointSegment(q1, p2, q2), pointSegment(p2, p1, q1), pointSegment(q2, p1, q1));
}

function pointSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function cross(o: Vec2, a: Vec2, b: Vec2): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function segmentsIntersect(p1: Vec2, q1: Vec2, p2: Vec2, q2: Vec2): boolean {
  const d1 = cross(p2, q2, p1);
  const d2 = cross(p2, q2, q1);
  const d3 = cross(p1, q1, p2);
  const d4 = cross(p1, q1, q2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function pointInConvex(p: Vec2, pts: Vec2[]): boolean {
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const c = cross(pts[i] as Vec2, pts[(i + 1) % pts.length] as Vec2, p);
    if (c === 0) continue;
    const s = c > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function hull(points: Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2] as Vec2, lower[lower.length - 1] as Vec2, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i] as Vec2;
    while (upper.length >= 2 && cross(upper[upper.length - 2] as Vec2, upper[upper.length - 1] as Vec2, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function extremes(points: Vec2[], d: Vec2): [Vec2, Vec2] {
  const along = (p: Vec2) => p.x * d.x + p.y * d.y;
  const sorted = [...points].sort((a, b) => along(a) - along(b));
  return [sorted[0] as Vec2, sorted[sorted.length - 1] as Vec2];
}

function add(p: Vec2, d: Vec2, k: number): Vec2 {
  return { x: p.x + d.x * k, y: p.y + d.y * k };
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
