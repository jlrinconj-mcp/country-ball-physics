import { createRandom } from "@/engine/random";
import { generateTrack } from "./generator";
import type { ModuleKind, TrackDefinition } from "./types";

/**
 * Map registry: named track recipes any track-based mode can run (Country
 * Race, Marble Race, Last Place Elimination…). A map fixes the character of
 * the course (which modules, how many, how hard); the seed still decides the
 * geometry inside each module, so every seed plays a little differently.
 */
export interface MapDefinition {
  id: string;
  label: string;
  description: string;
  /**
   * Arena instead of a track: everyone starts inside spinning rings (the
   * Last Country Standing arenas) and escaping them is the finish line.
   */
  arena?: "ring" | "double-ring" | "triple-ring";
  /** Fixed middle modules, in order… */
  sequence?: ModuleKind[];
  /** …or one seeded pick per slot, in order… */
  slots?: ModuleKind[][];
  /** …or seeded picks from a pool. */
  pool?: ModuleKind[];
  /** Number of middle modules when picking from the pool. */
  length?: number;
  difficulty: number;
  /**
   * Typical round length (p10–p90, seconds) of Last Place Elimination with 32
   * countries: intro + race + result. Measured with `npm run maps`; the
   * target for every map is 8–15 s.
   */
  pace: readonly [number, number];
}

export const MAPS: readonly MapDefinition[] = [
  {
    id: "plinko",
    label: "Plinko",
    description: "Tall staggered peg boards: pure bounce luck.",
    sequence: ["plinko", "plinko"],
    difficulty: 0.5,
    pace: [10.5, 12],
  },
  {
    id: "pinball",
    label: "Pinball",
    description: "Peg fields studded with kicking bumpers.",
    sequence: ["pinball", "pinball", "drop"],
    difficulty: 0.7,
    pace: [10, 12],
  },
  {
    id: "zigzag",
    label: "Zigzag",
    description: "Long switchback ramps: overtakes on every turn.",
    // Every switchback stops a ball against the wall (~2 s a ramp): one module.
    sequence: ["zigzag"],
    difficulty: 0.4,
    pace: [11.5, 14.5],
  },
  {
    id: "funnel",
    label: "Funnel",
    description: "Funnels and drops that squeeze the pack together.",
    sequence: ["funnel", "drop", "funnel", "drop"],
    difficulty: 0.5,
    pace: [10, 12],
  },
  {
    id: "spinner",
    label: "Spinner",
    description: "Spinning bars and paddle wheels that swat balls around.",
    sequence: ["spinner", "wheel", "spinner"],
    difficulty: 0.6,
    pace: [10, 12.5],
  },
  {
    id: "drop",
    label: "Drop",
    description: "Big widely spaced pegs: a fast, bouncy fall.",
    sequence: ["drop", "drop", "drop"],
    difficulty: 0.4,
    pace: [9, 10.5],
  },
  {
    id: "marble",
    label: "Marble Run",
    description: "A seeded marble run: ramps, tunnels, wheels and platforms.",
    // No zigzag (it has its own map) and no jump: with soft bounces, balls
    // land against the far wall and restart from rest.
    pool: ["spinner", "funnel", "tunnel", "platforms", "bottleneck", "wheel"],
    length: 2,
    difficulty: 0.6,
    pace: [7.5, 13],
  },
  {
    id: "hammers",
    label: "Hammer Alley",
    description: "Switchback ramps under swinging pendulum hammers that bat balls along or back.",
    sequence: ["hammers"],
    difficulty: 0.6,
    pace: [10, 14],
  },
  {
    id: "crushers",
    label: "Crushers",
    description: "Rams slam out of both walls on a timer: time the gap or get flung.",
    sequence: ["crushers"],
    difficulty: 0.6,
    pace: [8.5, 11.5],
  },
  {
    id: "trapdoors",
    label: "Trapdoors",
    description: "Hinged floors that drop open and snap shut, launching whoever sits on the flap.",
    sequence: ["trapdoors", "pinball"],
    difficulty: 0.6,
    pace: [8, 10],
  },
  {
    id: "tumbler",
    label: "Tumbler",
    description: "A spinning drum with three openings: tumble through it or get spun off the rim.",
    sequence: ["tumbler"],
    difficulty: 0.5,
    pace: [8, 13],
  },
  {
    id: "vortex",
    label: "Vortex",
    description: "Funnel endurance: balls swing across a bowl until they slow down enough to drop through.",
    sequence: ["bowl"],
    difficulty: 0.5,
    pace: [7.5, 12],
  },
  {
    id: "hurdles",
    label: "Hurdles",
    description: "Steep switchbacks with humps to hop: a bad bounce sends you back.",
    sequence: ["hurdles"],
    difficulty: 0.5,
    pace: [9.5, 12],
  },
  {
    id: "obstacle-mix",
    label: "Obstacle Mix",
    description: "A seeded obstacle (hammers, crushers, trapdoors, drum, bowl or hurdles) plus a quick drop.",
    slots: [["hammers", "crushers", "trapdoors", "tumbler", "bowl", "hurdles"], ["drop", "funnel", "plinko"]],
    difficulty: 0.6,
    pace: [10, 15],
  },
  {
    id: "ring",
    label: "Spinning Ring",
    description: "The circle: escape the spinning ring through its widening gap. The last one inside is out.",
    arena: "ring",
    difficulty: 0.5,
    pace: [9, 11],
  },
  {
    id: "double-ring",
    label: "Double Ring",
    description: "Two counter-rotating rings to escape.",
    arena: "double-ring",
    difficulty: 0.6,
    pace: [8.5, 10.5],
  },
  {
    id: "triple-ring",
    label: "Triple Ring",
    description: "Three nested rings: the inner ones must line up three gaps.",
    arena: "triple-ring",
    difficulty: 0.7,
    pace: [8, 10],
  },
];

export function listMaps(): readonly MapDefinition[] {
  return MAPS;
}

export function findMap(id: string | undefined): MapDefinition | undefined {
  return MAPS.find((m) => m.id === id);
}

export function getMap(id: string): MapDefinition {
  const map = findMap(id);
  if (!map) throw new Error(`Unknown map "${id}" (expected one of: ${MAPS.map((m) => m.id).join(", ")})`);
  return map;
}

/** Maps with a track (every map but the arenas). */
export function listTrackMaps(): readonly MapDefinition[] {
  return MAPS.filter((m) => !m.arena);
}

/** Build a map's track for a seed. Same seed + options → same track. */
export function buildMap(map: MapDefinition, seed: string, options: { ballRadius: number; count: number }): TrackDefinition {
  if (map.arena) throw new Error(`"${map.id}" is an arena, not a track`);
  const picks = createRandom(seed).fork("map-slots");
  const sequence = map.slots ? map.slots.map((options) => picks.pick(options)) : map.sequence;
  return generateTrack(seed, {
    length: sequence?.length ?? map.length ?? 3,
    sequence,
    pool: map.pool,
    difficulty: map.difficulty,
    ballRadius: options.ballRadius,
    count: options.count,
  });
}
