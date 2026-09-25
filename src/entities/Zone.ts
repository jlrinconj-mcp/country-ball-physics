import type { ZoneSpec } from "@/engine/types";

/**
 * Region with a rule attached: eliminators remove balls that enter them,
 * goals (finish zones) mark balls as finished. Checks are geometric and run
 * once per tick, which keeps them deterministic and cheap.
 */
export class Zone {
  constructor(readonly spec: ZoneSpec) {}

  get kind(): ZoneSpec["kind"] {
    return this.spec.kind;
  }

  contains(x: number, y: number, radius: number): boolean {
    const shape = this.spec.shape;
    switch (shape.kind) {
      case "rect":
        return x >= shape.x && x <= shape.x + shape.w && y >= shape.y && y <= shape.y + shape.h;
      case "outside-circle":
        return Math.hypot(x - shape.x, y - shape.y) > shape.r + radius;
    }
  }
}
