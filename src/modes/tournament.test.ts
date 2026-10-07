import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@/engine/defaults";
import { makeTestCountries } from "@/engine/testing";
import type { SimulationConfig } from "@/engine/types";
import { modeDefaults } from "./index";
import { runTournament, Tournament } from "./tournament";

const countries = makeTestCountries(70);
const base: SimulationConfig = {
  ...DEFAULT_CONFIG,
  ...modeDefaults("last-country-standing"),
  seed: "cup-2026",
  countries: countries.map((c) => c.cca3),
};

describe("Tournament", () => {
  it.each([
    [8, 2, 2],
    [16, 2, 2],
    [32, 4, 4],
    [64, 8, 8],
  ] as const)("a %i-country draw has %i heats and a final of %i", (size, heats, finalists) => {
    const t = new Tournament(base, { size });
    expect(t.rounds[0]?.heats).toHaveLength(heats);
    const entrants = t.rounds[0]!.heats.flatMap((h) => h.countries);
    expect(new Set(entrants).size).toBe(size);
    expect(t.rounds[0]!.name).toBe("Groups");
    expect(t.rounds[0]!.heats.map(h => h.countries.length)).toEqual(Array(heats).fill(size / heats));
    expect(t.rounds[0]!.advance).toBe(1);
    expect(t.rounds[0]!.advance * heats).toBe(finalists);
  });

  it.each([8, 16, 32, 64] as const)("a %i-country final contains exactly each group's winner and replays deterministically", (size) => {
    const run = runTournament(base, { size }, countries);
    const replay = runTournament({ ...base, countries: [...base.countries].reverse() }, { size }, countries);
    expect(replay).toEqual(run);
    const groups = run.outcomes.filter(o => o.heat.round === 0);
    const final = run.outcomes.at(-1)!;
    expect(groups.every(o => o.advanced.length === 1)).toBe(true);
    expect(groups.map(o => o.advanced[0])).toEqual(groups.map(o => o.result.winner.cca3));
    expect(final.heat.countries).toEqual(groups.map(o => o.result.winner.cca3));
    expect(final.heat.round).toBe(1);
    expect(final.advanced).toEqual([]);
    expect(final.result.winner.cca3).toBe(run.champion);
  }, 30_000);

  it("runs each group as a single simulation", () => {
    const tournament = new Tournament({ ...base, tournament: { size: 8 }, continuous: true }, { size: 8 });
    expect(tournament.current()?.config.tournament).toBeUndefined();
    expect(tournament.current()?.config.continuous).toBeUndefined();
  });

  it("runs to a champion deterministically", () => {
    const a = runTournament(base, { size: 8 }, countries);
    const b = runTournament(base, { size: 8 }, countries);
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(b.champion).toBe(a.champion);
    expect(a.outcomes).toHaveLength(3);
    const final = a.outcomes[2]!;
    expect(final.heat.countries).toHaveLength(2);
    expect(final.heat.countries).toEqual(a.outcomes.slice(0, 2).flatMap((o) => o.advanced));
    expect(final.result.winner.cca3).toBe(a.champion);
  });

  it("uses a different draw for a different seed", () => {
    const a = new Tournament(base, { size: 16 }).rounds[0]!.heats[0]!.countries;
    const b = new Tournament({ ...base, seed: "cup-2027" }, { size: 16 }).rounds[0]!.heats[0]!.countries;
    expect(b).not.toEqual(a);
  });

  it("rejects too few countries", () => {
    expect(() => new Tournament({ ...base, countries: base.countries.slice(0, 10) }, { size: 16 })).toThrow();
  });

  it("plays exactly 20 entrants in four groups of five, then the four winners in order", () => {
    const config = { ...base, ...modeDefaults("last-place-elimination"), countries: base.countries.slice(0, 20), seed: "america-20" };
    const draw = new Tournament(config, { size: 20 });
    expect(draw.rounds[0]?.heats.map(h => h.countries.length)).toEqual([5, 5, 5, 5]);
    expect(new Set(draw.rounds[0]?.heats.flatMap(h => h.countries))).toEqual(new Set(config.countries));
    const a = runTournament(config, { size: 20 }, countries);
    const b = runTournament({ ...config, countries: [...config.countries].reverse() }, { size: 20 }, countries);
    expect(b).toEqual(a);
    expect(a.outcomes).toHaveLength(5);
    expect(a.outcomes.slice(0, 4).map(o => o.heat.seed)).toEqual([1, 2, 3, 4].map(i => `america-20/r1-h${i}`));
    const winners = a.outcomes.slice(0, 4).map(o => o.result.winner.cca3);
    expect(a.outcomes.at(-1)?.heat.countries).toEqual(winners);
    expect(a.outcomes.at(-1)?.heat.seed).toBe("america-20/r2-h1");
    expect(a.champion).toBe(a.outcomes.at(-1)?.result.winner.cca3);
  });

  it("rejects a 20-country tournament in another mode or with extra entrants", () => {
    expect(() => new Tournament({ ...base, countries: base.countries.slice(0, 20) }, { size: 20 })).toThrow(/Last Place Elimination/);
    expect(() => new Tournament({ ...base, ...modeDefaults("last-place-elimination"), countries: base.countries.slice(0, 21) }, { size: 20 })).toThrow(/exactamente 20/);
  });
});
