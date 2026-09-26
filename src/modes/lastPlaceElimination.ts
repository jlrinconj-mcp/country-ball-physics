import type { CountryBall } from "@/entities/CountryBall";
import type { Obstacle } from "@/entities/Obstacle";
import { TICK_RATE } from "@/engine/physicsWorld";
import type { Random } from "@/engine/random";
import type { ModeDefinition, ModeHud, ModeRules, Simulation } from "@/engine/simulation";
import { spawnPoints } from "@/engine/spawn";
import type { SpawnSpec } from "@/engine/types";
import { CoursePath } from "@/tracks/coursePath";
import { buildMap, findMap, listMaps, MAPS, type MapDefinition } from "@/tracks/maps";
import { lastCountryStanding, RING_CENTER, ringsFor } from "./lastCountryStanding";
import { trackLayout } from "./race";
import { RoundManager } from "./rounds";
import { autoRadius, createChaos, ringObstacle, startGate } from "./shared";

/** Intro before round 1: the "32 COUNTRIES" title card. */
const FIRST_INTRO = 3;
/** Intro before later rounds: "ROUND 7" card… */
const INTRO = 1.6;
/** …and a longer one for "FINAL 5" to "FINAL ROUND" (small fields race fast). */
const FINALS_INTRO = 2.4;
/** Outcome on screen before the next round. */
const RESULT = 1.4;
/** A round that isn't decided by then eliminates whoever is furthest behind. */
const ROUND_LIMIT = 22;
const STALL_TICKS = 3 * TICK_RATE;
const GO_SECONDS = 0.8;
/** How many of the stragglers the camera keeps in shot. */
const FIGHT = 3;

export const lastPlaceElimination: ModeDefinition = {
  id: "last-place-elimination",
  label: "Last Place Elimination",
  description:
    "Rounds on one map. Cross the line and you're safe until the next round; the last country still on the course is eliminated. Everyone restarts from a new seeded grid position each round, until one country is left.",
  scenarios: listMaps().map(({ id, label, description }) => ({ id, label, description })),
  defaultCamera: "follow-action",
  defaultParticipants: 32,
  // Soft bounces (as in Elimination Drop) so peg maps flow instead of
  // bouncing balls back up: rounds stay short.
  recommendedPhysics: { gravity: 1.6, maxSpeed: 18, restitution: 0.45 },
  defaultDuration: 900,

  autoBallRadius(count, scenario) {
    // Arenas are smaller than a track's width: a little less fill.
    if (mapFor(scenario).arena) return autoRadius(Math.PI * 440 * 440, count, 0.2, 9, 28);
    return autoRadius(1000 * 420, count, 0.3, 11, 24);
  },

  createLayout(ctx) {
    const map = mapFor(ctx.scenario);
    if (map.arena) {
      const layout = lastCountryStanding.createLayout({ ...ctx, scenario: map.arena });
      return { ...layout, obstacles: layout.obstacles.map((o) => (o.motion?.type === "rotate" ? { ...o, motion: { ...o.motion, speed: o.motion.speed * ARENA_SPIN[map.arena as NonNullable<MapDefinition["arena"]>] } } : o)) };
    }
    return trackLayout(buildMap(map, ctx.random.seed, { ballRadius: ctx.ballRadius, count: ctx.count }));
  },

  createRules(sim) {
    return createLastPlaceRules(sim);
  },
};

function mapFor(scenario: string): MapDefinition {
  return findMap(scenario) ?? (MAPS[0] as MapDefinition);
}

/**
 * What a round is run on. A track: a gate, a route, a finish line. An arena:
 * spinning rings whose gaps open at the start and widen as the round goes on,
 * with the outside as the finish.
 */
interface Course {
  /** Larger is closer to safety. */
  progress(ball: CountryBall): number;
  /** Progress value of a ball that made it. */
  readonly length: number;
  safe(ball: CountryBall): boolean;
  /** Left the world some other way (counts as last). */
  lost(ball: CountryBall): boolean;
  spawn: SpawnSpec;
  /** Starting velocity for a fresh placement (arenas start moving). */
  launch(random: Random): { vx: number; vy: number };
  close(): void;
  open(): void;
  /** Every tick, before physics: seconds since the start while racing, else null. */
  update(racing: number | null): void;
  /** Random kicks while racing (arenas). */
  kick(): void;
}

function trackCourse(sim: Simulation): Course {
  const { bounds } = sim.layout;
  const cx = bounds.x + bounds.w / 2;
  const path = new CoursePath(sim.layout.path ?? [{ x: cx, y: sim.layout.startY ?? 0 }, { x: cx, y: sim.layout.finishY ?? bounds.h }]);
  const finishZones = sim.zones.filter((z) => z.kind === "finish");
  const gate = startGate(sim);
  return {
    progress: (b) => path.progress(b.x, b.y),
    length: path.length,
    safe: (b) => finishZones.some((z) => z.contains(b.x, b.y, b.radius)),
    lost: (b) => b.x < bounds.x - 100 || b.x > bounds.x + bounds.w + 100 || b.y > bounds.y + bounds.h + 300,
    spawn: sim.layout.spawn,
    launch: () => ({ vx: 0, vy: 0 }),
    close: () => gate.close(),
    open: () => gate.open(),
    update: () => gate.update(),
    kick: () => {},
  };
}

