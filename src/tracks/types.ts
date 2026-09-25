import type { Random } from "@/engine/random";
import type { ObstacleSpec, Rect, ZoneSpec } from "@/engine/types";

export const MODULE_KINDS = [
  "start",
  "drop",
  "zigzag",
  "spinner",
  "funnel",
  "pinball",
  "tunnel",
  "jump",
  "platforms",
  "bottleneck",
  "wheel",
  "final-drop",
  "finish",
] as const;

export type ModuleKind = (typeof MODULE_KINDS)[number];

/** Modules that can go between the start gate and the final drop. */
export const MIDDLE_MODULES = MODULE_KINDS.filter((k) => k !== "start" && k !== "final-drop" && k !== "finish");

/** What a module builder gets: where it starts and the seeded randomness to use. */
export interface ModuleContext {
  random: Random;
  /** Top of the module in world coordinates (tracks run downward). */
  y: number;
  /** Inner edges of the track (inside the side walls). */
  left: number;
  right: number;
  ballRadius: number;
  /** Number of balls (the start module sizes its box with it). */
  count: number;
  /** Unique prefix for obstacle ids. */
  id: string;
  /** 0 = gentle, 1 = hard (more, faster obstacles). */
  difficulty: number;
}

export interface ModuleOutput {
  height: number;
  obstacles: ObstacleSpec[];
  zones?: ZoneSpec[];
  /** Start module only: where balls spawn. */
  spawn?: Rect;
  /** Start module only: when the gate opens (seconds). */
  gateOpensAt?: number;
}

export interface TrackModuleDefinition {
  kind: ModuleKind;
  label: string;
  /** Relative chance of being picked by the generator (0 = never random). */
  weight: number;
  build(ctx: ModuleContext): ModuleOutput;
}

export interface PlacedModule {
  kind: ModuleKind;
  y: number;
  height: number;
}

/** A complete track: pure, serializable data. */
export interface TrackDefinition {
  seed: string;
  width: number;
  height: number;
  modules: PlacedModule[];
  obstacles: ObstacleSpec[];
  zones: ZoneSpec[];
  spawn: Rect;
  startY: number;
  finishY: number;
  gateOpensAt: number;
}

export interface TrackOptions {
  /** Middle modules between start and finish. */
  length: number;
  ballRadius: number;
  count: number;
  width?: number;
  /** Pool of kinds the generator may pick from. */
  pool?: ModuleKind[];
  /** Fixed middle sequence (overrides pool/length). */
  sequence?: ModuleKind[];
  difficulty?: number;
}
