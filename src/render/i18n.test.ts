import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@/engine/defaults";
import { makeTestCountries } from "@/engine/testing";
import type { SimulationConfig } from "@/engine/types";
import { createSimulation, listModes, modeDefaults } from "@/modes";
import { Tournament } from "@/modes/tournament";
import { countryName, feedLine, isTranslated, translate, winsLine } from "./i18n";

const countries = makeTestCountries(16);

/** Every HUD phrase a game shows, sampled through the whole run. */
function phrases(config: SimulationConfig): Set<string> {
  const sim = createSimulation(config, countries);
  const seen = new Set<string>();
  const add = (text: string | undefined) => text && seen.add(text);
  while (sim.status !== "finished") {
    sim.step();
    if (sim.tick % 6 !== 0) continue;
    const hud = sim.rules.hud();
    [hud.headline, hud.counterLabel, hud.status, hud.banner, hud.title?.text, hud.title?.sub, hud.featured?.label].forEach(add);
  }
  sim.destroy();
  return seen;
}

describe("video text in Spanish", () => {
  const cases = listModes().flatMap((mode) => [undefined, "plinko", "ring"].map((map) => [mode.id, map] as const));

  it.each(cases)("%s (map %s): every HUD phrase is translated", (mode, map) => {
    const config: SimulationConfig = { ...DEFAULT_CONFIG, ...modeDefaults(mode), seed: `es-${mode}`, countries: countries.map((c) => c.cca3), maxParticipants: 16 };
    if (map) {
      if (mode === "last-place-elimination") config.scenario = map;
      else config.map = map;
    }
    const missing = [...phrases(config)].filter((p) => !isTranslated(p, "es"));
    expect(missing).toEqual([]);
  }, 60_000);

  it("translates tournament labels and fixed lines", () => {
    for (const size of [8, 16, 32, 64] as const) {
      const t = new Tournament({ ...DEFAULT_CONFIG, ...modeDefaults("race"), seed: "es", countries: makeTestCountries(64).map((c) => c.cca3), maxParticipants: 64 }, { size });
      expect(isTranslated(t.label(), "es"), t.label()).toBe(true);
    }
    for (const p of ["WINNER", "CHAMPION", "HEAT WINNER", "FINAL", "LEADER", "LAST PLACE", "DECIDED AT THE TIME LIMIT", "OUT 12"]) expect(isTranslated(p, "es"), p).toBe(true);
    expect(translate("ROUND 4 · 3/21 SAFE", "es")).toBe("RONDA 4 · 3/21 A SALVO");
    expect(translate("LAST 11 ARE ELIMINATED", "es")).toBe("LOS ÚLTIMOS 11 QUEDAN ELIMINADOS");
    expect(translate("QUARTER-FINALS · HEAT 2/4", "es")).toBe("CUARTOS DE FINAL · SERIE 2/4");
    expect(translate("ROUND 4", "en")).toBe("ROUND 4");
  });

  it("translates continuous-race map names and round cards", () => {
    const config: SimulationConfig = { ...DEFAULT_CONFIG, ...modeDefaults("last-place-elimination"), continuous: true, seed: "es-continuous", countries: countries.map(c => c.cca3), maxParticipants: 16 };
    expect([...phrases(config)].filter(p => !isTranslated(p, "es"))).toEqual([]);
    expect(translate("FINAL 4 · Spinning Ring", "es")).toBe("FINAL 4 · Anillo");
    expect(translate("DOUBLE RING · LAST PLACE IS ELIMINATED", "es")).toBe("ANILLO DOBLE · EL ÚLTIMO QUEDA ELIMINADO");
  }, 60_000);

  it("names countries and results in the video's language", () => {
    expect(countryName({ name: "Germany", cca2: "DE" }, "es")).toBe("Alemania");
    expect(countryName({ name: "Germany", cca2: "DE" }, "en")).toBe("Germany");
    expect(countryName({ name: "Nowhere", cca2: "QQ" }, "es")).toBe("Nowhere");
    expect(winsLine("ALEMANIA", "es")).toBe("¡GANA ALEMANIA!");
    expect(feedLine("ALEMANIA", { kind: "eliminated", place: 3 }, "es")).toBe("ALEMANIA ELIMINADO");
  });
});
