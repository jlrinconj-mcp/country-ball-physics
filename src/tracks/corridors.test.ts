import { describe, expect, it } from "vitest";
import { createRandom } from "@/engine/random";
import type { ObstacleSpec } from "@/engine/types";
import { findCorridors } from "./corridors";
import { pegGrid } from "./grid";
import { TRACK_MODULES } from "./modules";
import { MODULE_KINDS } from "./types";

/** Race balls range from 11 px (250 countries) to 32 px (a handful). */
const RADII = [11, 14, 18, 22, 26, 32];
const SEEDS = Array.from({ length: 8 }, (_, i) => `corridor-${i}`);
const LEFT = 40;
const RIGHT = 1040;

const peg = (x: number, y: number, r: number): ObstacleSpec => ({ id: `p${x}`, style: "peg", shapes: [{ kind: "circle", x, y, r }] });

describe("findCorridors", () => {
  it("finds the open lanes around a single peg", () => {
    const lanes = findCorridors([peg(540, 100, 20)], { ballRadius: 10, left: LEFT, right: RIGHT, top: 0, bottom: 200 });
    expect(lanes).toHaveLength(2);
    expect(lanes[0]?.from).toBe(50);
    // Blocked while the ball overlaps the peg by more than 20% of its radius
    // (centres closer than 20 + 10 × 0.8 = 28 px).
    expect(lanes[0]?.to).toBe(540 - 28);
    expect(lanes[1]?.from).toBe(540 + 28);
  });

  it("counts a moving part by the area it sweeps", () => {
    const platform: ObstacleSpec = {
      id: "platform",
      style: "platform",
      shapes: [{ kind: "rect", x: 540, y: 100, w: 200, h: 20 }],
      motion: { type: "oscillate", axis: { x: 1, y: 0 }, amplitude: 400, period: 3 },
    };
    const spinner: ObstacleSpec = {
      id: "spinner",
      style: "spinner",
      shapes: [{ kind: "rect", x: 540, y: 300, w: 400, h: 20 }],
      motion: { type: "rotate", speed: 1, pivot: { x: 540, y: 300 } },
    };
    expect(findCorridors([platform], { ballRadius: 12, left: LEFT, right: RIGHT, top: 0, bottom: 200 })).toEqual([]);
    const aroundSpinner = findCorridors([spinner], { ballRadius: 12, left: LEFT, right: RIGHT, top: 0, bottom: 600 });
    // The blade sweeps a disc of radius √(200² + 10²) ≈ 200.25 px.
    expect(aroundSpinner.map((c) => Math.round(c.to))).toEqual([Math.floor(540 - 200.25 - 12 * 0.8), 1028]);
  });

  it("the peg grid leaves no lane for any ball size", () => {
    for (const r of [8, 11, 16, 22, 26, 32, 40]) {
      const grid = pegGrid({ left: LEFT, right: RIGHT, top: 100, rows: 2, ballRadius: r });
      const obstacles = grid.pegs.map((p) => peg(p.x, p.y, grid.pegRadius));
      expect(findCorridors(obstacles, { ballRadius: r, left: LEFT, right: RIGHT, top: 0, bottom: 100 + grid.span + 100 })).toEqual([]);
      // …and a ball still fits between any two pegs.
      expect(grid.pitch - 2 * grid.pegRadius).toBeGreaterThanOrEqual(2 * r * 1.9);
    }
  });
});

describe("track modules leave no corridors", () => {
  // Start (the gate box) and Finish (the line) are open on purpose.
  const kinds = MODULE_KINDS.filter((k) => k !== "start" && k !== "finish");

  it.each(kinds)("%s", (kind) => {
    const open: string[] = [];
    for (const r of RADII) {
      SEEDS.forEach((seed, i) => {
        const out = TRACK_MODULES[kind].build({
          random: createRandom(seed).fork(kind),
          y: 0,
          left: LEFT,
          right: RIGHT,
          ballRadius: r,
          count: 32,
          id: kind,
          difficulty: (i % 3) / 2,
        });
        const lanes = findCorridors(out.obstacles, { ballRadius: r, left: LEFT, right: RIGHT, top: 0, bottom: out.height, step: 2 });
        for (const lane of lanes) open.push(`r=${r} ${seed}: x ${lane.from.toFixed(0)}–${lane.to.toFixed(0)}`);
      });
    }
    expect(open).toEqual([]);
  });
});
