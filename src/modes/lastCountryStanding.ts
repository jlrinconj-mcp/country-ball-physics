import type { CountryBall } from "@/entities/CountryBall";
import type { Obstacle } from "@/entities/Obstacle";
import type { ModeDefinition, ModeRules, Simulation } from "@/engine/simulation";
import type { WorldLayout } from "@/engine/types";
import { arenaLayout, ARENA_HEIGHT as HEIGHT, RING_CENTER as CENTER, ringsFor, SPAWN_RADIUS } from "./arena";

const DEG = Math.PI / 180;
import { findMap } from "@/tracks/maps";
import { configMap, mapBallRadius, mapLayout, trackCourse } from "./course";
import { autoRadius, createChaos, eliminateKeepingOne, rankSurvival, ringObstacle } from "./shared";

export { RING_CENTER, ringsFor, type RingPlan } from "./arena";

export const lastCountryStanding: ModeDefinition = {
  id: "last-country-standing",
  label: "Last Country Standing",
  description: "Everyone starts inside spinning rings. Escape the outer ring and you're out. Last country inside wins.",
  scenarios: [
    { id: "ring", label: "Spinning Ring", description: "One ring with a gap that slowly widens." },
    { id: "double-ring", label: "Double Ring", description: "Two counter-rotating rings; countries start in both layers." },
    { id: "triple-ring", label: "Triple Ring", description: "Three nested rings; the inner ones must escape up to three gaps." },
  ],
  defaultCamera: "fixed",
  defaultParticipants: 48,
  defaultDuration: 90,

  autoBallRadius(count, scenario, mapId) {
    const map = findMap(mapId);
    if (map && !map.arena) return mapBallRadius(map, count);
    const arena = map?.arena ?? scenario;
    const fill = arena === "ring" ? 0.3 : 0.24;
    return autoRadius(Math.PI * SPAWN_RADIUS * SPAWN_RADIUS, count, fill, 9, 52);
  },

  createLayout(ctx): WorldLayout {
    // Any map: a ring arena plays as usual; on a track, see `lastOnTrackRules`.
    const map = findMap(ctx.map);
    if (map && !map.arena) return mapLayout(map, ctx);
    return arenaLayout(map?.arena ?? ctx.scenario, ctx.ballRadius, ctx.random);
  },

  createRules(sim: Simulation): ModeRules {
    const map = configMap(sim);
    if (map && !map.arena) return lastOnTrackRules(sim);
    const arena = map?.arena ?? sim.scenario;
    const plans = ringsFor(arena, sim.ballRadius, sim.random.fork("layout").fork("rings"));
    const rings = plans.map((plan) => ({
      plan,
      gap: plan.gap,
      obstacle: sim.obstacles.find((o) => o.id === plan.id) as Obstacle,
    }));
    const chaos = createChaos(sim, sim.random.fork("forces"));
    const eliminator = sim.zones.find((z) => z.kind === "eliminate");
    const distance = (b: CountryBall) => Math.hypot(b.x - CENTER.x, b.y - CENTER.y);

    // Pressure ramps from 0 → 1 between 35% and 90% of the time limit.
    const pressure = () => {
      const t = sim.time / sim.config.maxDuration;
      return Math.min(1, Math.max(0, (t - 0.35) / 0.55));
    };

    return {
      beforeStep() {
        // Every 3 s under pressure, each ring's gap opens a little wider.
        if (sim.tick % 180 !== 0) return;
        const p = pressure();
        if (p <= 0) return;
        for (const ring of rings) {
          const target = ring.plan.gap + (ring.plan.maxGap - ring.plan.gap) * p;
          if (target - ring.gap < 2 * DEG) continue;
          ring.gap = target;
          // Rebuild at motion-time-0 orientation; the motion script re-poses it.
          sim.replaceObstacle(ring.obstacle, ringObstacle({ ...ring.plan, gap: ring.gap }));
        }
      },

      afterStep() {
        chaos(0.6 + pressure());
        const out: CountryBall[] = [];
        for (const ball of sim.balls) {
          if (!ball.alive) continue;
          if (eliminator?.contains(ball.x, ball.y, ball.radius) || ball.y > HEIGHT + 200) out.push(ball);
        }
        if (out.length > 0) {
          out.sort((a, b) => distance(b) - distance(a) || a.id - b.id);
          eliminateKeepingOne(sim, out);
        } else if (sim.aliveCount === 1) {
          sim.declareWinner(sim.aliveBalls[0]);
        }
      },

      rank() {
        return rankSurvival(sim.balls, (a, b) => distance(a) - distance(b));
      },

      hud() {
        return {
          headline: "WHICH COUNTRY WILL WIN?",
          counterLabel: "COUNTRIES REMAINING",
          counterValue: sim.aliveCount,
          showLeader: false,
        };
      },

      onTimeout() {
        // Closest to the centre survives.
        sim.declareWinner(this.rank()[0], "timeout");
      },
    };
  },
};

