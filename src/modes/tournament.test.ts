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
    [8, 2, 4],
    [16, 2, 8],
    [32, 4, 8],
    [64, 8, 8],
  ] as const)("a %i-country draw has %i heats and a final of %i", (size, heats, finalists) => {
    const t = new Tournament(base, { size });
    expect(t.rounds[0]?.heats).toHaveLength(heats);
    const entrants = t.rounds[0]!.heats.flatMap((h) => h.countries);
    expect(new Set(entrants).size).toBe(size);
    expect(t.rounds[0]!.advance * heats).toBe(finalists);
  });

  it("runs to a champion deterministically", () => {
    const a = runTournament(base, { size: 8 }, countries);
    const b = runTournament(base, { size: 8 }, countries);
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(b.champion).toBe(a.champion);
    expect(a.outcomes).toHaveLength(3);
    const final = a.outcomes[2]!;
    expect(final.heat.countries).toHaveLength(4);
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
});
