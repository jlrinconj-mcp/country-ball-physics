import { describe, expect, it } from "vitest";
import { createSimulation, getMode, modeDefaults } from "@/modes";
import { Camera } from "./camera";
import { DEFAULT_CONFIG } from "./defaults";
import { TICK_RATE } from "./physicsWorld";
import type { CameraMode, Simulation } from "./simulation";
import { makeTestCountries } from "./testing";
import type { ModeId, SimulationConfig } from "./types";

/**
 * "Smooth" in numbers. These guard the things that make a video look broken:
 * balls parked mid-track, crawling, tunnelling through walls, teleporting,
 * gravity that doesn't matter, and a camera that whips or loses the leader.
 */

const countries = makeTestCountries(12);
const SEEDS = ["smooth-a", "smooth-b", "smooth-c"];

function config(mode: ModeId, scenario: string, seed: string, physics: Partial<SimulationConfig["physics"]> = {}): SimulationConfig {
  const d = modeDefaults(mode);
  return {
    ...DEFAULT_CONFIG,
    ...d,
    scenario,
    seed,
    countries: countries.map((c) => c.cca3),
    maxParticipants: 12,
    physics: { ...d.physics, ...physics },
  };
}

interface Motion {
  sim: Simulation;
  longestStillSeconds: number;
  crawlRatio: number;
  escaped: number;
  maxStep: number;
}

/** Run a race and measure how the balls move after the gate opens. */
function measure(cfg: SimulationConfig): Motion {
  const sim = createSimulation(cfg, countries);
  const start = Math.round(((sim.layout.gateOpensAt ?? 0) + 0.5) * TICK_RATE);
  const { bounds } = sim.layout;
  const still = new Map<number, number>();
  let longest = 0;
  let crawl = 0;
  let samples = 0;
  let escaped = 0;
  let maxStep = 0;
  while (sim.status !== "finished" && sim.tick < sim.maxTicks + TICK_RATE) {
    sim.step();
    if (sim.tick < start) continue;
    for (const b of sim.balls) {
      if (!b.alive) continue;
      const speed = Math.hypot(b.vx, b.vy);
      samples++;
      if (speed < 2) crawl++;
      const n = speed < 0.4 ? (still.get(b.id) ?? 0) + 1 : 0;
      still.set(b.id, n);
      longest = Math.max(longest, n);
      maxStep = Math.max(maxStep, Math.hypot(b.x - b.prevX, b.y - b.prevY));
      if (b.x < bounds.x || b.x > bounds.x + bounds.w || b.y < bounds.y - 100) escaped++;
    }
  }
  return { sim, longestStillSeconds: longest / TICK_RATE, crawlRatio: crawl / Math.max(1, samples), escaped, maxStep };
}

const RACE_CASES = (["race", "marble-race"] as const).flatMap((mode) =>
  getMode(mode).scenarios.flatMap((s) => SEEDS.map((seed) => [mode, s.id, seed] as const)),
);

describe("race physics smoothness", () => {
  it.each(RACE_CASES)("%s / %s / %s: balls keep moving and stay on the track", (mode, scenario, seed) => {
    const m = measure(config(mode, scenario, seed));
    try {
      expect(m.sim.decidedBy).toBe("physics");
      // Anti-stall kicks in at 3 s; nothing should sit still much longer.
      expect(m.longestStillSeconds).toBeLessThan(4);
      // Balls spend little time crawling (< 2 px per tick ≈ 120 px/s).
      expect(m.crawlRatio).toBeLessThan(0.12);
      // No tunnelling through walls, no teleports: a tick never moves a ball
      // much more than its speed cap. Contact separation against moving
      // parts adds a little (≤ ~1.45× observed); the old double sub-step bug
      // produced 3–4×.
      expect(m.escaped).toBe(0);
      expect(m.maxStep).toBeLessThanOrEqual(m.sim.config.physics.maxSpeed * 1.5);
    } finally {
      m.sim.destroy();
    }
  });

  it("gravity makes races faster or slower", () => {
    const seconds = (gravity: number) =>
      SEEDS.reduce((sum, seed) => {
        const sim = createSimulation(config("race", "classic", seed, { gravity }), countries);
        const r = sim.runToEnd();
        sim.destroy();
        return sum + (r?.seconds ?? 0);
      }, 0);
    const low = seconds(0.6);
    const normal = seconds(1);
    const high = seconds(2);
    expect(high).toBeLessThan(normal);
    expect(normal).toBeLessThan(low);
  });
});

describe("camera smoothness", () => {
  const viewport = { width: 1080, height: 1920, content: { x: 60, y: 460, w: 850, h: 1020 } };

  it.each(["follow-action", "follow-leader", "follow-group"] as CameraMode[])(
    "%s never whips and keeps the leader in shot",
    (mode) => {
      const sim = createSimulation(config("race", "classic", "camera"), countries);
      const camera = new Camera();
      camera.options = { mode, dynamicZoom: true };
      camera.setViewport(viewport);
      camera.snap(sim);
      let maxJump = 0;
      let frames = 0;
      let leaderVisible = 0;
      while (sim.status !== "finished" && sim.tick < sim.maxTicks) {
        sim.step();
        const before = camera.worldToScreen(0, 0);
        camera.update(sim, 1, 1 / TICK_RATE);
        const after = camera.worldToScreen(0, 0);
        expect(Number.isFinite(camera.pose.x + camera.pose.y + camera.pose.zoom)).toBe(true);
        maxJump = Math.max(maxJump, Math.hypot(after.x - before.x, after.y - before.y));
        if (sim.leader?.alive) {
          frames++;
          const p = camera.worldToScreen(sim.leader.x, sim.leader.y);
          if (p.x >= 0 && p.x <= viewport.width && p.y >= 0 && p.y <= viewport.height) leaderVisible++;
        }
      }
      sim.destroy();
      // Screen content moves at most ~8% of the frame height per 1/60 s.
      expect(maxJump).toBeLessThan(viewport.height * 0.08);
      if (mode !== "follow-group") expect(leaderVisible / Math.max(1, frames)).toBeGreaterThan(0.95);
    },
  );
});

