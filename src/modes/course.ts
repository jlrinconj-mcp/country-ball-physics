import type { CountryBall } from "@/entities/CountryBall";
import type { Obstacle } from "@/entities/Obstacle";
import type { Random } from "@/engine/random";
import type { LayoutContext, Simulation } from "@/engine/simulation";
import type { SpawnSpec, WorldLayout } from "@/engine/types";
import { CoursePath } from "@/tracks/coursePath";
import { buildMap, findMap, type MapDefinition } from "@/tracks/maps";
import type { TrackDefinition } from "@/tracks/types";
import { arenaLayout, RING_CENTER, ringsFor } from "./arena";
import { autoRadius, createChaos, ringObstacle, startGate } from "./shared";

/**
 * Maps in any mode. A map is either a track (gate, route, finish line) or a
 * ring arena (escaping the rings is the "finish"). Every mode that takes a
 * map builds its world with `mapLayout` and runs it through a `Course`,
 * which says how far along a ball is and when it has made it.
 */

export type ArenaId = NonNullable<MapDefinition["arena"]>;

/**
 * Arena rings spin faster than in classic Last Country Standing and their
 * gaps open wider and sooner with more rings: balls pile up against a ring
 * until its gap comes round, and a round has to stay short.
 */
const ARENA_SPIN: Record<ArenaId, number> = { ring: 1.2, "double-ring": 1.3, "triple-ring": 1.8 };
/** Seconds for the gaps to open from their starting size to their widest. */
const ARENA_WIDEN = [9, 6.5, 4];

export function trackLayout(track: TrackDefinition): WorldLayout {
  return {
    bounds: { x: 0, y: -60, w: track.width, h: track.height + 60 },
    focus: { x: 0, y: -60, w: track.width, h: track.height + 60 },
    obstacles: track.obstacles,
    zones: track.zones,
    spawn: { kind: "rect", ...track.spawn, speed: 1.5 },
    startY: track.startY,
    finishY: track.finishY,
    gateOpensAt: track.gateOpensAt,
    modules: track.modules,
    path: track.path,
  };
}

/** The map a simulation plays on, if its config names one. */
export function configMap(sim: Simulation): MapDefinition | undefined {
  return findMap(sim.config.map);
}

/** Ball size for a map: arenas are smaller than a track's width. */
export function mapBallRadius(map: MapDefinition, count: number, trackMax = 24): number {
  if (map.arena) return autoRadius(Math.PI * 440 * 440, count, 0.2, 9, 28);
  return autoRadius(1000 * 420, count, 0.3, 11, trackMax);
}

/** The world for a map. */
export function mapLayout(map: MapDefinition, ctx: LayoutContext): WorldLayout {
  if (map.arena) return arenaLayout(map.arena, ctx.ballRadius, ctx.random, { spin: ARENA_SPIN[map.arena] });
  return trackLayout(buildMap(map, ctx.random.seed, { ballRadius: ctx.ballRadius, count: ctx.count }));
}

/**
 * What a race is run on. A track: a gate, a route, a finish line. An arena:
 * spinning rings whose gaps open at the start and widen as the race goes on,
 * with the outside as the finish.
 */
export interface Course {
  readonly arena: boolean;
  /** Larger is closer to the finish. */
  progress(ball: CountryBall): number;
  /** Progress value of a ball that made it. */
  readonly length: number;
  /** Past the finish (a track's line, an arena's outer ring). */
  made(ball: CountryBall): boolean;
  /** Left the world some other way. */
  lost(ball: CountryBall): boolean;
  /** Stuck for good may drop through the scenery (tracks only). */
  readonly rescue: boolean;
  spawn: SpawnSpec;
  /** Starting velocity for a fresh placement (arenas start moving). */
  launch(random: Random): { vx: number; vy: number };
  /** Shut the gate (track) or the rings (arena) before a start. */
  close(): void;
  open(): void;
  /** Every tick, before physics: seconds since the start while racing, else null. */
  update(racing: number | null): void;
  /** Random kicks while racing (arenas). */
  kick(): void;
}

