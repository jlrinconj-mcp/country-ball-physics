import { withDeterministicMath } from "@/engine/deterministicMath";
import { createRandom } from "@/engine/random";
import type { ObstacleSpec, ZoneSpec } from "@/engine/types";
import { TRACK_MODULES } from "./modules";
import type { ModuleKind, PlacedModule, TrackDefinition, TrackOptions } from "./types";

export const TRACK_WIDTH = 1080;
const WALL = 40;

/** Modules the generator picks from by default (weights live on each module). */
export const DEFAULT_POOL: ModuleKind[] = [
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
];

/**
 * Build a vertical track from modules. Pure and deterministic: the same seed
 * and options always return the same track (the same JSON, byte for byte).
 */
export function generateTrack(seed: string, options: TrackOptions): TrackDefinition {
  return withDeterministicMath(() => buildTrack(seed, options));
}

function buildTrack(seed: string, options: TrackOptions): TrackDefinition {
  const random = createRandom(seed).fork("track");
  const width = options.width ?? TRACK_WIDTH;
  const left = WALL;
  const right = width - WALL;
  const difficulty = options.difficulty ?? 0.5;

  const middle = options.sequence ?? pickSequence(random.fork("sequence"), options.length, options.pool ?? DEFAULT_POOL);
  const kinds: ModuleKind[] = ["start", ...middle, "final-drop", "finish"];

  const obstacles: ObstacleSpec[] = [];
  const zones: ZoneSpec[] = [];
  const modules: PlacedModule[] = [];
  let y = 0;
  let spawn = { x: left, y: 40, w: right - left, h: 200 };
  let gateOpensAt = 0;

  kinds.forEach((kind, index) => {
    const out = TRACK_MODULES[kind].build({
      random: random.fork(`module-${index}-${kind}`),
      y,
      left,
      right,
      ballRadius: options.ballRadius,
      count: options.count,
      id: `m${index}-${kind}`,
      difficulty,
    });
    obstacles.push(...out.obstacles);
    zones.push(...(out.zones ?? []));
    if (out.spawn) spawn = out.spawn;
    if (out.gateOpensAt !== undefined) gateOpensAt = out.gateOpensAt;
    modules.push({ kind, y, height: out.height });
    y += out.height;
  });

  const height = y;
  // Side walls and a lid over the start box. Walls extend past the ends.
  obstacles.unshift(
    { id: "wall-left", style: "wall", shapes: [{ kind: "rect", x: left - WALL / 2, y: height / 2, w: WALL, h: height + 400 }], restitution: 0.4, friction: 0.02 },
    { id: "wall-right", style: "wall", shapes: [{ kind: "rect", x: right + WALL / 2, y: height / 2, w: WALL, h: height + 400 }], restitution: 0.4, friction: 0.02 },
    { id: "lid", style: "wall", shapes: [{ kind: "rect", x: width / 2, y: -20, w: width, h: 40 }], restitution: 0.4 },
  );

  const finishZone = zones.find((z) => z.kind === "finish");
  const finishY = finishZone && finishZone.shape.kind === "rect" ? finishZone.shape.y : height;
  return {
    seed,
    width,
    height,
    modules,
    obstacles,
    zones,
    spawn,
    startY: spawn.y + spawn.h,
    finishY,
    gateOpensAt,
  };
}

/** Weighted picks without repeating the previous module. */
function pickSequence(random: ReturnType<typeof createRandom>, length: number, pool: ModuleKind[]): ModuleKind[] {
  const out: ModuleKind[] = [];
  for (let i = 0; i < length; i++) {
    const options = pool.filter((k) => k !== out[out.length - 1] && TRACK_MODULES[k].weight > 0);
    out.push(random.weighted(options.length ? options : pool, (k) => TRACK_MODULES[k].weight));
  }
  return out;
}
