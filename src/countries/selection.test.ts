import { describe, expect, it } from "vitest";
import { createRandom } from "@/engine/random";
import sample from "./__fixtures__/openData.sample.json";
import { normalizeOpenData } from "./providers/openData";
import { applyPreset, eligibleCountries, getPreset } from "./selection";

const countries = normalizeOpenData(sample);

describe("country selection", () => {
  it("selects by continent", () => {
    expect(applyPreset(getPreset("south-america")!, countries)).toEqual(["ARG", "BRA", "COL"]);
  });

  it("excludes territories and excluded countries from the pool", () => {
    const pool = eligibleCountries(countries, { includeTerritories: false, excluded: new Set(["FRA"]) });
    const codes = applyPreset(getPreset("all")!, pool);
    expect(codes).not.toContain("GRL");
    expect(codes).not.toContain("FRA");
    expect(codes).toContain("COL");
  });

  it("makes seeded random picks", () => {
    const preset = { id: "random-16" as const, label: "Random 3", random: 3 };
    const a = applyPreset(preset, countries, createRandom("pick"));
    const b = applyPreset(preset, [...countries].reverse(), createRandom("pick"));
    expect(a).toHaveLength(3);
    expect(b).toEqual(a);
  });
});
