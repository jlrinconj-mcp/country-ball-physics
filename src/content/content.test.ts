import { describe, expect, it } from "vitest";
import sample from "@/countries/__fixtures__/openData.sample.json";
import { normalizeOpenData } from "@/countries/providers/openData";
import { makeTestCountries } from "@/engine/testing";
import { runPlan } from "./generateSimulation";
import { buildMetadata } from "./metadata";
import { planSimulation } from "./plan";

const real = normalizeOpenData(sample);
const synthetic = makeTestCountries(40).map((c, i) => ({ ...c, continents: [i % 2 ? "Europe" : "Asia"] as ("Europe" | "Asia")[] }));

describe("planSimulation", () => {
  it("resolves the same request and seed to the same config", () => {
    const request = { mode: "random" as const, countries: "random-16", track: "random", seed: "batch-001" };
    expect(planSimulation(request, synthetic)).toEqual(planSimulation(request, synthetic));
  });

  it("accepts presets, continents and ISO code lists", () => {
    expect(planSimulation({ mode: "race", countries: "South America", seed: "s" }, real).config.countries).toEqual(["ARG", "BRA", "COL"]);
    const vs = planSimulation({ mode: "race", countries: ["co", "ARG", "BR"], seed: "s" }, real);
    expect(vs.config.countries).toEqual(["ARG", "BRA", "COL"]);
    expect(vs.label).toBe("Colombia vs Argentina vs Brazil");
    expect(() => planSimulation({ mode: "race", countries: "atlantis", seed: "s" }, real)).toThrow();
  });

  it("runs a named map in any track mode", () => {
    const lpe = planSimulation({ mode: "last-place-elimination", countries: "all", seed: "m", map: "zigzag" }, synthetic);
    expect(lpe.config.scenario).toBe("zigzag");
    expect(lpe.config.maxParticipants).toBe(40);
    expect(planSimulation({ mode: "marble-race", countries: "all", seed: "m", map: "plinko" }, synthetic).config.map).toBe("plinko");
    expect(() => planSimulation({ mode: "race", countries: "all", seed: "m", map: "atlantis" }, synthetic)).toThrow(/Unknown map/);
    expect(planSimulation({ mode: "last-country-standing", countries: "all", seed: "m", map: "plinko" }, synthetic).config.map).toBe("plinko");
    expect(planSimulation({ mode: "elimination-drop", countries: "all", seed: "m", map: "ring" }, synthetic).config.map).toBe("ring");
  });

  it("applies mode defaults, format and tournaments", () => {
    const plan = planSimulation({ mode: "tournament", countries: "all", seed: "cup", format: "1:1", heatMode: "race" }, synthetic);
    expect(plan.config.tournament?.size).toBe(32);
    expect(plan.config.mode).toBe("race");
    expect(plan.display.format).toBe("1:1");
    expect(plan.config.physics).toMatchObject({ gravity: 1.6, maxSpeed: 18 });
  });
});

describe("runPlan + metadata", () => {
  it("is reproducible end to end", () => {
    const plan = planSimulation({ mode: "last-country-standing", countries: "random-16", seed: "vid-7" }, synthetic);
    const a = runPlan(plan, synthetic);
    const b = runPlan(plan, synthetic);
    expect(b.result.fingerprint).toBe(a.result.fingerprint);
    expect(b.metadata).toEqual(a.metadata);
    expect(a.metadata.title.length).toBeGreaterThan(5);
    expect(a.metadata.title).not.toContain(a.result.winner.name);
    expect(a.metadata.result).toContain(a.result.winner.name);
    expect(a.metadata.hashtags).toContain("countryballs");
  });

  it("writes Spanish metadata", () => {
    const plan = planSimulation({ mode: "race", countries: "europe", seed: "es-1" }, synthetic);
    const meta = buildMetadata(plan, { winnerName: "Colombia", winnerEmoji: "🇨🇴", seconds: 41.2 }, "es");
    expect(meta.result).toBe("🇨🇴 Colombia gana en 41s");
    expect(meta.thumbnailText).toBe("¿QUÉ PAÍS GANARÁ?");
  });
});
