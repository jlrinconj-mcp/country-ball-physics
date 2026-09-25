import { describe, expect, it } from "vitest";
import { EventBus } from "./events";
import { createRandom } from "./random";

describe("createRandom", () => {
  it("is reproducible for the same seed", () => {
    const a = createRandom("world-race-001");
    const b = createRandom("world-race-001");
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("differs across seeds", () => {
    const a = createRandom("seed-a").next();
    const b = createRandom("seed-b").next();
    expect(a).not.toBe(b);
  });

  it("stays within ranges", () => {
    const r = createRandom("ranges");
    for (let i = 0; i < 2000; i++) {
      const f = r.float(-2, 3);
      const n = r.int(1, 6);
      expect(f).toBeGreaterThanOrEqual(-2);
      expect(f).toBeLessThan(3);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(6);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  it("covers every integer in an inclusive range", () => {
    const r = createRandom("coverage");
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(r.int(0, 9));
    expect(seen.size).toBe(10);
  });

  it("shuffles without mutating and keeps all items", () => {
    const items = Array.from({ length: 30 }, (_, i) => i);
    const shuffled = createRandom("shuffle").shuffle(items);
    expect(items).toEqual(Array.from({ length: 30 }, (_, i) => i));
    expect([...shuffled].sort((x, y) => x - y)).toEqual(items);
    expect(shuffled).not.toEqual(items);
    expect(createRandom("shuffle").shuffle(items)).toEqual(shuffled);
  });

  it("forks independent, reproducible streams", () => {
    const root = createRandom("root");
    const a1 = root.fork("track").next();
    root.next();
    root.next();
    const a2 = root.fork("track").next();
    expect(a1).toBe(a2);
    expect(root.fork("spawn").next()).not.toBe(a1);
  });

  it("samples distinct items", () => {
    const picked = createRandom("sample").sample(["a", "b", "c", "d", "e"], 3);
    expect(new Set(picked).size).toBe(3);
  });
});

describe("EventBus", () => {
  it("delivers typed events, supports once and unsubscribe", () => {
    const bus = new EventBus<{ ping: number; done: undefined }>();
    const got: number[] = [];
    const off = bus.on("ping", (n) => got.push(n));
    let onceCount = 0;
    bus.once("ping", () => onceCount++);
    bus.emit("ping", 1);
    bus.emit("ping", 2);
    off();
    bus.emit("ping", 3);
    expect(got).toEqual([1, 2]);
    expect(onceCount).toBe(1);
    const all: string[] = [];
    bus.onAny((type) => all.push(String(type)));
    bus.emit("done", undefined);
    expect(all).toEqual(["done"]);
  });
});
