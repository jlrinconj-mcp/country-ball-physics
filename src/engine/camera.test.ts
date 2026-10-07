import { describe, expect, it } from "vitest";
import { lastPlaceElimination } from "@/modes/lastPlaceElimination";
import { Camera } from "./camera";
import { DEFAULT_CONFIG } from "./defaults";
import { TICK_RATE } from "./physicsWorld";
import { Simulation } from "./simulation";
import { makeTestCountries } from "./testing";
import type { WorldLayout } from "./types";

const countries = makeTestCountries(8);
const viewport = { width: 1080, height: 1920, content: { x: 60, y: 460, w: 850, h: 1020 } };
type Direction = "vertical" | "horizontal";

/** Controlled courses using the real Last Place rules, including safe places. */
function createRace(direction: Direction): Simulation {
  const bounds = { x: 0, y: 0, w: 1080, h: 7000 };
  const layout: WorldLayout = {
    bounds,
    focus: bounds,
    obstacles: [],
    spawn: { kind: "rect", x: 300, y: 100, w: 480, h: 200, speed: 0 },
    path: direction === "vertical" ? [{ x: 540, y: 200 }, { x: 540, y: 6800 }] : [{ x: 100, y: 3500 }, { x: 1000, y: 3500 }],
    zones: [{
      id: "finish",
      kind: "finish",
      shape: direction === "vertical"
        ? { kind: "rect", x: 0, y: 6600, w: 1080, h: 400 }
        : { kind: "rect", x: 950, y: 0, w: 130, h: 7000 },
    }],
  };
  const sim = new Simulation({
    ...DEFAULT_CONFIG,
    mode: "last-place-elimination",
    scenario: "plinko",
    seed: `camera-${direction}`,
    countries: countries.map((country) => country.cca3),
    maxParticipants: countries.length,
    elimination: "single",
    physics: { ...DEFAULT_CONFIG.physics, gravity: 0, chaos: 0 },
  }, countries, { ...lastPlaceElimination, createLayout: () => layout });
  while (sim.rules.cameraMoment?.() !== "live") sim.step();
  sim.balls.forEach((ball, i) => {
    // Horizontal order is by route progress, even when the back of the
    // field has a larger y coordinate than the first country.
    sim.teleport(ball, direction === "vertical" ? 540 : 900 - i * 100, direction === "vertical" ? 4800 - i * 500 : 3420 + i * 22);
  });
  return sim;
}

function cameraFor(sim: Simulation, direction: Direction, mode: "follow-leader" | "follow-action" = "follow-leader"): Camera {
  const camera = new Camera();
  camera.options = { mode, dynamicZoom: true };
  camera.setViewport(direction === "vertical" ? viewport : { ...viewport, content: { ...viewport.content, h: 300 } });
  camera.snap(sim);
  return camera;
}

function inContent(camera: Camera, y: number): boolean {
  const { content } = camera.getViewport();
  const screen = camera.worldToScreen(540, y);
  return screen.y >= content.y && screen.y <= content.y + content.h;
}

describe.each(["vertical", "horizontal"] as const)("Last Place cameras on a %s course", (direction) => {
  it("follows the first country instead of the last-place action subject", () => {
    const sim = createRace(direction);
    try {
      const leader = sim.rules.rank().find((ball) => ball.active)!;
      const last = sim.rules.cameraSubjects?.()[0];
      expect(leader).toBe(sim.balls[0]);
      expect(last).toBe(sim.balls.at(-1));
      expect(sim.leader).toBeNull();

      const camera = cameraFor(sim, direction);
      expect(inContent(camera, leader.y)).toBe(true);
      expect(inContent(camera, last!.y)).toBe(false);
      const pose = { ...camera.pose };
      // A stationary race must keep the leader's shot stable. This also
      // catches the frame-preservation logic pulling it back to last place.
      for (let i = 0; i < 2 * TICK_RATE; i++) camera.update(sim, 1, 1 / TICK_RATE);
      expect(camera.pose).toEqual(pose);

      const action = cameraFor(sim, direction, "follow-action");
      for (let i = 0; i < TICK_RATE; i++) action.update(sim, 1, 1 / TICK_RATE);
      expect(inContent(action, last!.y)).toBe(true);
    } finally {
      sim.destroy();
    }
  });

  it("switches to the first country still racing when the leader becomes safe", () => {
    const sim = createRace(direction);
    try {
      const first = sim.balls[0]!;
      sim.leader = first;
      const camera = cameraFor(sim, direction);
      sim.teleport(first, direction === "vertical" ? 540 : 980, direction === "vertical" ? 6700 : 5800);
      sim.step();
      expect(first.parked).toBe(true);
      expect(sim.rules.rank()[0]).toBe(first);
      const leader = sim.rules.rank().find((ball) => ball.active)!;
      expect(leader).toBe(sim.balls[1]);
      camera.snap(sim);
      expect(inContent(camera, leader.y)).toBe(true);
      expect(inContent(camera, first.y)).toBe(false);
      const pose = { ...camera.pose };
      for (let i = 0; i < TICK_RATE; i++) camera.update(sim, 1, 1 / TICK_RATE);
      expect(camera.pose).toEqual(pose);
    } finally {
      sim.destroy();
    }
  });

  it("holds the shot while the round result is on screen", () => {
    const sim = createRace(direction);
    try {
      const camera = cameraFor(sim, direction);
      const pose = { ...camera.pose };
      sim.balls.slice(0, -1).forEach((ball, i) => {
        sim.teleport(ball, direction === "vertical" ? 100 + i * 140 : 980, direction === "vertical" ? 6700 : 5500 + i * 150);
      });
      sim.step();
      expect(sim.status).toBe("running");
      expect(sim.rules.cameraMoment?.()).toBe("hold");
      expect(sim.rules.cameraSubjects?.()).toEqual([]);
      for (let i = 0; i < TICK_RATE; i++) camera.update(sim, 1, 1 / TICK_RATE);
      expect(camera.pose).toEqual(pose);
    } finally {
      sim.destroy();
    }
  });
});
