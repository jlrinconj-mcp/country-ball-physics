import { describe, expect, it } from "vitest";
import { dacos, datan, datan2, dcos, dhypot, dsin, dtan, withDeterministicMath } from "./deterministicMath";
import { createRandom } from "./random";

const random = createRandom("math");
const samples = Array.from({ length: 20000 }, () => random.float(-400, 400));

describe("deterministic math", () => {
  it("matches native sin/cos/tan to ~1 ulp over simulation ranges", () => {
    for (const x of samples) {
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(4e-16 * Math.max(1, Math.abs(x) / 50));
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(4e-16 * Math.max(1, Math.abs(x) / 50));
    }
    for (const x of samples.slice(0, 2000).map((v) => v / 400)) {
      expect(Math.abs(dtan(x) - Math.tan(x))).toBeLessThan(1e-15);
    }
  });

  it("matches native atan/atan2/acos", () => {
    for (let i = 0; i < samples.length - 1; i += 2) {
      const [y, x] = [samples[i]!, samples[i + 1]!];
      expect(Math.abs(datan2(y, x) - Math.atan2(y, x))).toBeLessThan(1e-15);
      expect(Math.abs(datan(y) - Math.atan(y))).toBeLessThan(1e-15);
    }
    for (const v of [-1, -0.5, 0, 0.3, 1]) expect(dacos(v)).toBeCloseTo(Math.acos(v), 14);
    expect(datan2(0, -1)).toBe(Math.PI);
    expect(datan2(1, 0)).toBe(Math.PI / 2);
    expect(dhypot(3, 4)).toBe(5);
  });

  it("is bit-for-bit stable (golden values shared by every engine)", () => {
    // Computed once; any engine must reproduce these exact doubles.
    const golden = [dsin(1), dcos(1), dsin(123.456), dcos(-77.7), datan2(3, -4), datan(0.9)];
    expect(golden).toEqual([
      0.8414709848078965, 0.5403023058681398, -0.8039373685728239, -0.667599575928841, 2.498091544796509, 0.7328151017865066,
    ]);
  });

  it("patches Math only inside the scope", () => {
    const native = Math.sin;
    let inside: unknown;
    withDeterministicMath(() => {
      inside = Math.sin;
      withDeterministicMath(() => undefined);
      expect(Math.sin).toBe(dsin);
    });
    expect(inside).toBe(dsin);
    expect(Math.sin).toBe(native);
    expect(() => withDeterministicMath(() => {
      throw new Error("boom");
    })).toThrow();
    expect(Math.sin).toBe(native);
  });
});