/** Countdown before the gate opens on a track. */
const TRACK_COUNTDOWN = 3;

/**
 * Last Country Standing on a track: reaching the bottom is escaping, and
 * escaping knocks you out. The last country still on the track wins. Stuck
 * balls get kicked and, as a last resort, drop through what holds them, so
 * hiding in a corner doesn't win.
 */
function lastOnTrackRules(sim: Simulation): ModeRules {
  const course = trackCourse(sim);
  const forces = sim.random.fork("forces");
  const best = new Map<number, number>();
  const stuckSince = new Map<number, number>();
  let opened = false;
  course.close();

  const progress = (b: CountryBall) => course.progress(b);
  const rules: ModeRules = {
    beforeStep() {
      if (!opened && sim.time >= TRACK_COUNTDOWN) {
        opened = true;
        course.open();
      }
      course.update(null);
    },

    afterStep() {
      if (!opened) return;
      const out: CountryBall[] = [];
      for (const ball of sim.balls) {
        if (!ball.active) continue;
        if (course.made(ball) || course.lost(ball)) {
          out.push(ball);
          continue;
        }
        const p = progress(ball);
        if (p > (best.get(ball.id) ?? -Infinity) + 4) {
          best.set(ball.id, p);
          stuckSince.set(ball.id, sim.tick);
          continue;
        }
        const still = sim.tick - (stuckSince.get(ball.id) ?? sim.tick);
        if (still > 0 && still % (3 * 60) === 0) sim.nudge(ball, forces.float(-7, 7), forces.float(-9, -4));
        if (still >= 7 * 60) {
          stuckSince.set(ball.id, sim.tick);
          sim.phase(ball, 0.5);
        }
      }
      // Several out on the same tick: the one further down went out first.
      out.sort((a, b) => progress(b) - progress(a) || a.id - b.id);
      if (out.length) eliminateKeepingOne(sim, out, { fall: false });
      else if (sim.aliveCount === 1) sim.declareWinner(sim.aliveBalls[0]);
    },

    // Survivors first, the one furthest from the bottom leading.
    rank: () => rankSurvival(sim.balls, (a, b) => progress(a) - progress(b)),
    progress: (b) => (b.alive ? -progress(b) : -1e7 + (b.eliminatedTick ?? 0)),
    leaderActive: () => opened,
    cameraMoment: () => (opened ? "live" : "setup"),

    hud() {
      const t = sim.time;
      return {
        headline: "LAST ONE ON THE TRACK WINS",
        counterLabel: "COUNTRIES REMAINING",
        counterValue: sim.aliveCount,
        showLeader: false,
        banner: t < TRACK_COUNTDOWN ? String(Math.ceil(TRACK_COUNTDOWN - t)) : t < TRACK_COUNTDOWN + 0.8 ? "GO!" : undefined,
      };
    },

    onTimeout() {
      sim.declareWinner(rules.rank()[0], "timeout");
    },
  };
  return rules;
}
