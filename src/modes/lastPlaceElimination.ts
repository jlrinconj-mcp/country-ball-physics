import type { CountryBall } from "@/entities/CountryBall";
import { TICK_RATE } from "@/engine/physicsWorld";
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

/** Round banner: "ROUND 4", then "FINAL 5", "FINAL 4", "FINAL 3", "FINAL ROUND". */
export function roundTitle(round: number, remaining: number): string {
  if (remaining <= 2) return "FINAL ROUND";
  if (remaining <= 5) return `FINAL ${remaining}`;
  return `ROUND ${round}`;
}

export function createLastPlaceRules(sim: Simulation): ModeRules {
  const map = mapFor(sim.scenario, sim.config.map);
  const course = courseFor(sim, map);
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
  const stuckSince = new Map<number, number>();
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
    // A round ends when everyone but one has crossed, never on the clock.
    limit: Infinity,
    result: RESULT,
    onSetup(round) {
      course.close();
      safe.length = 0;
      best.clear();
      stalled.clear();
      stuckSince.clear();
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
      course.update(rounds.racing && !loser ? rounds.elapsed : null);
    },

    afterStep() {
      if (!rounds.racing || loser) return;
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

    cameraMoment: () => (rounds.phase === "intro" ? "setup" : rounds.racing && !loser ? "live" : "hold"),

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
