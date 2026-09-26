import type { CountryBall } from "@/entities/CountryBall";
import { TICK_RATE } from "@/engine/physicsWorld";
import type { ModeDefinition, ModeRules, Simulation } from "@/engine/simulation";
import type { WorldLayout } from "@/engine/types";
import { createRandom } from "@/engine/random";
import { generateTrack } from "@/tracks/generator";
import { MIDDLE_MODULES, type ModuleKind, type TrackDefinition } from "@/tracks/types";

function isMiddleModule(kind: string): kind is ModuleKind {
  return (MIDDLE_MODULES as readonly string[]).includes(kind);
}
import { autoRadius } from "./shared";

export interface RaceScenario {
  id: string;
  label: string;
  description: string;
  length: number;
  pool?: ModuleKind[];
  difficulty: number;
}

const STALL_TICKS = 3 * TICK_RATE;
const PODIUM = 3;
/** After the first finisher, wait at most this long for the podium. */
const PODIUM_WAIT = 6 * TICK_RATE;

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
  };
}

/** Shared race rules: used by Race and Marble Race. */
export function createRaceMode(options: {
  id: "race" | "marble-race";
  label: string;
  description: string;
  headline: string;
  scenarios: RaceScenario[];
  /** Ball radius cap; marbles are a little smaller. */
  maxRadius?: number;
}): ModeDefinition {
  const scenarioById = (id: string) => options.scenarios.find((s) => s.id === id) ?? (options.scenarios[0] as RaceScenario);

  return {
    id: options.id,
    label: options.label,
    description: options.description,
    scenarios: options.scenarios.map(({ id, label, description }) => ({ id, label, description })),
    defaultCamera: "follow-action",
    defaultParticipants: 32,
    // Stronger gravity keeps races Shorts-length with honest, real-time physics.
    recommendedPhysics: { gravity: 1.6, maxSpeed: 18 },
    defaultDuration: 120,

    autoBallRadius(count) {
      return autoRadius(1000 * 420, count, 0.3, 11, options.maxRadius ?? 32);
    },

    createLayout({ scenario, random, count, ballRadius, track: custom }) {
      const s = scenarioById(scenario);
      const sequence = custom?.sequence.filter(isMiddleModule);
      const track = generateTrack(random.seed, {
        length: s.length,
        pool: s.pool,
        sequence: sequence?.length ? sequence : undefined,
        ballRadius,
        count,
        difficulty: custom?.difficulty ?? s.difficulty,
      });
      return trackLayout(track);
    },

    createRules(sim) {
      return createRaceRules(sim, options.headline);
    },
  };
}

export function createRaceRules(sim: Simulation, headline: string): ModeRules {
  const { bounds } = sim.layout;
  const gateOpensAt = sim.layout.gateOpensAt ?? 0;
  const finishZones = sim.zones.filter((z) => z.kind === "finish");
  const eliminators = sim.zones.filter((z) => z.kind === "eliminate");
  const forces = sim.random.fork("forces");
  const best = new Map<number, number>();
  const stalled = new Map<number, number>();
  const gateTick = Math.round(gateOpensAt * TICK_RATE);
  let firstFinishTick: number | null = null;

  const progress = (b: CountryBall) =>
    b.status === "finished" ? 1e7 - (b.place ?? 0) : b.status === "eliminated" ? -1e7 + (b.eliminatedTick ?? 0) : b.y;

  const rules: ModeRules = {
    afterStep() {
      for (const ball of sim.balls) {
        if (!ball.alive) continue;
        if (finishZones.some((z) => z.contains(ball.x, ball.y, ball.radius))) {
          sim.finish(ball);
          firstFinishTick ??= sim.tick;
          continue;
        }
        const out = ball.x < bounds.x - 100 || ball.x > bounds.x + bounds.w + 100 || ball.y > bounds.y + bounds.h + 300;
        if (out || eliminators.some((z) => z.contains(ball.x, ball.y, ball.radius))) {
          sim.eliminate(ball);
          continue;
        }
        // Anti-stall: a ball that hasn't advanced for a while gets a small kick.
        if (sim.tick > gateTick) {
          const previous = best.get(ball.id) ?? -Infinity;
          if (ball.y > previous + 4) {
            best.set(ball.id, ball.y);
            stalled.set(ball.id, 0);
          } else {
            const ticks = (stalled.get(ball.id) ?? 0) + 1;
            stalled.set(ball.id, ticks);
            if (ticks >= STALL_TICKS) {
              stalled.set(ball.id, 0);
              sim.nudge(ball, forces.float(-7, 7), forces.float(-9, -4));
            }
          }
        }
      }

      const podium = Math.min(PODIUM, sim.balls.length);
      const done =
        sim.finishedCount >= podium ||
        (firstFinishTick !== null && sim.tick - firstFinishTick >= PODIUM_WAIT) ||
        sim.aliveCount === 0;
      if (done) sim.declareWinner(rules.rank()[0]);
    },

    rank() {
      return [...sim.balls].sort((a, b) => progress(b) - progress(a) || a.id - b.id);
    },

    progress,

    leaderActive: () => sim.time >= gateOpensAt + 0.5,

    hud() {
      const t = sim.time;
      const opens = gateOpensAt;
      const banner = t < opens ? String(Math.ceil(opens - t)) : t < opens + 0.8 ? "GO!" : undefined;
      return {
        headline,
        counterLabel: sim.finishedCount > 0 ? "FINISHED" : "COUNTRIES",
        counterValue: sim.finishedCount > 0 ? sim.finishedCount : sim.aliveCount,
        showLeader: t >= opens,
        banner,
      };
    },

    onTimeout() {
      sim.declareWinner(rules.rank()[0], "timeout");
    },
  };
  return rules;
}

export const RACE_SCENARIOS: RaceScenario[] = [
  { id: "classic", label: "Classic", description: "Procedural track, 9 modules (~25–40 s).", length: 9, difficulty: 0.5 },
  { id: "sprint", label: "Sprint", description: "Short procedural track, 5 modules (~15–20 s).", length: 5, difficulty: 0.4 },
  { id: "marathon", label: "Marathon", description: "Long procedural track, 14 modules (~40–55 s).", length: 14, difficulty: 0.6 },
];

export const race = createRaceMode({
  id: "race",
  label: "Country Race",
  description: "Everyone starts behind a gate and races down a seeded procedural track. First across the line wins.",
  headline: "WHO WILL WIN THE RACE?",
  scenarios: RACE_SCENARIOS,
});

/** The module sequence a seed would generate for a scenario (editor preview). */
export function previewSequence(scenarios: RaceScenario[], scenarioId: string, seed: string): ModuleKind[] {
  const s = scenarios.find((x) => x.id === scenarioId) ?? scenarios[0];
  if (!s) return [];
  const layoutSeed = createRandom(seed).fork("layout").seed;
  return generateTrack(layoutSeed, { length: s.length, pool: s.pool, ballRadius: 20, count: 1 })
    .modules.map((m) => m.kind)
    .filter(isMiddleModule);
}