/**
 * Seconds for the gaps to open from their starting size to their widest:
 * more rings to get through, faster opening, so every arena keeps 8–15 s rounds.
 */
const ARENA_WIDEN = [9, 6.5, 4];

/**
 * Rings spin faster than in Last Country Standing: balls pile up against a
 * ring until its gap comes round, and a round has to fit in 8–15 s.
 */
const ARENA_SPIN: Record<NonNullable<MapDefinition["arena"]>, number> = { ring: 1.2, "double-ring": 1.3, "triple-ring": 1.8 };

function arenaCourse(sim: Simulation, arena: NonNullable<MapDefinition["arena"]>): Course {
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
  return {
    progress: distance,
    length: edge,
    safe: (b) => distance(b) > edge + b.radius,
    lost: (b) => b.y > sim.layout.bounds.h + 200,
    spawn: sim.layout.spawn,
    launch: (random) => {
      const angle = random.float(0, Math.PI * 2);
      const speed = random.float(2, 5);
      return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
    },
    // Closed rings during the intro: nobody slips out before the start.
    close: () => rings.forEach((ring) => setGap(ring, 0)),
    open: () => rings.forEach((ring) => setGap(ring, ring.plan.gap)),
    update(racing) {
      // Every half second the gaps open a little wider until everyone is out.
      if (racing === null || sim.tick % 30 !== 0) return;
      const k = Math.min(1, racing / (ARENA_WIDEN[rings.length - 1] ?? 4));
      // Nested rings open wider than in Last Country Standing: every ball has
      // to get through all of them within a round.
      const extra = ((rings.length - 1) * 25 * Math.PI) / 180;
      for (const ring of rings) setGap(ring, ring.plan.gap + (ring.plan.maxGap + extra - ring.plan.gap) * k);
    },
    kick: () => chaos(0.8),
  };
}

/** Round banner: "ROUND 4", then "FINAL 5", "FINAL 4", "FINAL 3", "FINAL ROUND". */
export function roundTitle(round: number, remaining: number): string {
  if (remaining <= 2) return "FINAL ROUND";
  if (remaining <= 5) return `FINAL ${remaining}`;
  return `ROUND ${round}`;
}

