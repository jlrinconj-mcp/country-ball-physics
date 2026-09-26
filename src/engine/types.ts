export interface Vec2 {
  x: number;
  y: number;
}

/** Axis-aligned rectangle, top-left origin. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Collision shape in world coordinates. An obstacle is one rigid body made of
 * one or more shapes. Polygons must be convex.
 */
export type ShapeSpec =
  | { kind: "rect"; x: number; y: number; w: number; h: number; angle?: number }
  | { kind: "circle"; x: number; y: number; r: number }
  | { kind: "polygon"; points: Vec2[] }
  | {
      kind: "arc";
      x: number;
      y: number;
      /** Inner radius of the band. */
      radius: number;
      thickness: number;
      /** Radians, clockwise from +x (canvas convention). */
      start: number;
      end: number;
      /** Collision segments per full turn. */
      resolution?: number;
    };

export type ObstacleStyle =
  | "wall"
  | "ring"
  | "platform"
  | "ramp"
  | "peg"
  | "bumper"
  | "spinner"
  | "wheel"
  | "funnel"
  | "tunnel"
  | "gate";

/** Scripted (kinematic) motion. Transforms are absolute functions of time. */
export type MotionSpec =
  | { type: "rotate"; speed: number; pivot: Vec2; phase?: number }
  | { type: "oscillate"; axis: Vec2; amplitude: number; period: number; phase?: number }
  /** One-shot move by `offset`, starting at `start` seconds (gates, trapdoors). */
  | { type: "slide"; offset: Vec2; start: number; duration: number }
  /** Pose driven by mode rules through `Obstacle.manualOffset` (reusable gates). */
  | { type: "manual" };

export interface ObstacleSpec {
  id: string;
  style: ObstacleStyle;
  shapes: ShapeSpec[];
  motion?: MotionSpec;
  restitution?: number;
  friction?: number;
  /** Extra outward speed given to balls on contact (bumpers). */
  kick?: number;
}

export type ZoneShape =
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  /** Everything farther than r from (x, y). */
  | { kind: "outside-circle"; x: number; y: number; r: number };

export interface ZoneSpec {
  id: string;
  /** eliminate: out · finish: race goal · safe: survives the current round. */
  kind: "eliminate" | "finish" | "safe";
  shape: ZoneShape;
  /** Draw the zone. Invisible zones still work. */
  visible?: boolean;
}

export type SpawnSpec =
  | {
      kind: "circle";
      x: number;
      y: number;
      r: number;
      speed: number;
      /** Concentric bands (e.g. inner rings) spawn points must stay clear of. */
      avoidBands?: { radius: number; thickness: number }[];
    }
  | { kind: "rect"; x: number; y: number; w: number; h: number; speed: number };

/** Static description of a world. Pure data: serializable and seedable. */
export interface WorldLayout {
  /** Everything of interest lives inside; used for camera clamping. */
  bounds: Rect;
  /** What the fixed camera frames. */
  focus: Rect;
  obstacles: ObstacleSpec[];
  zones: ZoneSpec[];
  spawn: SpawnSpec;
  /** Race layouts: y of the finish line (progress increases downward). */
  finishY?: number;
  /** Start line for progress normalization. */
  startY?: number;
  /** Race layouts: when the start gate opens (seconds). */
  gateOpensAt?: number;
  /** Track layouts: the modules it was built from (for HUD, debugging, editor). */
  modules?: { kind: string; y: number; height: number }[];
  /** Track layouts: the route balls follow from gate to finish (progress). */
  path?: Vec2[];
}

export type ModeId = "last-country-standing" | "race" | "elimination-drop" | "marble-race" | "last-place-elimination";

export interface PhysicsSettings {
  /** Gravity multiplier; 1 ≈ Matter.js default. */
  gravity: number;
  restitution: number;
  friction: number;
  frictionAir: number;
  /** Max ball speed in px per 1/60 s. */
  maxSpeed: number;
  /** Multiplier on the mode's automatic ball radius. */
  ballScale: number;
  /** Random kicks that keep things moving, 0..1. */
  chaos: number;
}

/**
 * Everything that determines the outcome of a simulation. Display settings
 * (camera, format, HUD, playback speed) are intentionally not in here, so the
 * same simulation can be framed as 9:16 or 16:9 without changing the result.
 */
export interface SimulationConfig {
  mode: ModeId;
  scenario: string;
  seed: string;
  /** ISO alpha-3 codes. Order doesn't matter; the seed decides placement. */
  countries: string[];
  /** Cap on participants; a seeded sample is taken when more are selected. */
  maxParticipants: number;
  physics: PhysicsSettings;
  /** Simulated seconds before the mode forces a decision. */
  maxDuration: number;
  /**
   * Run as a tournament: heats of `mode` with a seeded draw, winners advancing
   * to a final. Orchestrated by `Tournament`; a single Simulation ignores it.
   */
  tournament?: { size: 8 | 16 | 32 | 64 };
  /**
   * Custom track (race modes): module sequence between start and finish, in
   * order. Geometry inside each module is still generated from the seed.
   */
  track?: { sequence: string[]; difficulty?: number };
  /**
   * Named map from the map registry (race modes). Replaces the scenario's
   * procedural recipe; a custom `track` still wins over it.
   */
  map?: string;
}
