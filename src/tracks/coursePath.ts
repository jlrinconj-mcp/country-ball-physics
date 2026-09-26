import type { Vec2 } from "@/engine/types";

/**
 * Distance travelled along a track's route, from the start gate to the
 * finish line. A ball is projected onto the route segment nearest to it among
 * those that span its height, so a ball rolling along a zigzag ramp gains
 * progress as it rolls, not only as it drops.
 */
export class CoursePath {
  private readonly segments: { a: Vec2; b: Vec2; start: number; length: number; minY: number; maxY: number }[] = [];
  readonly length: number;

  constructor(points: Vec2[], private readonly band = 90) {
    let total = 0;
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i] as Vec2;
      const b = points[i + 1] as Vec2;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length === 0) continue;
      this.segments.push({ a, b, start: total, length, minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) });
      total += length;
    }
    this.length = total;
  }

  /** Progress in px along the route (0 at the gate, `length` at the line). */
  progress(x: number, y: number): number {
    let best = Infinity;
    let value = 0;
    for (const s of this.segments) {
      if (y < s.minY - this.band || y > s.maxY + this.band) continue;
      const dx = s.b.x - s.a.x;
      const dy = s.b.y - s.a.y;
      const t = Math.max(0, Math.min(1, ((x - s.a.x) * dx + (y - s.a.y) * dy) / (s.length * s.length)));
      const d = Math.hypot(x - (s.a.x + t * dx), y - (s.a.y + t * dy));
      // Ties go to the later segment: further along is the fair reading.
      if (d <= best) {
        best = d;
        value = s.start + t * s.length;
      }
    }
    if (best === Infinity) {
      const first = this.segments[0];
      return first && y < first.minY ? 0 : this.length;
    }
    return value;
  }
}
