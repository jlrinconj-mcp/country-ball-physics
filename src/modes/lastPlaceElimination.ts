import type { CountryBall } from "@/entities/CountryBall";
import { TICK_RATE } from "@/engine/physicsWorld";
import type { Random } from "@/engine/random";
import type { ModeDefinition, ModeHud, ModeRules, Simulation } from "@/engine/simulation";
import { spawnPoints } from "@/engine/spawn";
import { findMap, listMaps, MAPS, type MapDefinition } from "@/tracks/maps";
import { RING_CENTER } from "./arena";
import { courseFor, mapBallRadius, mapLayout } from "./course";
import { RoundManager } from "./rounds";

/** Intro before round 1: the "32 COUNTRIES" title card. */
const FIRST_INTRO = 3;
/** Intro before later rounds: "ROUND 7" card… */
const INTRO = 1.6;
/** …and a longer one for "FINAL 5" to "FINAL ROUND" (small fields race fast). */
const FINALS_INTRO = 2.4;
/** Outcome on screen before the next round. */
const RESULT = 1.4;
/** A ball that hasn't advanced for this long gets a kick… */
const STALL_TICKS = 3 * TICK_RATE;
/** …and after this long it drops through whatever holds it (tracks only). */
const RESCUE_TICKS = 7 * TICK_RATE;
const GO_SECONDS = 0.8;
/** How many of the stragglers the camera keeps in shot. */
const FIGHT = 3;

export const lastPlaceElimination: ModeDefinition = {
  id: "last-place-elimination",
  label: "Last Place Elimination",
  description:
    "Rounds on one map. Cross the line and you're safe until the next round; the last country still on the course is eliminated. Everyone restarts from a new seeded grid position each round, until one country is left.",
  scenarios: listMaps().map(({ id, label, description }) => ({ id, label, description })),
  // Shorts-style: the leader, then the last place, taking turns.
  defaultCamera: "leader-last",
  defaultParticipants: 32,
  // Soft bounces (as in Elimination Drop) so peg maps flow instead of
  // bouncing balls back up: rounds stay short.
  recommendedPhysics: { gravity: 1.6, maxSpeed: 18, restitution: 0.45 },
  defaultDuration: 3600,

  autoBallRadius(count, scenario, map) {
    return mapBallRadius(mapFor(scenario, map), count);
  },

  createLayout(ctx) {
    return mapLayout(mapFor(ctx.scenario, ctx.map), ctx);
  },

  createRules(sim) {
    return createLastPlaceRules(sim);
  },
};

function mapFor(scenario: string, mapId?: string): MapDefinition {
  return findMap(mapId) ?? findMap(scenario) ?? (MAPS[0] as MapDefinition);
}

/** From this many countries on, one goes out per round. */
const FINALS = 5;

/**
 * How many go out in a round that starts with `field` countries: the back
 * third while the field is big ("batch"), never going below the final five,
 * then one a round. 32 → 21 → 14 → 9 → 6 → 5 → 4 → 3 → 2 → 1.
 */
export function roundCut(field: number, elimination: "batch" | "single" = "batch"): number {
  if (elimination === "single" || field <= FINALS + 1) return 1;
  return Math.max(1, Math.min(field - FINALS, Math.ceil(field / 3)));
}

/** Round banner: "ROUND 4", then "FINAL 5", "FINAL 4", "FINAL 3", "FINAL ROUND". */
export function roundTitle(round: number, remaining: number): string {
  if (remaining <= 2) return "FINAL ROUND";
  if (remaining <= 5) return `FINAL ${remaining}`;
  return `ROUND ${round}`;
}

/** Visit every short map before repeating; mix arenas into the track rounds. */
export function continuousMapRotation(first: MapDefinition, random: Random): () => MapDefinition {
  const maps = listMaps().filter((map) => !map.epic);
  let current = first;
  let remaining = random.shuffle(maps.filter((map) => map.id !== first.id));
  return () => {
    if (remaining.length === 0) remaining = random.shuffle(maps);
    // Prefer a change of course type while there are both types left. This
    // brings the rings into short competitions as well as longer sessions.
    const differentType = remaining.findIndex((map) => !!map.arena !== !!current.arena);
    const differentMap = remaining.findIndex((map) => map.id !== current.id);
    const index = differentType >= 0 ? differentType : Math.max(0, differentMap);
    current = remaining.splice(index, 1)[0] as MapDefinition;
    return current;
  };
}