describe("Last Place Elimination smoothness", () => {
  const viewport = { width: 1080, height: 1920, content: { x: 60, y: 460, w: 850, h: 1020 } };
  const maps = getMode("last-place-elimination").scenarios.map((s) => s.id);

  it.each(maps)("%s: balls stay on the track and never teleport mid-round", (map) => {
    const sim = createSimulation(config("last-place-elimination", map, "lpe-smooth"), countries);
    const { bounds } = sim.layout;
    let rounds = 0;
    let cut = -1;
    sim.events.on("roundStarted", ({ tick }) => {
      rounds++;
      cut = tick;
    });
    let maxStep = 0;
    let escaped = 0;
    while (sim.status !== "finished" && rounds <= 4) {
      sim.step();
      if (sim.tick <= cut + 1) continue;
      for (const b of sim.balls) {
        if (!b.active) continue;
        maxStep = Math.max(maxStep, Math.hypot(b.x - b.prevX, b.y - b.prevY));
        if (b.x < bounds.x || b.x > bounds.x + bounds.w || b.y < bounds.y - 100) escaped++;
      }
    }
    sim.destroy();
    expect(escaped).toBe(0);
    expect(maxStep).toBeLessThanOrEqual(sim.config.physics.maxSpeed * 1.5);
  });

  it("the camera follows the fight for last place and cuts between rounds", () => {
    const sim = createSimulation(config("last-place-elimination", "plinko", "lpe-camera"), countries);
    const camera = new Camera();
    camera.options = { mode: "follow-action", dynamicZoom: true };
    camera.setViewport(viewport);
    camera.snap(sim);
    let cut = sim.cameraCut;
    let maxJump = 0;
    let frames = 0;
    let lastVisible = 0;
    let rounds = 0;
    sim.events.on("roundStarted", () => rounds++);
    while (sim.status !== "finished" && rounds <= 5) {
      sim.step();
      const before = camera.worldToScreen(0, 0);
      camera.update(sim, 1, 1 / TICK_RATE);
      const after = camera.worldToScreen(0, 0);
      if (sim.cameraCut !== cut) {
        // A new round: the camera cuts to the start instead of panning up.
        cut = sim.cameraCut;
        continue;
      }
      maxJump = Math.max(maxJump, Math.hypot(after.x - before.x, after.y - before.y));
      const last = sim.rules.cameraSubjects?.()[0];
      if (last && sim.rules.hud().featured?.ball === last) {
        frames++;
        const p = camera.worldToScreen(last.x, last.y);
        if (p.x >= 0 && p.x <= viewport.width && p.y >= viewport.content.y && p.y <= viewport.content.y + viewport.content.h) lastVisible++;
      }
    }
    sim.destroy();
    expect(frames).toBeGreaterThan(100);
    expect(maxJump).toBeLessThan(viewport.height * 0.08);
    // The country in last place is in the content area almost all the time.
    expect(lastVisible / frames).toBeGreaterThan(0.95);
  });
});

describe("leader ↔ last camera", () => {
  const viewport = { width: 1080, height: 1920, content: { x: 60, y: 460, w: 850, h: 1020 } };

  it.each([
    ["last-place-elimination", "plinko"],
    ["race", "classic"],
  ] as const)("%s / %s: starts on the leader, alternates, and only jumps on a cut", (mode, scenario) => {
    const sim = createSimulation(config(mode, scenario, "leader-last"), countries);
    const camera = new Camera();
    camera.options = { mode: "leader-last", dynamicZoom: true };
    camera.setViewport(viewport);
    camera.snap(sim);
    const roles: string[] = [];
    let maxJump = 0;
    let live = 0;
    let visible = 0;
    let rounds = 0;
    sim.events.on("roundStarted", () => rounds++);
    while (sim.status !== "finished" && rounds <= 3 && sim.tick < 90 * TICK_RATE) {
      const cut = sim.cameraCut;
      sim.step();
      // Measure at the middle of the shot, where the viewer is looking.
      const centre = { x: camera.pose.x, y: camera.pose.y };
      const before = camera.worldToScreen(centre.x, centre.y);
      camera.update(sim, 1, 1 / TICK_RATE);
      const after = camera.worldToScreen(centre.x, centre.y);
      const spot = camera.spotlight;
      if (spot && spot.role !== roles.at(-1)) roles.push(spot.role);
      // Cuts (new round, leader ↔ last switch) are allowed to jump.
      if (sim.cameraCut === cut && !camera.cutThisFrame) maxJump = Math.max(maxJump, Math.hypot(after.x - before.x, after.y - before.y));
      if (spot) {
        live++;
        const p = camera.worldToScreen(spot.ball.x, spot.ball.y);
        if (p.x >= 0 && p.x <= viewport.width && p.y >= 0 && p.y <= viewport.height) visible++;
      }
    }
    sim.destroy();
    expect(roles[0]).toBe("leader");
    expect(roles.slice(0, 3)).toEqual(["leader", "last", "leader"]);
    expect(maxJump).toBeLessThan(viewport.height * 0.08);
    expect(visible / live).toBeGreaterThan(0.95);
  });
});