export interface ArenaOptions {
  /**
   * Races: the gaps start shut and grow from nothing on "GO!", only wide
   * enough for a ball after this many seconds, then keep widening. Without
   * it, the gaps open at a ball's width straight away (elimination modes).
   */
  growFor?: number;
}

export function courseFor(sim: Simulation, map: MapDefinition): Course {
  return map.arena ? arenaCourse(sim, map.arena) : trackCourse(sim);
}

export function trackCourse(sim: Simulation): Course {
  const { bounds } = sim.layout;
  const cx = bounds.x + bounds.w / 2;
  const path = new CoursePath(sim.layout.path ?? [{ x: cx, y: sim.layout.startY ?? 0 }, { x: cx, y: sim.layout.finishY ?? bounds.h }]);
  const finishZones = sim.zones.filter((z) => z.kind === "finish");
  const gate = startGate(sim);
  return {
    arena: false,
    progress: (b) => path.progress(b.x, b.y),
    length: path.length,
    made: (b) => finishZones.some((z) => z.contains(b.x, b.y, b.radius)),
    lost: (b) => b.x < bounds.x - 100 || b.x > bounds.x + bounds.w + 100 || b.y > bounds.y + bounds.h + 300,
    rescue: true,
    spawn: sim.layout.spawn,
    launch: () => ({ vx: 0, vy: 0 }),
    close: () => gate.close(),
    open: () => gate.open(),
    update: () => gate.update(),
    kick: () => {},
  };
}

export function arenaCourse(sim: Simulation, arena: ArenaId, options: ArenaOptions = {}): Course {
  const plans = ringsFor(arena, sim.ballRadius, sim.random.fork("layout").fork("rings")).map((p) => ({ ...p, speed: p.speed * ARENA_SPIN[arena] }));
  const rings = plans.map((plan) => ({ plan, gap: plan.gap, obstacle: sim.obstacles.find((o) => o.id === plan.id) as Obstacle }));
  const outer = plans[plans.length - 1];
  const edge = outer ? outer.radius + outer.thickness : 480;
  const chaos = createChaos(sim, sim.random.fork("forces"));
  const distance = (b: CountryBall) => Math.hypot(b.x - RING_CENTER.x, b.y - RING_CENTER.y);
  const setGap = (ring: (typeof rings)[number], gap: number) => {
    if (Math.abs(gap - ring.gap) < 0.02) return;
    ring.gap = gap;
    sim.replaceObstacle(ring.obstacle, ringObstacle({ ...ring.plan, gap }));
  };
  // Nested rings open wider than in Last Country Standing: every ball has to
  // get through all of them.
  const extra = ((rings.length - 1) * 25 * Math.PI) / 180;
  const widen = ARENA_WIDEN[rings.length - 1] ?? 4;
  return {
    arena: true,
    progress: distance,
    length: edge,
    made: (b) => distance(b) > edge + b.radius,
    lost: (b) => b.y > sim.layout.bounds.h + 200,
    // Gaps keep widening, so everyone gets out: no shortcuts through a ring.
    rescue: false,
    spawn: sim.layout.spawn,
    launch: (random) => {
      const angle = random.float(0, Math.PI * 2);
      const speed = random.float(2, 5);
      return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
    },
    // Closed rings before the start: nobody slips out early.
    close: () => rings.forEach((ring) => setGap(ring, 0)),
    open: () => {
      if (options.growFor === undefined) rings.forEach((ring) => setGap(ring, ring.plan.gap));
    },
    update(racing) {
      // Every half second the gaps open a little wider until everyone is out.
      if (racing === null || sim.tick % 30 !== 0) return;
      const grow = options.growFor;
      for (const ring of rings) {
        const widest = ring.plan.maxGap + extra;
        if (grow !== undefined) {
          // From shut to a ball's width over `grow` seconds, then on to the widest.
          const gap = racing <= grow ? (ring.plan.gap * racing) / grow : ring.plan.gap + ((widest - ring.plan.gap) * (racing - grow)) / (widen * 1.5);
          setGap(ring, Math.min(widest, gap));
        } else {
          const k = Math.min(1, racing / widen);
          setGap(ring, ring.plan.gap + (widest - ring.plan.gap) * k);
        }
      }
    },
    kick: () => chaos(0.8),
  };
}
