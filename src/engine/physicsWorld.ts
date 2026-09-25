import Matter from "matter-js";
import type { PhysicsSettings, ShapeSpec, Vec2 } from "./types";

const { Bodies, Body, Common, Composite, Engine, Events, Vertices } = Matter;

/** Simulation ticks per simulated second. Rules and events run per tick. */
export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;
/** Physics sub-steps per tick: smaller steps, fewer tunnelling issues. */
export const SUBSTEPS = 2;
const SUBSTEP_MS = 1000 / TICK_RATE / SUBSTEPS;

export const CATEGORY = {
  ball: 0x0001,
  solid: 0x0002,
} as const;

// @types/matter-js lacks the `updateVelocity` flag Matter 0.20 supports.
const setPosition = Body.setPosition as (b: Matter.Body, p: Vec2, updateVelocity?: boolean) => void;
const setAngle = Body.setAngle as (b: Matter.Body, a: number, updateVelocity?: boolean) => void;

export interface BallOptions {
  restitution: number;
  friction: number;
  frictionAir: number;
  density?: number;
}

export interface SolidOptions {
  restitution?: number;
  friction?: number;
  /** Kinematic bodies are static but move by script and push balls. */
  label?: string;
}

export interface ContactInfo {
  a: Matter.Body;
  b: Matter.Body;
  /** Approach speed along the contact normal, px per 1/60 s. */
  speed: number;
  normal: Vec2;
  point: Vec2;
}

/**
 * Thin wrapper around a Matter.js engine. It owns the fixed-step integration
 * and body creation; nothing here knows about countries, modes or rendering.
 */
export class PhysicsWorld {
  readonly engine: Matter.Engine;
  private contactListeners: ((contact: ContactInfo) => void)[] = [];
  private readonly handleCollisionStart: (event: Matter.IEventCollision<Matter.Engine>) => void;

  constructor(settings: Pick<PhysicsSettings, "gravity">) {
    // Matter keeps a global id counter; ids influence pair ordering, so reset
    // it for every world to make runs independent of what ran before.
    (Common as unknown as { _nextId: number; _seed: number })._nextId = 0;
    (Common as unknown as { _nextId: number; _seed: number })._seed = 0;

    this.engine = Engine.create({
      enableSleeping: false,
      positionIterations: 8,
      velocityIterations: 6,
      constraintIterations: 2,
    });
    this.engine.gravity.y = settings.gravity;
    this.engine.gravity.scale = 0.001;

    this.handleCollisionStart = (event) => {
      if (this.contactListeners.length === 0) return;
      for (const pair of event.pairs) {
        const { bodyA, bodyB, collision } = pair;
        const a = bodyA.parent;
        const b = bodyB.parent;
        const rvx = a.velocity.x - b.velocity.x;
        const rvy = a.velocity.y - b.velocity.y;
        const n = collision.normal;
        const speed = Math.abs(rvx * n.x + rvy * n.y);
        const support = collision.supports[0] ?? a.position;
        const info: ContactInfo = {
          a,
          b,
          speed,
          normal: { x: n.x, y: n.y },
          point: { x: support.x, y: support.y },
        };
        for (const listener of this.contactListeners) listener(info);
      }
    };
    Events.on(this.engine, "collisionStart", this.handleCollisionStart);
  }

  setGravity(gravity: number): void {
    this.engine.gravity.y = gravity;
  }

  onContact(listener: (contact: ContactInfo) => void): void {
    this.contactListeners.push(listener);
  }

  createBall(x: number, y: number, radius: number, options: BallOptions): Matter.Body {
    const body = Bodies.circle(x, y, radius, {
      restitution: options.restitution,
      friction: options.friction,
      frictionStatic: options.friction * 2,
      frictionAir: options.frictionAir,
      density: options.density ?? 0.001,
      slop: 0.02,
      label: "ball",
      collisionFilter: { category: CATEGORY.ball, mask: CATEGORY.ball | CATEGORY.solid },
    });
    Composite.add(this.engine.world, body);
    return body;
  }

