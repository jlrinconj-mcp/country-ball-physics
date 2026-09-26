import { describe, expect, it } from "vitest";
import { createSimulation, listModes, modeDefaults } from "@/modes";
import { previewSequence, RACE_SCENARIOS } from "@/modes/race";
import { DEFAULT_CONFIG } from "./defaults";
import type { SimulationEvents } from "./simulation";
import { makeTestCountries } from "./testing";
import type { SimulationConfig } from "./types";

const countries = makeTestCountries(60);
const codes = countries.map((c) => c.cca3);

function config(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return { ...DEFAULT_CONFIG, countries: codes.slice(0, 24), maxParticipants: 24, ...overrides };
}

function run(cfg: SimulationConfig) {
  const sim = createSimulation(cfg, countries);
  const result = sim.runToEnd();
  sim.destroy();
  if (!result) throw new Error("simulation did not finish");
  return result;
}

describe("Simulation (Last Country Standing)", () => {
  it("produces an identical result for the same seed", () => {
    const a = run(config({ seed: "determinism-1" }));
    const b = run(config({ seed: "determinism-1" }));
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(b.ranking).toEqual(a.ranking);
    expect(b.ticks).toBe(a.ticks);
  });

  it("does not depend on the order countries were selected in", () => {
    const a = run(config({ seed: "order", countries: codes.slice(0, 24) }));
    const b = run(config({ seed: "order", countries: [...codes.slice(0, 24)].reverse() }));
    expect(b.fingerprint).toBe(a.fingerprint);
  });

  it("changes with the seed", () => {
    const results = ["s-1", "s-2", "s-3"].map((seed) => run(config({ seed })));
    expect(new Set(results.map((r) => r.fingerprint)).size).toBe(3);
  });

  it("samples participants deterministically when over the limit", () => {
    const a = run(config({ seed: "sample", countries: codes, maxParticipants: 16 }));
    const b = run(config({ seed: "sample", countries: codes, maxParticipants: 16 }));
    expect(a.participants).toBe(16);
    expect(b.ranking.map((r) => r.cca3)).toEqual(a.ranking.map((r) => r.cca3));
  });

  it("eliminates inside the engine and declares the last survivor", () => {
    const sim = createSimulation(config({ seed: "events" }), countries);
    const eliminated: SimulationEvents["countryEliminated"][] = [];
    let winner: SimulationEvents["winnerDeclared"] | null = null;
    sim.events.on("countryEliminated", (e) => eliminated.push(e));
    sim.events.on("winnerDeclared", (e) => (winner = e));
    const result = sim.runToEnd();

    expect(result?.decidedBy).toBe("physics");
    expect(eliminated).toHaveLength(23);
    expect(eliminated.map((e) => e.remaining)).toEqual(Array.from({ length: 23 }, (_, i) => 23 - i));
    expect(winner).not.toBeNull();
    expect(sim.aliveCount).toBe(1);
    expect(result?.winner.cca3).toBe(sim.aliveBalls[0]?.code);
    expect(result?.ranking.map((r) => r.place)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    // Eliminated balls have left the physics world.
    expect(sim.balls.filter((b) => b.body).length).toBe(1);
    sim.destroy();
  });

  it("forces a decision at the time limit", () => {
    const result = run(config({ seed: "timeout", maxDuration: 3 }));
    expect(result.decidedBy).toBe("timeout");
    expect(result.seconds).toBeCloseTo(3, 1);
  });

  it.each(["ring", "double-ring", "triple-ring"])("finishes the %s scenario", (scenario) => {
    const result = run(config({ seed: `scenario-${scenario}`, scenario }));
    expect(result.scenario).toBe(scenario);
    expect(result.ranking).toHaveLength(24);
  });

  it("handles 200 balls", () => {
    const many = makeTestCountries(200);
    const sim = createSimulation(
      config({ seed: "stress", countries: many.map((c) => c.cca3), maxParticipants: 200 }),
      many,
    );
    const t0 = performance.now();
    for (let i = 0; i < 120; i++) sim.step();
    const msPerTick = (performance.now() - t0) / 120;
    expect(sim.balls).toHaveLength(200);
    // Generous bound for CI machines; typically ~1–3 ms.
    expect(msPerTick).toBeLessThan(16);
    sim.destroy();
  });
});

describe("Simulation (Race)", () => {
  const raceConfig = (seed: string): SimulationConfig => ({
    ...config({ seed }),
    ...modeDefaults("race"),
    seed,
    countries: codes.slice(0, 16),
    maxParticipants: 16,
    scenario: "sprint",
  });

  it("is deterministic and finishes with a podium", () => {
    const a = run(raceConfig("race-1"));
    const b = run(raceConfig("race-1"));
    expect(b.fingerprint).toBe(a.fingerprint);
    const finished = a.ranking.filter((r) => r.status === "finished");
    expect(finished.length).toBeGreaterThanOrEqual(1);
    expect(a.ranking[0]?.cca3).toBe(a.winner.cca3);
    expect(a.ranking[0]?.status).toBe("finished");
    expect(a.ranking.map((r) => r.place)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });

  it("tracks the leader and emits leader events", () => {
    const sim = createSimulation(raceConfig("race-leader"), countries);
    let changes = 0;
    sim.events.on("leaderChanged", () => changes++);
    sim.runToEnd();
    expect(changes).toBeGreaterThan(0);
    expect(sim.result?.timeline.some((e) => e.type === "leader")).toBe(true);
    sim.destroy();
  });

  it("keeps balls behind the gate until it opens", () => {
    const sim = createSimulation(raceConfig("race-gate"), countries);
    const gate = (sim.layout.gateOpensAt ?? 0) * 60;
    const startY = Math.max(...sim.balls.map((b) => b.y));
    for (let i = 0; i < gate - 5; i++) sim.step();
    const deepest = Math.max(...sim.balls.map((b) => b.y));
    expect(deepest).toBeLessThan(sim.layout.startY! + 40);
    expect(deepest).toBeGreaterThanOrEqual(startY - 200);
    sim.destroy();
  });
});

describe("every mode and scenario", () => {
  const cases = listModes().flatMap((mode) => mode.scenarios.map((s) => [mode.id, s.id] as const));

  it.each(cases)("%s / %s is deterministic and produces a full ranking", (mode, scenario) => {
    const cfg: SimulationConfig = {
      ...DEFAULT_CONFIG,
      ...modeDefaults(mode),
      scenario,
      seed: `all-${mode}-${scenario}`,
      countries: codes.slice(0, 12),
      maxParticipants: 12,
    };
    const a = run(cfg);
    const b = run(cfg);
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(a.ranking.map((r) => r.place)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(a.ranking[0]?.cca3).toBe(a.winner.cca3);
  });
});

describe("custom tracks", () => {
  const base = (): SimulationConfig => ({
    ...DEFAULT_CONFIG,
    ...modeDefaults("race"),
    seed: "custom-track",
    countries: codes.slice(0, 8),
    maxParticipants: 8,
  });

  it("builds the requested module sequence", () => {
    const sim = createSimulation({ ...base(), track: { sequence: ["wheel", "zigzag", "not-a-module"] } }, countries);
    expect(sim.layout.modules?.map((m) => m.kind)).toEqual(["start", "wheel", "zigzag", "final-drop", "finish"]);
    expect(sim.runToEnd()?.winner).toBeDefined();
    sim.destroy();
  });

  it("previews the same sequence the simulation generates", () => {
    const sim = createSimulation(base(), countries);
    const built = sim.layout.modules?.map((m) => m.kind).slice(1, -2);
    expect(previewSequence(RACE_SCENARIOS, sim.scenario, "custom-track")).toEqual(built);
    sim.destroy();
  });
});

describe("golden fingerprints (cross-engine determinism)", () => {
  // Verified identical in Node 26 (V8 14.6) and Chrome 152. If a deliberate
  // engine or mode change alters these, update them in the same commit and
  // say so: old seeds will replay differently from then on.
  const GOLDEN: Record<string, string> = {
    "last-country-standing": "44bfad49:AJX:2731",
    race: "9c342593:AUX:1581",
    "elimination-drop": "7e7efca3:APX:3026",
    "marble-race": "27137b5a:ASX:1351",
  };
  const golden = makeTestCountries(24);

  it.each(Object.entries(GOLDEN))("%s reproduces its golden result", (mode, expected) => {
    const sim = createSimulation(
      { ...DEFAULT_CONFIG, ...modeDefaults(mode as SimulationConfig["mode"]), seed: "golden-2026", countries: golden.map((c) => c.cca3), maxParticipants: 24 },
      golden,
    );
    const r = sim.runToEnd();
    sim.destroy();
    expect(`${r?.fingerprint}:${r?.winner.cca3}:${r?.ticks}`).toBe(expected);
  });
});
