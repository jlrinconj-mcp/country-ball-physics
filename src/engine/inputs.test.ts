import { describe, expect, it } from "vitest";
import { createSimulation, listModes, modeDefaults } from "@/modes";
import { DEFAULT_CONFIG } from "./defaults";
import { TICK_RATE } from "./physicsWorld";
import type { SimulationResult } from "./simulation";
import { makeTestCountries } from "./testing";
import type { ModeId, SimulationConfig } from "./types";

const countries = makeTestCountries(10);

function config(mode: ModeId, map?: string): SimulationConfig {
  return {
    ...DEFAULT_CONFIG,
    ...modeDefaults(mode),
    seed: `inputs-${mode}`,
    countries: countries.map((c) => c.cca3),
    maxParticipants: 10,
    ...(map ? { map } : {}),
  };
}

/** A live game: one country boosted every 2 s by "viewers". */
function live(cfg: SimulationConfig): { result: SimulationResult; inputs: SimulationConfig["inputs"]; boosts: number } {
  const sim = createSimulation(cfg, countries);
  let boosts = 0;
  sim.events.on("boosted", () => boosts++);
  while (sim.status !== "finished") {
    if (sim.tick % (2 * TICK_RATE) === 0) {
      const target = sim.activeBalls[(sim.tick / (2 * TICK_RATE)) % Math.max(1, sim.activeBalls.length)];
      if (target) sim.input("boost", target.code);
    }
    sim.step();
  }
  const result = sim.result as SimulationResult;
  const inputs = [...sim.inputs];
  sim.destroy();
  return { result, inputs, boosts };
}

describe("viewer inputs", () => {
  it.each(listModes().map((m) => m.id))("%s: a live game with boosts replays exactly from its input log", (mode) => {
    const cfg = config(mode);
    const plain = createSimulation(cfg, countries).runToEnd() as SimulationResult;
    const game = live(cfg);
    expect(game.boosts).toBeGreaterThan(0);
    // The boosts changed the game…
    expect(game.result.fingerprint).not.toBe(plain.fingerprint);
    // …and its log reproduces it.
    const replay = createSimulation({ ...cfg, inputs: game.inputs }, countries);
    let boosts = 0;
    replay.events.on("boosted", () => boosts++);
    const again = replay.runToEnd() as SimulationResult;
    replay.destroy();
    expect(again.fingerprint).toBe(game.result.fingerprint);
    expect(boosts).toBe(game.boosts);
  }, 60_000);

  it("ignores boosts for countries that are out or unknown", () => {
    const sim = createSimulation(config("race"), countries);
    expect(sim.input("boost", "ZZZ")).toBe(false);
    sim.runToEnd();
    expect(sim.input("boost", countries[0]!.cca3)).toBe(false);
    sim.destroy();
  });

  it("boosts on a ring arena push a ball out", () => {
    const sim = createSimulation(config("race", "ring"), countries);
    while (sim.time < 5) sim.step();
    const ball = sim.activeBalls[0]!;
    const before = Math.hypot(ball.x - 540, ball.y - 900);
    sim.input("boost", ball.code);
    for (let i = 0; i < 6; i++) sim.step();
    expect(Math.hypot(ball.x - 540, ball.y - 900)).toBeGreaterThan(before);
    sim.destroy();
  });
});