  /** Static (optionally kinematic) body built from one or more shapes. */
  createSolid(shapes: ShapeSpec[], options: SolidOptions = {}): Matter.Body {
    const common = {
      isStatic: true,
      restitution: options.restitution ?? 0.6,
      friction: options.friction ?? 0.05,
      frictionStatic: 0.1,
      slop: 0.02,
      collisionFilter: { category: CATEGORY.solid, mask: CATEGORY.ball },
    };
    const parts = shapes.flatMap((shape) => shapeToBodies(shape, common));
    const body =
      parts.length === 1
        ? (parts[0] as Matter.Body)
        : Body.create({ ...common, parts });
    body.label = options.label ?? "solid";
    Composite.add(this.engine.world, body);
    return body;
  }

  remove(body: Matter.Body): void {
    Composite.remove(this.engine.world, body);
  }

  /** Move a static body so the solver sees its velocity (moving platforms). */
  setKinematicTransform(body: Matter.Body, position: Vec2, angle: number): void {
    setPosition(body, position, true);
    setAngle(body, angle, true);
  }

  /** Place a static body without imparting velocity. */
  placeStatic(body: Matter.Body, position: Vec2, angle: number): void {
    setPosition(body, position, false);
    setAngle(body, angle, false);
  }

  /** Advance one tick (several sub-steps). */
  step(): void {
    for (let i = 0; i < SUBSTEPS; i++) Engine.update(this.engine, SUBSTEP_MS);
  }

  static clampSpeed(body: Matter.Body, maxSpeed: number): void {
    const { x, y } = body.velocity;
    const speed = Math.hypot(x, y);
    if (speed > maxSpeed) {
      const k = maxSpeed / speed;
      Body.setVelocity(body, { x: x * k, y: y * k });
    }
  }

  static setVelocity(body: Matter.Body, velocity: Vec2): void {
    Body.setVelocity(body, velocity);
  }

  static setAngularVelocity(body: Matter.Body, velocity: number): void {
    Body.setAngularVelocity(body, velocity);
  }

  destroy(): void {
    this.contactListeners = [];
    Events.off(this.engine, "collisionStart", this.handleCollisionStart);
    Composite.clear(this.engine.world, false, true);
    Engine.clear(this.engine);
  }
}

function shapeToBodies(
  shape: ShapeSpec,
  options: Matter.IChamferableBodyDefinition,
): Matter.Body[] {
  switch (shape.kind) {
    case "rect":
      return [
        Bodies.rectangle(shape.x, shape.y, shape.w, shape.h, {
          ...options,
          angle: shape.angle ?? 0,
        }),
      ];
    case "circle":
      return [Bodies.circle(shape.x, shape.y, shape.r, options)];
    case "polygon": {
      const centre = Vertices.centre(shape.points as Matter.Vector[]);
      return [Bodies.fromVertices(centre.x, centre.y, [shape.points as Matter.Vector[]], options)];
    }
    case "arc":
      return arcSegments(shape).map((seg) =>
        Bodies.rectangle(seg.x, seg.y, seg.w, seg.h, { ...options, angle: seg.angle }),
      );
  }
}

/** Approximate a thick arc with overlapping tangential rectangles. */
export function arcSegments(arc: Extract<ShapeSpec, { kind: "arc" }>) {
  const resolution = arc.resolution ?? 96;
  const span = arc.end - arc.start;
  const count = Math.max(1, Math.ceil((Math.abs(span) / (Math.PI * 2)) * resolution));
  const step = span / count;
  const mid = arc.radius + arc.thickness / 2;
  // Slight overlap so the band has no cracks between segments.
  const length = 2 * (arc.radius + arc.thickness) * Math.tan(Math.abs(step) / 2) + 2;
  const segments: { x: number; y: number; w: number; h: number; angle: number }[] = [];
  for (let i = 0; i < count; i++) {
    const a = arc.start + step * (i + 0.5);
    segments.push({
      x: arc.x + Math.cos(a) * mid,
      y: arc.y + Math.sin(a) * mid,
      w: arc.thickness,
      h: length,
      angle: a,
    });
  }
  return segments;
}
