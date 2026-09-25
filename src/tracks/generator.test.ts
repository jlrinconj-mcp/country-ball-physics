import { describe, expect, it } from "vitest";
import { generateTrack } from "./generator";
import { MODULE_KINDS } from "./types";

const options = { length: 8, ballRadius: 24, count: 32 };

describe("generateTrack", () => {
  it("is deterministic for a seed", () => {
    expect(JSON.stringify(generateTrack("track-1", options))).toBe(JSON.stringify(generateTrack("track-1", options)));
  });

  it("varies with the seed", () => {
    const a = generateTrack("track-1", options).modules.map((m) => m.kind).join();
    const b = generateTrack("track-2", options).modules.map((m) => m.kind).join();
    const c = generateTrack("track-3", options).modules.map((m) => m.kind).join();
    expect(new Set([a, b, c]).size).toBeGreaterThan(1);
  });

  it("starts with a gate and ends with a finish line", () => {
    const track = generateTrack("shape", options);
    expect(track.modules[0]?.kind).toBe("start");
    expect(track.modules.at(-1)?.kind).toBe("finish");
    expect(track.modules).toHaveLength(options.length + 3);
    expect(track.zones.some((z) => z.kind === "finish")).toBe(true);
    expect(track.gateOpensAt).toBeGreaterThan(0);
    expect(track.finishY).toBeLessThan(track.height);
  });

  it("stacks modules without gaps and ids are unique", () => {
    const track = generateTrack("stack", options);
    let y = 0;
    for (const m of track.modules) {
      expect(m.y).toBe(y);
      y += m.height;
    }
    const ids = track.obstacles.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("builds every module kind in a fixed sequence", () => {
    const middle = MODULE_KINDS.filter((k) => !["start", "final-drop", "finish"].includes(k));
    const track = generateTrack("all-modules", { ...options, sequence: middle });
    expect(track.modules.map((m) => m.kind)).toEqual(["start", ...middle, "final-drop", "finish"]);
  });

  it("sizes the start box for the field", () => {
    const small = generateTrack("box", { ...options, count: 8 });
    const large = generateTrack("box", { ...options, count: 120 });
    expect(large.spawn.h).toBeGreaterThan(small.spawn.h);
  });
});
