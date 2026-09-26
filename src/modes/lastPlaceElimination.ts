import type { CountryBall } from "@/entities/CountryBall";
import { TICK_RATE } from "@/engine/physicsWorld";
import type { ModeDefinition, ModeHud, ModeRules, Simulation } from "@/engine/simulation";
import { spawnPoints } from "@/engine/spawn";
import { CoursePath } from "@/tracks/coursePath";
import { buildMap, findMap, listMaps, MAPS } from "@/tracks/maps";
import { trackLayout } from "./race";
import { RoundManager } from "./rounds";
import { autoRadius, startGate } from "./shared";

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

  autoBallRadius(count) {
    return autoRadius(1000 * 420, count, 0.3, 11, 24);
  },

  createLayout({ scenario, random, count, ballRadius }) {
    const map = findMap(scenario) ?? (MAPS[0] as (typeof MAPS)[number]);
    return trackLayout(buildMap(map, random.seed, { ballRadius, count }));
  },

  createRules(sim) {
    return createLastPlaceRules(sim);
  },
};

/** Round banner: "ROUND 4", then "FINAL 5", "FINAL 4", "FINAL 3", "FINAL ROUND". */
export function roundTitle(round: number, remaining: number): string {
  if (remaining <= 2) return "FINAL ROUND";
  if (remaining <= 5) return `FINAL ${remaining}`;
  return `ROUND ${round}`;
}

export function createLastPlaceRules(sim: Simulation): ModeRules {
  const { bounds, spawn } = sim.layout;
  const path = new CoursePath(sim.layout.path ?? [{ x: bounds.x + bounds.w / 2, y: sim.layout.startY ?? 0 }, { x: bounds.x + bounds.w / 2, y: sim.layout.finishY ?? bounds.h }]);
  const finishZones = sim.zones.filter((z) => z.kind === "finish");
  const gate = startGate(sim);
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

  const progressOf = (b: CountryBall) => path.progress(b.x, b.y);

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
      gate.close();
      safe.length = 0;
      best.clear();
      stalled.clear();
      loser = null;
      const field = sim.aliveBalls;
      fieldAtStart = field.length;
      if (round === 1 || spawn.kind !== "rect") return;
      // A fresh seeded grid position for everyone, every round.
      const points = spawnPoints(spawn, field.length, sim.ballRadius, seeded.fork(`spawn-${round}`));
      field.forEach((ball, i) => {
        const p = points[i];
        if (!p) return;
        if (ball.parked) sim.unpark(ball, p.x, p.y);
        else sim.teleport(ball, p.x, p.y);
      });
    },
    onStart() {
      gate.open();
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
      gate.update();
    },

    afterStep() {
      if (!rounds.racing || loser) return;
      const crossing: CountryBall[] = [];
      for (const ball of sim.balls) {
        if (!ball.active) continue;
        if (finishZones.some((z) => z.contains(ball.x, ball.y, ball.radius))) {
          crossing.push(ball);
          continue;
        }
        const out = ball.x < bounds.x - 100 || ball.x > bounds.x + bounds.w + 100 || ball.y > bounds.y + bounds.h + 300;
        if (out) {
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
      if (i >= 0) return path.length + total - i;
      return b.parked ? path.length : progressOf(b);
    },

    // There's no leader to chase here: the story is at the back.
    leaderActive: () => false,

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
          ? rounds.round === 1
            ? { text: `${total} COUNTRIES`, sub: "LAST PLACE IS ELIMINATED" }
            : { text: title, sub: `${alive} COUNTRIES LEFT` }
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
