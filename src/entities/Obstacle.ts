import type Matter from "matter-js";
import type { MotionSpec, ObstacleSpec, ObstacleStyle, ShapeSpec, Vec2 } from "@/engine/types";

/** Drawing primitives in the obstacle's local frame (relative to its origin). */
export type RenderShape =
  | { kind: "poly"; points: Vec2[] }
  | { kind: "circle"; x: number; y: number; r: number }
  | {
      kind: "arc";
      x: number;
      y: number;
      radius: number;
      thickness: number;
      start: number;
      end: number;
    };

export interface Pose {
  x: number;
  y: number;
  angle: number;
}

/**
 * Static or kinematic piece of level geometry backed by a Matter.js body.
 * Kinematic poses are absolute functions of simulated time, so they never
 * drift and are identical on every replay.
 */
export class Obstacle {
  readonly id: string;
  readonly style: ObstacleStyle;
  readonly motion: MotionSpec | undefined;
  readonly kick: number;
  /** Body centre of mass at motion time 0. */
  origin: Vec2;
  /** Body angle at motion time 0. */
  baseAngle: number;
  renderShapes: RenderShape[];
  x: number;
  y: number;
  angle: number;
  prevX: number;
  prevY: number;
  prevAngle: number;
  /** Offset applied by rules for `manual` motion. */
  manualOffset: Vec2 = { x: 0, y: 0 };

  constructor(
    public spec: ObstacleSpec,
    public body: Matter.Body,
  ) {
    this.id = spec.id;
    this.style = spec.style;
    this.motion = spec.motion;
    this.kick = spec.kick ?? 0;
    this.origin = { x: body.position.x, y: body.position.y };
    this.baseAngle = body.angle;
    this.renderShapes = toRenderShapes(spec.shapes, this.origin);
    this.x = this.prevX = body.position.x;
    this.y = this.prevY = body.position.y;
    this.angle = this.prevAngle = body.angle;
  }

  get kinematic(): boolean {
    return !!this.motion;
  }

  /** Swap geometry (e.g. a ring losing segments) keeping the motion script. */
  rebuild(spec: ObstacleSpec, body: Matter.Body): void {
    this.spec = spec;
    this.body = body;
    this.origin = { x: body.position.x, y: body.position.y };
    this.baseAngle = body.angle;
    this.renderShapes = toRenderShapes(spec.shapes, this.origin);
  }

  poseAt(time: number): Pose {
    const motion = this.motion;
    if (!motion) return { x: this.origin.x, y: this.origin.y, angle: this.baseAngle };
    if (motion.type === "rotate" || motion.type === "swing") {
      const theta =
        motion.type === "rotate"
          ? motion.speed * time + (motion.phase ?? 0)
          : motion.amplitude * Math.sin((Math.PI * 2 * time) / motion.period + (motion.phase ?? 0));
      const dx = this.origin.x - motion.pivot.x;
      const dy = this.origin.y - motion.pivot.y;
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      return {
        x: motion.pivot.x + dx * c - dy * s,
        y: motion.pivot.y + dx * s + dy * c,
        angle: this.baseAngle + theta,
      };
    }
    if (motion.type === "cycle") {
      const k = cycleAmount(motion, time);
      return { x: this.origin.x + motion.offset.x * k, y: this.origin.y + motion.offset.y * k, angle: this.baseAngle };
    }
    if (motion.type === "manual") {
      return { x: this.origin.x + this.manualOffset.x, y: this.origin.y + this.manualOffset.y, angle: this.baseAngle };
    }
    if (motion.type === "slide") {
      const t = Math.min(1, Math.max(0, (time - motion.start) / motion.duration));
      const eased = t * t * (3 - 2 * t);
      return {
        x: this.origin.x + motion.offset.x * eased,
        y: this.origin.y + motion.offset.y * eased,
        angle: this.baseAngle,
      };
    }
    const offset =
      motion.amplitude * Math.sin((Math.PI * 2 * time) / motion.period + (motion.phase ?? 0));
    return {
      x: this.origin.x + motion.axis.x * offset,
      y: this.origin.y + motion.axis.y * offset,
      angle: this.baseAngle,
    };
  }

  savePrevious(): void {
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevAngle = this.angle;
  }

  syncFromBody(): void {
    this.x = this.body.position.x;
    this.y = this.body.position.y;
    this.angle = this.body.angle;
  }
}

/** How far out a `cycle` motion is at `time`, 0..1 (smoothstep ease). */
export function cycleAmount(motion: Extract<MotionSpec, { type: "cycle" }>, time: number): number {
  const u = (((time / motion.period + (motion.phase ?? 0)) % 1) + 1) % 1;
  const ease = (t: number) => t * t * (3 - 2 * t);
  if (u < motion.out) return ease(u / motion.out);
  if (u < motion.out + motion.hold) return 1;
  if (u < motion.out + motion.hold + motion.back) return 1 - ease((u - motion.out - motion.hold) / motion.back);
  return 0;
}

function toRenderShapes(shapes: ShapeSpec[], origin: Vec2): RenderShape[] {
  const local = (p: Vec2): Vec2 => ({ x: p.x - origin.x, y: p.y - origin.y });
  return shapes.map((shape): RenderShape => {
    switch (shape.kind) {
      case "rect": {
        const c = Math.cos(shape.angle ?? 0);
        const s = Math.sin(shape.angle ?? 0);
        const hw = shape.w / 2;
        const hh = shape.h / 2;
        const corners = [
          [-hw, -hh],
          [hw, -hh],
          [hw, hh],
          [-hw, hh],
        ] as const;
        return {
          kind: "poly",
          points: corners.map(([px, py]) =>
            local({ x: shape.x + px * c - py * s, y: shape.y + px * s + py * c }),
          ),
        };
      }
      case "circle":
        return { kind: "circle", ...local(shape), r: shape.r };
      case "polygon":
        return { kind: "poly", points: shape.points.map(local) };
      case "arc":
        return {
          kind: "arc",
          ...local(shape),
          radius: shape.radius,
          thickness: shape.thickness,
          start: shape.start,
          end: shape.end,
        };
    }
  });
}
