import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@/engine/defaults";
import { TICK_RATE } from "@/engine/physicsWorld";
import type { SimulationResult } from "@/engine/simulation";
import { makeTestCountries } from "@/engine/testing";
import type { SimulationConfig } from "@/engine/types";
import { listMaps } from "@/tracks/maps";
import { createSimulation, modeDefaults } from "./index";
import { roundCut, roundTitle } from "./lastPlaceElimination";

const countries = makeTestCountries(32);

type Elimination = "batch" | "single";

function config(map: string, seed: string, elimination: Elimination = "batch"): SimulationConfig {
  return {
    ...DEFAULT_CONFIG,
    ...modeDefaults("last-place-elimination"),
    scenario: map,
    seed,
    countries: countries.map((c) => c.cca3),
    maxParticipants: 32,
    elimination,
  };
}

/** How many go out each round, from `field` countries down to one. */
function cuts(field: number, elimination: Elimination = "batch"): number[] {
  const out: number[] = [];
  for (let n = field; n > 1; n -= out.at(-1) as number) out.push(roundCut(n, elimination));
  return out;
}

interface Round {
  round: number;
  start: number;
  /** Where each ball (by id) starts the round. */
  grid: Map<number, string>;
  eliminated: string[];
  /** Balls that crossed the line, in order. */
  safe: string[];
  /** Every alive ball had a body at the start (parked balls were put back). */
  allPlaced: boolean;
}

/** Run a whole game and record it round by round. */
function play(map: string, seed: string, elimination: Elimination = "batch") {
  const sim = createSimulation(config(map, seed, elimination), countries);
  const rounds: Round[] = [];
  const spawn = sim.layout.spawn;
  let inBox = true;
  sim.events.on("roundStarted", ({ round, tick }) => {
    const alive = sim.aliveBalls;
    rounds.push({
      round,
      start: tick,
      grid: new Map(alive.map((b) => [b.id, `${b.x.toFixed(3)},${b.y.toFixed(3)}`])),
      eliminated: [],
      safe: [],
      allPlaced: alive.every((b) => b.body !== null && !b.parked),
    });
    if (spawn.kind === "rect") {
      inBox &&= alive.every((b) => b.x >= spawn.x && b.x <= spawn.x + spawn.w && b.y >= spawn.y - 1 && b.y <= spawn.y + spawn.h + 1);
    }
  });
  let parkedWithBody = 0;
  sim.events.on("countryParked", ({ ball }) => {
    rounds.at(-1)?.safe.push(ball.code);
    if (ball.body) parkedWithBody++;
  });
  sim.events.on("countryEliminated", ({ ball }) => rounds.at(-1)?.eliminated.push(ball.code));
  const result = sim.runToEnd() as SimulationResult;
  const end = sim.tick;
  sim.destroy();
  const lengths = rounds.map((r, i) => ((rounds[i + 1]?.start ?? end) - r.start) / TICK_RATE);
  return { result, rounds, lengths, inBox, parkedWithBody };
}

describe("roundCut", () => {
  it("takes the back third of a big field, then one a round from the final five", () => {
    expect(cuts(32)).toEqual([11, 7, 5, 3, 1, 1, 1, 1, 1]);
    expect(cuts(8)).toEqual([3, 1, 1, 1, 1]);
    expect(cuts(6)).toEqual([1, 1, 1, 1, 1]);
    expect(cuts(195)).toHaveLength(13);
    expect(cuts(32, "single")).toEqual(Array(31).fill(1));
  });
});

describe("roundTitle", () => {
  it("counts down the finals", () => {
    expect(roundTitle(1, 32)).toBe("ROUND 1");
    expect(roundTitle(27, 6)).toBe("ROUND 27");
    expect(roundTitle(28, 5)).toBe("FINAL 5");
    expect(roundTitle(30, 3)).toBe("FINAL 3");
    expect(roundTitle(31, 2)).toBe("FINAL ROUND");
  });
});

