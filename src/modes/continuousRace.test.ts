import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@/engine/defaults";
import { createRandom } from "@/engine/random";
import type { SimulationResult } from "@/engine/simulation";
import { makeTestCountries } from "@/engine/testing";
import type { SimulationConfig } from "@/engine/types";
import { getMap, listMaps } from "@/tracks/maps";
import { createSimulation, modeDefaults } from "./index";
import { continuousMapRotation, roundCut } from "./lastPlaceElimination";

const countries = makeTestCountries(10);
const config: SimulationConfig = {
  ...DEFAULT_CONFIG,
  ...modeDefaults("last-place-elimination"),
  scenario: "plinko",
  seed: "continuous-race",
  countries: countries.map((country) => country.cca3),
  maxParticipants: 10,
  continuous: true,
};

describe("continuous Last Place map rotation", () => {
  it("uses every short map before repeating, and never repeats consecutive maps", () => {
    const first = getMap("plinko");
    const next = continuousMapRotation(first, createRandom("rotation"));
    const count = listMaps().filter((map) => !map.epic).length;
    const order = [first, ...Array.from({ length: count * 2 - 1 }, next)];
    const expected = listMaps().filter((map) => !map.epic).map((map) => map.id).sort();
    expect(order.slice(0, count).map((map) => map.id).sort()).toEqual(expected);
    expect(order.slice(count).map((map) => map.id).sort()).toEqual(expected);
    expect(order.slice(1).every((map, index) => map.id !== order[index]?.id)).toBe(true);
    expect(order[1]?.arena).toBeDefined();
    expect(order[2]?.arena).toBeUndefined();
  });

  it("keeps an explicitly selected epic map first, then rotates through short maps", () => {
    const next = continuousMapRotation(getMap("grand-gauntlet"), createRandom("epic-first"));
    const count = listMaps().filter((map) => !map.epic).length;
    const cycle = Array.from({ length: count }, next);
    expect(cycle.every((map) => !map.epic)).toBe(true);
    expect(new Set(cycle.map((map) => map.id)).size).toBe(count);
  });
});

function play(withLiveInputs = false, replay?: SimulationConfig["inputs"]) {
  const sim = createSimulation({ ...config, inputs: replay }, countries);
  const rounds: { map: string; codes: string[]; tick: number; allPlaced: boolean }[] = [];
  const eliminated = new Set<string>();
  const boosted = new Set<number>();
  let returned = false;
  sim.events.on("countryEliminated", ({ ball }) => eliminated.add(ball.code));
  sim.events.on("roundStarted", ({ tick }) => {
    const map = listMaps().find((map) => sim.rules.hud().status?.endsWith(map.label));
    if (!map) throw new Error("Continuous round is missing its current map");
    const codes = sim.aliveBalls.map((ball) => ball.code);
    returned ||= codes.some((code) => eliminated.has(code));
    rounds.push({ map: map.id, codes, tick, allPlaced: sim.aliveBalls.every((ball) => !!ball.body && !ball.parked) });
  });
  while (sim.status !== "finished" && sim.tick <= sim.maxTicks) {
    if (withLiveInputs && sim.rules.cameraMoment?.() === "live" && !boosted.has(rounds.length)) {
      const ball = sim.activeBalls[0];
      if (ball && sim.input("boost", ball.code)) boosted.add(rounds.length);
    }
    sim.step();
  }
  const result = sim.result as SimulationResult;
  const inputs = [...sim.inputs];
  const aliveCount = sim.aliveCount;
  sim.destroy();
  return { result, rounds, inputs, aliveCount, returned };
}

describe("continuous Last Place competition", () => {
  it("changes between tracks and arenas while keeping only survivors, then declares one champion", () => {
    const game = play();
    expect(game.result?.decidedBy).toBe("physics");
    expect(game.aliveCount).toBe(1);
    expect(game.result.ranking.filter((entry) => entry.status === "eliminated")).toHaveLength(9);
    expect(game.rounds[0]?.map).toBe("plinko");
    expect(game.rounds.every((round) => round.allPlaced)).toBe(true);
    expect(game.returned).toBe(false);
    expect(new Set(game.rounds.map((round) => round.map)).size).toBe(game.rounds.length);
    expect(game.rounds.some((round) => !!getMap(round.map).arena)).toBe(true);
    expect(game.rounds.some((round) => !getMap(round.map).arena)).toBe(true);
    for (let index = 1; index < game.rounds.length; index++) {
      const previous = game.rounds[index - 1]!;
      const current = game.rounds[index]!;
      expect(current.tick).toBeGreaterThan(previous.tick);
      expect(current.codes).toHaveLength(previous.codes.length - roundCut(previous.codes.length));
      expect(current.codes.every((code) => previous.codes.includes(code))).toBe(true);
    }
  }, 30_000);

  it("records inputs through course changes and replays the complete competition identically", () => {
    const live = play(true);
    const replay = play(false, live.inputs);
    expect(live.result?.decidedBy).toBe("physics");
    expect(live.result.timeline.filter((entry) => entry.type === "boost").length).toBeGreaterThan(1);
    expect(replay.result.fingerprint).toBe(live.result.fingerprint);
    expect(replay.result.timeline).toEqual(live.result.timeline);
    expect(replay.rounds).toEqual(live.rounds);
    expect(replay.inputs).toEqual(live.inputs);
  }, 30_000);
});