export function createLastPlaceRules(sim: Simulation): ModeRules {
  let map = mapFor(sim.scenario, sim.config.map);
  let course = courseFor(sim, map);
  let { spawn } = course;
  const seeded = sim.random.fork("rounds");
  const nextMap = sim.config.continuous ? continuousMapRotation(map, seeded.fork("maps")) : null;
  const forces = sim.random.fork("forces");
  const total = sim.balls.length;

  /** Safe this round, in the order they crossed. */
  const safe: CountryBall[] = [];
  /** Finishing position in the previous round (tie-breaker). */
  const previous = new Map<number, number>();
  const eliminated: CountryBall[] = [];
  const best = new Map<number, number>();
  const stalled = new Map<number, number>();
  const stuckSince = new Map<number, number>();
  /** The round is decided (its losers are out). */
  let decided = false;
  let fieldAtStart = total;
  /** Countries going out this round. */
  let cut = 1;
  const elimination = sim.config.elimination ?? "batch";

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

  /**
   * The fight for the last safe place: the best-placed ball that would go out
   * if the round ended now, then its neighbours either side of the cut. With
   * one out a round that's simply the last few.
   */
  const bubble = () => {
    const order = running();
    const edge = Math.max(0, order.length - cut);
    return [edge, edge - 1, edge + 1, edge - 2]
      .map((i) => order[i])
      .filter((b): b is CountryBall => !!b)
      .slice(0, FIGHT);
  };

  /** Everyone still on the course is out, the furthest behind placed last. */
  const decide = (losers: CountryBall[]) => {
    if (decided) return;
    decided = true;
    for (const ball of [...losers].sort(compare).reverse()) {
      sim.eliminate(ball);
      eliminated.unshift(ball);
    }
    previous.clear();
    safe.forEach((b, i) => previous.set(b.id, i));
    if (sim.aliveCount === 1) sim.declareWinner(sim.aliveBalls[0]);
    else rounds.end();
  };

  const rounds = new RoundManager(sim, {
    intro: (round) => (round === 1 ? FIRST_INTRO : sim.aliveCount <= 5 ? FINALS_INTRO : INTRO),
    // A round ends when everyone but one has crossed, never on the clock.
    limit: Infinity,
    result: RESULT,
    onSetup(round) {
      if (round > 1 && nextMap) {
        map = nextMap();
        sim.replaceLayout(mapLayout(map, {
          scenario: map.id,
          map: map.id,
          random: sim.random.fork("layout"),
          count: sim.aliveCount,
          ballRadius: sim.ballRadius,
        }));
        course = courseFor(sim, map);
        spawn = course.spawn;
      }
      course.close();
      safe.length = 0;
      best.clear();
      stalled.clear();
      stuckSince.clear();
      decided = false;
      const field = sim.aliveBalls;
      fieldAtStart = field.length;
      cut = roundCut(field.length, elimination);
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
    onLimit() {},
  });

  const antiStall = (ball: CountryBall) => {
    const p = progressOf(ball);
    if (p > (best.get(ball.id) ?? -Infinity) + 4) {
      best.set(ball.id, p);
      stalled.set(ball.id, 0);
      stuckSince.set(ball.id, sim.tick);
      return;
    }
    if (course.rescue && sim.tick - (stuckSince.get(ball.id) ?? sim.tick) >= RESCUE_TICKS) {
      stuckSince.set(ball.id, sim.tick);
      sim.phase(ball, 0.5);
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
      course.update(rounds.racing && !decided ? rounds.elapsed : null);
    },

    afterStep() {
      if (!rounds.racing || decided) return;
      course.kick();
      const crossing: CountryBall[] = [];
      for (const ball of sim.balls) {
        if (!ball.active) continue;
        if (course.made(ball)) {
          crossing.push(ball);
          continue;
        }
        if (course.lost(ball)) {
          // Knocked out of the world somehow: back to the start, not out.
          const p = spawnPoints(spawn, 1, sim.ballRadius, seeded.fork(`lost-${sim.tick}-${ball.id}`))[0];
          if (p) sim.teleport(ball, p.x, p.y);
          continue;
        }
        if (rounds.elapsed > 0.5) antiStall(ball);
      }
      crossing.sort(compare);
      // Only so many places are safe: crossing on the same tick as the last
      // safe one, the ones further behind are out.
      const places = fieldAtStart - cut - safe.length;
      for (const ball of crossing.slice(0, places)) {
        sim.park(ball);
        safe.push(ball);
      }
      if (safe.length >= fieldAtStart - cut) decide(sim.activeBalls);
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

    cameraMoment: () => (rounds.phase === "intro" ? "setup" : rounds.racing && !decided ? "live" : "hold"),

    boostDirection: (b) => (rounds.racing && !decided ? course.boost(b) : null),

    cameraSubjects() {
      if (rounds.phase === "intro") return sim.activeBalls;
      if (!rounds.racing || decided) return [];
      return bubble();
    },

    hud(): ModeHud {
      const alive = sim.aliveCount;
      const title = roundTitle(Math.max(1, rounds.round), fieldAtStart);
      const intro = rounds.phase === "intro";
      const t = rounds.elapsed;
      // The title card owns the intro; "GO!" when the gate opens.
      const banner = rounds.racing && t < GO_SECONDS ? "GO!" : undefined;
      const last = rounds.racing && !decided ? bubble()[0] : undefined;
      const out = cut > 1 ? `LAST ${cut} ARE ELIMINATED` : "LAST PLACE IS ELIMINATED";
      const status = rounds.racing ? `${title} · ${safe.length}/${fieldAtStart - cut} SAFE` : title;
      return {
        headline: out,
        counterLabel: "COUNTRIES LEFT",
        counterValue: alive,
        showLeader: false,
        status: sim.config.continuous ? `${status} · ${map.label}` : status,
        banner,
        title: intro
          ? {
              ...(rounds.round === 1 ? { text: `${total} COUNTRIES`, sub: out } : { text: title, sub: cut > 1 ? out : `${alive} COUNTRIES LEFT` }),
              ...(sim.config.continuous ? { sub: `${map.label.toUpperCase()} · ${out}` } : {}),
              // In an arena the middle of the rings is where there's room.
              ...(map.arena ? { worldY: RING_CENTER.y - 40 } : {}),
            }
          : undefined,
        featured: last && sim.activeBalls.length > 1 ? { label: cut > 1 ? "DANGER" : "LAST PLACE", ball: last, tone: "danger" } : undefined,
        eliminated,
      };
    },

    onTimeout() {
      sim.declareWinner(rules.rank()[0], "timeout");
    },
  };
  return rules;
}
