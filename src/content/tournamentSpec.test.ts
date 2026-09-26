import { describe, expect, it } from "vitest";
import { makeTestCountries } from "@/engine/testing";
import { bracketMarkdown, parseTournamentSpec, runTournamentSpec } from "./tournamentSpec";

const countries = makeTestCountries(40).map((c, i) => ({
  ...c,
  continents: [i % 2 ? "Europe" : "South America"] as ("Europe" | "South America")[],
}));

describe("parseTournamentSpec", () => {
  it("accepts a full spec", () => {
    const spec = parseTournamentSpec({
      name: "Copa de Física",
      seed: "copa-1",
      countries: "south-america",
      size: 8,
      heatMode: "marble-race",
      heatScenario: "switchbacks",
      physics: { gravity: 1.8 },
      language: "es",
    });
    expect(spec).toMatchObject({ name: "Copa de Física", size: 8, heatMode: "marble-race", physics: { gravity: 1.8 } });
  });

  it("explains everything that is wrong", () => {
    let message = "";
    try {
      parseTournamentSpec({ size: 12, heatMode: "golf", physics: { gravity: -1, spin: 3 }, format: "3:2" });
    } catch (error) {
      message = (error as Error).message;
    }
    for (const part of ['"countries" is required', '"size" must be one of', '"heatMode" must be one of', '"format" must be one of', 'unknown physics setting "spin"', "physics.gravity must be"]) {
      expect(message).toContain(part);
    }
    expect(() => parseTournamentSpec([])).toThrow("JSON object");
  });
});

describe("runTournamentSpec", () => {
  const spec = parseTournamentSpec({
    name: "Custom Cup",
    countries: "all",
    size: 8,
    heatMode: "race",
    heatScenario: "sprint",
    track: { sequence: ["zigzag", "wheel", "funnel"] },
  });

  it("is reproducible and smooth (every heat decided by physics)", () => {
    const a = runTournamentSpec(spec, countries, "cup-seed");
    const b = runTournamentSpec(spec, countries, "cup-seed");
    expect(b.tournament?.fingerprint).toBe(a.tournament?.fingerprint);
    expect(b.tournament?.champion).toBe(a.tournament?.champion);
    expect(a.timeouts).toEqual([]);
    expect(a.tournament?.outcomes).toHaveLength(3);
    expect(a.metadata.title).toBe("Custom Cup");
  });

  it("applies the custom track to every heat", () => {
    const run = runTournamentSpec(spec, countries, "cup-track");
    expect(run.plan.config.track?.sequence).toEqual(["zigzag", "wheel", "funnel"]);
    expect(run.plan.config.scenario).toBe("sprint");
  });

  it("produces a readable bracket", () => {
    const run = runTournamentSpec(spec, countries, "cup-md");
    const md = bracketMarkdown(run, countries);
    expect(md).toContain("# Custom Cup");
    expect(md).toContain("## Final");
    expect(md).toContain(`Champion: ${countries.find((c) => c.cca3 === run.tournament?.champion)?.flag.emoji}`);
  });

  it("rejects selections that are too small or tracks for the wrong mode", () => {
    expect(() => runTournamentSpec({ ...spec, countries: ["AAX", "ABX"] }, countries)).toThrow(/needs 8 countries/);
    expect(() => runTournamentSpec({ ...spec, heatMode: "last-country-standing", heatScenario: undefined }, countries)).toThrow(/race modes/);
    expect(() => runTournamentSpec({ ...spec, track: { sequence: ["loop-de-loop"] } }, countries)).toThrow(/Unknown track modules/);
  });
});
