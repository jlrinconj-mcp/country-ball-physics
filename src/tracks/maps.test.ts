import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@/engine/defaults";
import { makeTestCountries } from "@/engine/testing";
import { createSimulation, modeDefaults } from "@/modes";
import { CoursePath } from "./coursePath";
import { buildMap, getMap, listMaps, listTrackMaps } from "./maps";

describe("map registry", () => {
  it.each(listTrackMaps().map((m) => m.id))("%s builds the same track for a seed", (id) => {
    const map = getMap(id);
    const a = buildMap(map, "map-seed", { ballRadius: 20, count: 32 });
    const b = buildMap(map, "map-seed", { ballRadius: 20, count: 32 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const middle = a.modules.map((m) => m.kind).slice(1, -2);
    if (map.sequence) expect(middle).toEqual(map.sequence);
    else if (map.slots) middle.forEach((k, i) => expect(map.slots?.[i]).toContain(k));
    else expect(middle.every((k) => map.pool?.includes(k))).toBe(true);
  });

  it("keeps every map's measured pace inside the 8–15 s target (p10 ≥ 7.5)", () => {
    for (const map of listMaps()) {
      expect(map.pace[0]).toBeGreaterThanOrEqual(7.5);
      expect(map.pace[1]).toBeLessThanOrEqual(15);
    }
  });

  it("varies the obstacle-mix picks with the seed", () => {
    const map = getMap("obstacle-mix");
    const picks = new Set(["a", "b", "c", "d", "e", "f"].map((seed) => buildMap(map, seed, { ballRadius: 20, count: 8 }).modules[1]?.kind));
    expect(picks.size).toBeGreaterThan(1);
  });

  it("arenas are not tracks", () => {
    const arenas = listMaps().filter((m) => m.arena);
    expect(arenas.map((m) => m.id)).toEqual(["ring", "double-ring", "triple-ring"]);
    expect(() => buildMap(arenas[0]!, "x", { ballRadius: 20, count: 8 })).toThrow(/arena/);
  });

  it("rejects unknown maps", () => {
    expect(() => getMap("nope")).toThrow(/Unknown map/);
  });

  it("serves any track mode: a race on a named map", () => {
    const countries = makeTestCountries(8);
    for (const mode of ["race", "marble-race"] as const) {
      const sim = createSimulation(
        { ...DEFAULT_CONFIG, ...modeDefaults(mode), map: "spinner", seed: "map-race", countries: countries.map((c) => c.cca3), maxParticipants: 8 },
        countries,
      );
      expect(sim.layout.modules?.map((m) => m.kind)).toEqual(["start", "spinner", "wheel", "spinner", "final-drop", "finish"]);
      expect(sim.runToEnd()?.decidedBy).toBe("physics");
      sim.destroy();
    }
  });
});

describe("CoursePath", () => {
  it("measures progress along a zigzag route, not just height", () => {
    const path = new CoursePath([
      { x: 500, y: 0 },
      { x: 900, y: 100 },
      { x: 100, y: 300 },
      { x: 500, y: 600 },
    ]);
    expect(path.progress(500, 0)).toBe(0);
    // Two balls on the same ramp: the one further along it is ahead.
    expect(path.progress(700, 250)).toBeLessThan(path.progress(300, 250));
    expect(path.progress(500, 600)).toBeCloseTo(path.length, 6);
    expect(path.progress(500, -500)).toBe(0);
  });
});
