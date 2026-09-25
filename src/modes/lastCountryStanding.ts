import type { CountryBall } from "@/entities/CountryBall";
import type { Obstacle } from "@/entities/Obstacle";
import type { Random } from "@/engine/random";
import type { ModeDefinition, ModeRules, Simulation } from "@/engine/simulation";
import type { WorldLayout } from "@/engine/types";
import { autoRadius, createChaos, eliminateKeepingOne, rankSurvival, ringObstacle, type RingOptions } from "./shared";

const WIDTH = 1080;
const HEIGHT = 1920;
const CENTER = { x: WIDTH / 2, y: 900 };
const DEG = Math.PI / 180;

interface RingPlan extends RingOptions {
  /** Gap grows to this over time (radians). */
  maxGap: number;
}

/** Seeded variation: each seed spins the rings differently. */
function ringsFor(scenario: string, ballRadius: number, random: Random): RingPlan[] {
  const direction = random.sign();
  return baseRings(scenario, ballRadius).map((ring) => ({
    ...ring,
    gapAngle: ring.gapAngle + random.float(-0.6, 0.6),
    speed: ring.speed * direction * random.float(0.85, 1.2),
  }));
}

function baseRings(scenario: string, ballRadius: number): RingPlan[] {
  // Gap must comfortably pass a ball, whatever its size.
  const gapFor = (radius: number) => Math.max(10 * DEG, (ballRadius * 2.8) / radius);
  switch (scenario) {
    case "double-ring":
      return [
        { id: "ring-inner", center: CENTER, radius: 300, thickness: 16, gapAngle: -Math.PI / 2, gap: gapFor(300), maxGap: 140 * DEG, speed: 0.75 },
        { id: "ring-outer", center: CENTER, radius: 470, thickness: 18, gapAngle: Math.PI / 2, gap: gapFor(470), maxGap: 120 * DEG, speed: -0.45 },
      ];
    case "triple-ring":
      return [
        { id: "ring-1", center: CENTER, radius: 230, thickness: 14, gapAngle: -Math.PI / 2, gap: gapFor(230), maxGap: 150 * DEG, speed: 0.9 },
        { id: "ring-2", center: CENTER, radius: 350, thickness: 16, gapAngle: Math.PI / 6, gap: gapFor(350), maxGap: 140 * DEG, speed: -0.6 },
        { id: "ring-3", center: CENTER, radius: 470, thickness: 18, gapAngle: (5 * Math.PI) / 6, gap: gapFor(470), maxGap: 120 * DEG, speed: 0.4 },
      ];
    default:
      return [
        { id: "ring", center: CENTER, radius: 460, thickness: 18, gapAngle: -Math.PI / 2, gap: gapFor(460), maxGap: 130 * DEG, speed: 0.55 },
      ];
  }
}

/** Balls spawn anywhere inside the outer ring (440), clear of inner rings. */
const SPAWN_RADIUS = 440;

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

  autoBallRadius(count, scenario) {
    const fill = scenario === "ring" ? 0.3 : 0.24;
    return autoRadius(Math.PI * SPAWN_RADIUS * SPAWN_RADIUS, count, fill, 9, 52);
  },

  createLayout({ scenario, ballRadius, random }): WorldLayout {
    const rings = ringsFor(scenario, ballRadius, random.fork("rings"));
    const outer = rings[rings.length - 1] as RingPlan;
    const outerEdge = outer.radius + outer.thickness;
    const spawn = SPAWN_RADIUS - ballRadius * 0.5;
    return {
      bounds: { x: 0, y: 0, w: WIDTH, h: HEIGHT },
      focus: {
        x: CENTER.x - outerEdge - 40,
        y: CENTER.y - outerEdge - 40,
        w: (outerEdge + 40) * 2,
        h: (outerEdge + 40) * 2,
      },
      obstacles: rings.map((ring) => ringObstacle(ring)),
      zones: [
        { id: "outside", kind: "eliminate", shape: { kind: "outside-circle", x: CENTER.x, y: CENTER.y, r: outerEdge + 2 }, visible: false },
      ],
      spawn: {
        kind: "circle",
        x: CENTER.x,
        y: CENTER.y,
        r: spawn,
        speed: 7,
        avoidBands: rings.slice(0, -1).map((ring) => ({ radius: ring.radius, thickness: ring.thickness })),
      },
    };
  },

  createRules(sim: Simulation): ModeRules {
    const plans = ringsFor(sim.scenario, sim.ballRadius, sim.random.fork("layout").fork("rings"));
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
