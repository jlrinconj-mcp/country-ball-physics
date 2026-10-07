import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@/engine/defaults";
import { makeTestCountries } from "@/engine/testing";
import { modeDefaults } from "@/modes";
import { DEFAULT_DISPLAY } from "@/render/displayOptions";
import { validateExportRequest } from "./configuration";
import { AMERICAS_20, applyPreset, getPreset } from "@/countries/selection";

const countries = makeTestCountries(24);
const request = {
  config: { ...DEFAULT_CONFIG, ...modeDefaults("race"), seed: "manual-config", countries: countries.slice(0, 3).map(c => c.cca3), maxParticipants: 3, scenario: "sprint" },
  display: { ...DEFAULT_DISPLAY, format: "16:9" as const, language: "es" as const, headline: "Elige tu país" },
};

describe("manual configuration", () => {
  it("preserves the chosen parameters and isolates the submitted draft", () => {
    const value = validateExportRequest(request, countries);
    expect(value).toEqual(request);
    value.config.physics.gravity = 0;
    expect(request.config.physics.gravity).not.toBe(0);
  });
  it.each([
    { seed: "" }, { countries: [] }, { countries: ["XXX", "YYY"] },
    { scenario: "unknown" }, { map: "unknown" }, { maxParticipants: 1 },
    { tournament: { size: 32 } }, { physics: { ...request.config.physics, gravity: NaN } },
  ])("rejects invalid drafts before a recording starts: %j", patch => {
    expect(() => validateExportRequest({ ...request, config: { ...request.config, ...patch } }, countries)).toThrow();
  });
  it("does not derive a new seed or silently substitute a circuit", () => {
    const value = validateExportRequest({ ...request, config: { ...request.config, track: { sequence: ["hammers", "zigzag"], difficulty: 0.6 } } }, countries);
    expect(value.config.seed).toBe("manual-config");
    expect(value.config.track?.sequence).toEqual(["hammers", "zigzag"]);
  });

  it("rejects inherited format keys and malformed recorded inputs", () => {
    expect(() => validateExportRequest({ ...request, display: { ...request.display, format: "constructor" } }, countries)).toThrow(/Formato/);
    expect(() => validateExportRequest({ ...request, config: { ...request.config, inputs: [{ kind: "boost", tick: -1, cca3: "AAX" }] } }, countries)).toThrow(/Intervenciones/);
    const inputs = [{ kind: "boost" as const, tick: 0, cca3: countries[0]!.cca3 }];
    expect(validateExportRequest({ ...request, config: { ...request.config, inputs } }, countries).config.inputs).toEqual(inputs);
  });

  it("records continuous Last Place with the selected first map and rejects incompatible formats", () => {
    const config = { ...request.config, ...modeDefaults("last-place-elimination"), continuous: true, scenario: "ring" };
    const validated = validateExportRequest({ ...request, config }, countries);
    expect(validated.config.continuous).toBe(true);
    expect(validated.config.scenario).toBe("ring");
    for (const patch of [{ mode: "race" }, { tournament: { size: 8 } }, { track: { sequence: ["plinko"] } }, { continuous: "true" }]) {
      expect(() => validateExportRequest({ ...request, config: { ...config, ...patch } }, countries)).toThrow();
    }
  });

  it("requires exactly 20 sovereign American countries and Last Place Elimination", () => {
    const americans = countries.slice(0, 20).map((c, i) => ({ ...c, cca3: AMERICAS_20[i]!, region: "Americas" as const }));
    const config = { ...request.config, ...modeDefaults("last-place-elimination"), countries: americans.map(c => c.cca3), tournament: { size: 20 as const } };
    expect(validateExportRequest({ ...request, config }, americans).config.countries).toHaveLength(20);
    expect(() => validateExportRequest({ ...request, config: { ...config, countries: config.countries.slice(1) } }, americans)).toThrow();
    expect(() => validateExportRequest({ ...request, config: { ...config, ...modeDefaults("race") } }, americans)).toThrow(/Last Place Elimination/);
    expect(() => validateExportRequest({ ...request, config }, americans.map((c, i) => i === 0 ? { ...c, region: "Europe" } : c))).toThrow(/América/);
    expect(() => validateExportRequest({ ...request, config }, americans.map((c, i) => i === 0 ? { ...c, sovereign: false } : c))).toThrow(/territorios/);
    const extra = { ...countries[20]!, region: "Americas" as const };
    expect(() => validateExportRequest({ ...request, config: { ...config, countries: [...config.countries, extra.cca3] } }, [...americans, extra])).toThrow(/exactamente 20/);
    expect(applyPreset(getPreset("americas-20")!, americans)).toEqual([...AMERICAS_20].sort());
    for (const region of [["CAN", "USA", "MEX"], ["GTM", "CRI", "PAN"], ["CUB", "DOM", "JAM"], ["COL", "BRA", "ARG"]]) {
      expect(region.every(code => (config.countries as string[]).includes(code))).toBe(true);
    }
  });
});
