import Matter from "matter-js";
import { describe, expect, it } from "vitest";
import { createSimulation, modeDefaults } from "@/modes";
import { mapLayout } from "@/modes/course";
import { getMap } from "@/tracks/maps";
import { DEFAULT_CONFIG } from "./defaults";
import { CATEGORY } from "./physicsWorld";
import { makeTestCountries } from "./testing";

describe("Simulation.replaceLayout", () => {
  it("replaces course geometry and zones while preserving competition state and references", () => {
    const countries = makeTestCountries(6);
    const sim = createSimulation({
      ...DEFAULT_CONFIG,
      ...modeDefaults("last-place-elimination"),
      scenario: "plinko",
      countries: countries.map((country) => country.cca3),
      maxParticipants: 6,
    }, countries);
    sim.step();
    const layout = sim.layout;
    const zones = sim.zones;
    const oldBodies = sim.obstacles.map((obstacle) => obstacle.body);
    const active = sim.activeBalls[0]!;
    const parked = sim.activeBalls[1]!;
    const out = sim.activeBalls[2]!;
    sim.phase(active, 3);
    sim.park(parked);
    sim.eliminate(out);
    sim.input("boost", active.code);
    const inputs = [...sim.inputs];
    const tick = sim.tick;
    const timeline = [...sim.timeline];
    const alive = sim.aliveBalls;
    const next = mapLayout(getMap("double-ring"), {
      scenario: "double-ring",
      random: sim.random.fork("layout"),
      count: sim.aliveCount,
      ballRadius: sim.ballRadius,
    });

    sim.replaceLayout(next);

    expect(sim.layout).toBe(layout);
    expect(sim.zones).toBe(zones);
    expect(sim.zones.map((zone) => zone.id)).toEqual(["outside"]);
    expect(sim.layout.path).toBeUndefined();
    expect(sim.layout.modules).toBeUndefined();
    expect(sim.layout.finishY).toBeUndefined();
    expect(sim.obstacles.map((obstacle) => obstacle.id)).toEqual(["ring-inner", "ring-outer"]);
    expect(Matter.Composite.allBodies(sim.physics.engine.world).some((body) => oldBodies.includes(body))).toBe(false);
    expect(sim.aliveBalls).toEqual(alive);
    expect(out.status).toBe("eliminated");
    expect(out.body).toBeNull();
    expect(out.ghost).toBeNull();
    expect(parked.parked).toBe(true);
    expect(sim.isPhasing(active)).toBe(false);
    expect(active.body?.collisionFilter.mask).toBe(CATEGORY.ball | CATEGORY.solid);
    expect(sim.inputs).toEqual(inputs);
    expect(sim.timeline).toEqual(timeline);
    expect(sim.tick).toBe(tick);
    sim.destroy();
  });
});