export function createLastPlaceRules(sim: Simulation): ModeRules {
  const map = mapFor(sim.scenario);
  const course = map.arena ? arenaCourse(sim, map.arena) : trackCourse(sim);
  const { spawn } = course;
  const seeded = sim.random.fork("rounds");
  const forces = sim.random.fork("forces");
  const total = sim.balls.length;

  /** Safe this round, in the order they crossed. */
  const safe: CountryBall[] = [];
  /** Finishing position in the previous round (tie-breaker). */
  const previous = new Map<number, number>();
  const eliminated: CountryBall[] = [];
  const best = new Map<number, number>();
  const stalled = new Map<number, number>();
  let loser: CountryBall | null = null;
  let fieldAtStart = total;

  const progressOf = (b: CountryBall) => course.progress(b);

  /**
   * Running order of the balls still on the course, best first. Ties are
   * broken without randomness: further down, then better last round, then
   * spawn order.
   */
  const compare = (a: CountryBall, b: CountryBall) =>
    progressOf(b) - progressOf(a) ||
    b.y - a.y ||
    (previous.get(a.id) ?? total) - (previous.get(b.id) ?? total) ||
    a.id - b.id;

  const running = () => sim.activeBalls.sort(compare);

  const decide = (ball: CountryBall) => {
    if (loser) return;
    loser = ball;
    sim.eliminate(ball);
    eliminated.unshift(ball);
    previous.clear();
    safe.forEach((b, i) => previous.set(b.id, i));
    if (sim.aliveCount === 1) sim.declareWinner(sim.aliveBalls[0]);
    else rounds.end();
  };

  const rounds = new RoundManager(sim, {
    intro: (round) => (round === 1 ? FIRST_INTRO : sim.aliveCount <= 5 ? FINALS_INTRO : INTRO),
    limit: ROUND_LIMIT,
    result: RESULT,
    onSetup(round) {
      course.close();
      safe.length = 0;
      best.clear();
      stalled.clear();
      loser = null;
      const field = sim.aliveBalls;
      fieldAtStart = field.length;
      if (round === 1) return;
      // A fresh seeded grid position for everyone, every round.
      const random = seeded.fork(`spawn-${round}`);
      const points = spawnPoints(spawn, field.length, sim.ballRadius, random);
      field.forEach((ball, i) => {
        const p = points[i];
        if (!p) return;
        const { vx, vy } = course.launch(random);
        if (ball.parked) sim.unpark(ball, p.x, p.y, vx, vy);
        else sim.teleport(ball, p.x, p.y, vx, vy);
      });
    },
    onStart() {
      course.open();
    },
    onLimit() {
      const order = running();
      const last = order[order.length - 1];
      if (last) decide(last);
    },
  });

  const antiStall = (ball: CountryBall) => {
    const p = progressOf(ball);
    if (p > (best.get(ball.id) ?? -Infinity) + 4) {
      best.set(ball.id, p);
      stalled.set(ball.id, 0);
      return;
    }
    const ticks = (stalled.get(ball.id) ?? 0) + 1;
    stalled.set(ball.id, ticks);
    if (ticks >= STALL_TICKS) {
      stalled.set(ball.id, 0);
      sim.nudge(ball, forces.float(-7, 7), forces.float(-9, -4));
    }
  };

  const rules: ModeRules = {
    beforeStep() {
      rounds.update();
      course.update(rounds.racing && !loser ? rounds.elapsed : null);
    },

    afterStep() {
      if (!rounds.racing || loser) return;
      course.kick();
      const crossing: CountryBall[] = [];
      for (const ball of sim.balls) {
        if (!ball.active) continue;
        if (course.safe(ball)) {
          crossing.push(ball);
          continue;
        }
        if (course.lost(ball)) {
          decide(ball);
          return;
        }
        if (rounds.elapsed > 0.5) antiStall(ball);
      }
      crossing.sort(compare);
      // Everyone crossing on the same tick: the one furthest behind is last.
      const behind = sim.activeBalls.length - crossing.length === 0 ? crossing.pop() : undefined;
      for (const ball of crossing) {
        sim.park(ball);
        safe.push(ball);
      }
      if (behind) return decide(behind);
      const left = sim.activeBalls;
      if (left.length === 1 && left[0]) decide(left[0]);
    },

    rank() {
      const order = running();
      const place = new Map<number, number>();
      safe.forEach((b, i) => place.set(b.id, i));
      order.forEach((b, i) => place.set(b.id, safe.length + i));
      return [...sim.balls].sort((a, b) => {
        if (a.alive !== b.alive) return a.alive ? -1 : 1;
        if (a.alive) {
          const pa = place.get(a.id) ?? safe.length + (previous.get(a.id) ?? total);
          const pb = place.get(b.id) ?? safe.length + (previous.get(b.id) ?? total);
          return pa - pb || a.id - b.id;
        }
        return (b.eliminatedTick ?? 0) - (a.eliminatedTick ?? 0) || a.id - b.id;
      });
    },

    progress(b) {
      if (b.status === "eliminated") return -1e7 + (b.eliminatedTick ?? 0);
      const i = safe.indexOf(b);
      if (i >= 0) return course.length + total - i;
      return b.parked ? course.length : progressOf(b);
    },

    // There's no leader to chase here: the story is at the back.
    leaderActive: () => false,

    // Arenas are watched whole: the escapes happen all around the rim.
    cameraFixed: () => !!map.arena,

    cameraSubjects() {
      if (rounds.phase === "intro") return sim.activeBalls;
      if (!rounds.racing || loser) return [];
      const order = running();
      return order.slice(-FIGHT).reverse();
    },

    hud(): ModeHud {
      const alive = sim.aliveCount;
      const title = roundTitle(Math.max(1, rounds.round), fieldAtStart);
      const intro = rounds.phase === "intro";
      const t = rounds.elapsed;
      // The title card owns the intro; "GO!" when the gate opens.
      const banner = rounds.racing && t < GO_SECONDS ? "GO!" : undefined;
      const last = rounds.racing && !loser ? running().at(-1) : undefined;
      return {
        headline: "LAST PLACE IS ELIMINATED",
        counterLabel: "COUNTRIES LEFT",
        counterValue: alive,
        showLeader: false,
        status: rounds.racing ? `${title} · ${safe.length}/${fieldAtStart - 1} SAFE` : title,
        banner,
        title: intro
          ? {
              ...(rounds.round === 1 ? { text: `${total} COUNTRIES`, sub: "LAST PLACE IS ELIMINATED" } : { text: title, sub: `${alive} COUNTRIES LEFT` }),
              // In an arena the middle of the rings is where there's room.
              ...(map.arena ? { worldY: RING_CENTER.y - 40 } : {}),
            }
          : undefined,
        featured: last && sim.activeBalls.length > 1 ? { label: "LAST PLACE", ball: last, tone: "danger" } : undefined,
        eliminated,
      };
    },

    onTimeout() {
      sim.declareWinner(rules.rank()[0], "timeout");
    },
  };
  return rules;
}