describe("Last Place Elimination", () => {
  it("offers every map in the registry", () => {
    expect(modeDefaults("last-place-elimination").scenario).toBe("plinko");
    const sim = createSimulation(config("marble", "maps"), countries);
    expect(sim.scenario).toBe("marble");
    sim.destroy();
    expect(listMaps().map((m) => m.id)).toEqual(expect.arrayContaining(["plinko", "pinball", "zigzag", "funnel", "spinner", "drop", "marble"]));
  });

  // Plinko is the reference map (Shorts pace: several out a round); Funnel is
  // a second, very different course, one out a round (long format).
  describe.each([
    ["plinko", "batch"],
    ["funnel", "single"],
  ] as const)("%s with 32 countries (%s)", (map, elimination) => {
    let game: ReturnType<typeof play>;
    const expected = cuts(32, elimination);
    beforeAll(() => {
      game = play(map, `lpe-${map}`, elimination);
    }, 60_000);

    it("plays down to a single winner, the right number out each round", () => {
      const { result, rounds } = game;
      expect(result.decidedBy).toBe("physics");
      expect(rounds).toHaveLength(expected.length);
      expect(rounds.map((r) => r.eliminated.length)).toEqual(expected);
      expect(result.ranking.map((r) => r.place)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
      expect(result.ranking.filter((r) => r.status === "eliminated")).toHaveLength(31);
      expect(result.ranking[0]).toMatchObject({ cca3: result.winner.cca3, status: "alive" });
      // The first one out (furthest behind in round 1) is 32nd, the last one out is 2nd.
      expect(result.ranking[31]?.cca3).toBe(rounds[0]?.eliminated[0]);
      expect(result.ranking[1]?.cca3).toBe(rounds.at(-1)?.eliminated.at(-1));
    });

    it("eliminates exactly the countries that didn't cross the line", () => {
      let field = 32;
      for (const [i, r] of game.rounds.entries()) {
        for (const out of r.eliminated) expect(r.safe).not.toContain(out);
        // A round only ends once all the safe places are taken.
        expect(r.safe).toHaveLength(field - (expected[i] as number));
        field -= expected[i] as number;
      }
    });

    it("retires balls at the line and puts them back for the next round", () => {
      expect(game.parkedWithBody).toBe(0);
      expect(game.rounds.every((r) => r.allPlaced)).toBe(true);
      expect(game.inBox).toBe(true);
    });

    it("starts everyone from a new seeded grid position each round", () => {
      for (let i = 0; i + 1 < game.rounds.length; i++) {
        const a = game.rounds[i] as Round;
        const b = game.rounds[i + 1] as Round;
        const moved = [...b.grid].filter(([id, pos]) => a.grid.get(id) !== pos).length;
        expect(moved).toBeGreaterThanOrEqual(b.grid.size - 1);
      }
    });

    it("keeps rounds at 8–15 s", () => {
      // The final round ends at the decisive crossing, so it's shorter.
      const full = game.lengths.slice(0, -1);
      expect(Math.min(...full)).toBeGreaterThanOrEqual(8);
      expect(Math.max(...full)).toBeLessThanOrEqual(15);
    });
  });

  it("replays identically from the same seed", () => {
    const a = play("plinko", "lpe-replay");
    const b = play("plinko", "lpe-replay");
    expect(b.result.fingerprint).toBe(a.result.fingerprint);
    expect(b.result.timeline).toEqual(a.result.timeline);
    expect(b.rounds.map((r) => [r.start, [...r.grid], r.safe, r.eliminated])).toEqual(a.rounds.map((r) => [r.start, [...r.grid], r.safe, r.eliminated]));
    // …and a different seed plays out differently.
    const c = play("plinko", "lpe-replay-2");
    expect(c.result.fingerprint).not.toBe(a.result.fingerprint);
  }, 60_000);
});

describe("Last Place Elimination on every map", () => {
  const small = makeTestCountries(10);
  const cfg = (map: string): SimulationConfig => ({
    ...DEFAULT_CONFIG,
    ...modeDefaults("last-place-elimination"),
    scenario: map,
    seed: `every-${map}`,
    countries: small.map((c) => c.cca3),
    maxParticipants: 10,
  });

  it.each(listMaps().map((m) => m.id))("%s plays down to one winner, identically twice", (map) => {
    const run = () => {
      const sim = createSimulation(cfg(map), small);
      let rounds = 0;
      sim.events.on("roundStarted", () => rounds++);
      const result = sim.runToEnd() as SimulationResult;
      sim.destroy();
      return { result, rounds };
    };
    const a = run();
    const b = run();
    expect(a.result.decidedBy).toBe("physics");
    expect(a.rounds).toBe(cuts(10).length);
    expect(a.result.ranking.filter((r) => r.status === "eliminated")).toHaveLength(9);
    expect(b.result.fingerprint).toBe(a.result.fingerprint);
  }, 30_000);

  it("arenas: the rings stay shut during the intro, then balls escape to safety", () => {
    const sim = createSimulation(cfg("double-ring"), small);
    let escapedEarly = 0;
    let parked = 0;
    sim.events.on("countryParked", () => parked++);
    for (let i = 0; i < 3 * TICK_RATE - 5; i++) {
      sim.step();
      escapedEarly += sim.balls.filter((b) => Math.hypot(b.x - 540, b.y - 900) > 500).length;
    }
    expect(escapedEarly).toBe(0);
    while (parked === 0 && sim.tick < 20 * TICK_RATE) sim.step();
    expect(parked).toBeGreaterThan(0);
    sim.destroy();
  });
});
