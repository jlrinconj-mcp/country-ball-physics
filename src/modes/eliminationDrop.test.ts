import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@/engine/defaults";
import { TICK_RATE } from "@/engine/physicsWorld";
import { makeTestCountries } from "@/engine/testing";
import { findCorridors } from "@/tracks/corridors";
import { createSimulation, getMode, modeDefaults } from "./index";

const countries = makeTestCountries(48);
const scenarios = getMode("elimination-drop").scenarios.map((s) => s.id);

describe("Elimination Drop Plinko", () => {
  it.each(scenarios)("%s: the peg board leaves no straight lane", (scenario) => {
    for (const count of [8, 32, 48, 120]) {
      const sim = createSimulation(
        { ...DEFAULT_CONFIG, ...modeDefaults("elimination-drop"), scenario, seed: `board-${count}`, countries: countries.map((c) => c.cca3), maxParticipants: count },
        makeTestCountries(count),
      );
      const board = sim.layout.obstacles.filter((o) => /^(peg|spinner)-/.test(o.id));
      const ys = board.flatMap((o) => o.shapes.map((s) => ("y" in s ? s.y : 0)));
      const lanes = findCorridors(board, { ballRadius: sim.ballRadius, left: 40, right: 1040, top: Math.min(...ys) - 60, bottom: Math.max(...ys) + 60, step: 2 });
      expect(lanes).toEqual([]);
      sim.destroy();
    }
  });

  it.each(scenarios)("%s: every round takes 8–15 s", (scenario) => {
    for (const count of [16, 48]) {
      const sim = createSimulation(
        { ...DEFAULT_CONFIG, ...modeDefaults("elimination-drop"), scenario, seed: `pace-${count}`, countries: countries.map((c) => c.cca3), maxParticipants: count },
        countries,
      );
      const starts: number[] = [];
      sim.events.on("roundStarted", ({ tick }) => starts.push(tick));
      const result = sim.runToEnd();
      sim.destroy();
      expect(result?.decidedBy).toBe("physics");
      // The last round ends at the deciding drop; every other one is complete.
      const rounds = starts.slice(1).map((t, i) => (t - (starts[i] as number)) / TICK_RATE);
      for (const seconds of rounds) {
        expect(seconds).toBeGreaterThanOrEqual(8);
        expect(seconds).toBeLessThanOrEqual(15);
      }
    }
  }, 30_000);
});
