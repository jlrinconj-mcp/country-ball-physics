/**
 * Cross-engine deterministic math.
 *
 * `Math.sin`, `Math.cos`, `Math.atan2`… are not required to be correctly
 * rounded, and engines really do differ in the last bits (Node 26's V8 and
 * Chrome 152 disagree, Firefox and Safari differ again). Matter.js rotates
 * every body with Math.sin/cos each step, and physics amplifies a 1e-16
 * difference into a different winner within seconds.
 *
 * These are ports of fdlibm (the reference libm) built only from IEEE-754
 * operations that every engine computes identically (+, −, ×, ÷, sqrt,
 * Math.round). `withDeterministicMath` swaps them into `Math` while the
 * simulation runs, so Matter.js uses them too.
 */

// ── sin / cos ─────────────────────────────────────────────────────────────

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

const INV_PIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417;
const PIO2_1T = 6.07710050650619224932e-11;
const PIO4 = 7.85398163397448278999e-1;

/** sin on [-π/4, π/4]; y is the tail of the reduced argument. */
function kernelSin(x: number, y: number): number {
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}

/** cos on [-π/4, π/4]. */
function kernelCos(x: number, y: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  const hz = 0.5 * z;
  const w = 1 - hz;
  return w + (1 - w - hz + (z * r - x * y));
}

/** x = n·π/2 + (y0 + y1), Cody–Waite reduction. */
function reduce(x: number): [number, number, number] {
  const n = Math.round(x * INV_PIO2);
  const r = x - n * PIO2_1;
  const w = n * PIO2_1T;
  const y0 = r - w;
  const y1 = r - y0 - w;
  return [n, y0, y1];
}

export function dsin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) <= PIO4) return kernelSin(x, 0);
  const [n, y0, y1] = reduce(x);
  switch (n & 3) {
    case 0:
      return kernelSin(y0, y1);
    case 1:
      return kernelCos(y0, y1);
    case 2:
      return -kernelSin(y0, y1);
    default:
      return -kernelCos(y0, y1);
  }
}

export function dcos(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) <= PIO4) return kernelCos(x, 0);
  const [n, y0, y1] = reduce(x);
  switch (n & 3) {
    case 0:
      return kernelCos(y0, y1);
    case 1:
      return -kernelSin(y0, y1);
    case 2:
      return -kernelCos(y0, y1);
    default:
      return kernelSin(y0, y1);
  }
}

export function dtan(x: number): number {
  return dsin(x) / dcos(x);
}

// ── atan / atan2 ──────────────────────────────────────────────────────────

const ATAN_HI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.57079632679489655800];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.11111104054623557880e-1,
  9.09088713343650656196e-2, -7.69187620504482999495e-2, 6.66107313738753120669e-2, -5.83357013379057348645e-2,
  4.97687799461593236017e-2, -3.65315727442169155270e-2, 1.62858201153657823623e-2,
] as const;
const PI = 3.14159265358979311600;
const PI_LO = 1.22464679914735317720e-16;

export function datan(input: number): number {
  if (Number.isNaN(input)) return NaN;
  const sign = input < 0 ? -1 : 1;
  let x = Math.abs(input);
  if (x >= 7.37869762948382e19) return sign * (ATAN_HI[3]! + ATAN_LO[3]!);
  let id: number;
  if (x < 0.4375) {
    if (x < 7.450580596923828e-9) return input;
    id = -1;
    x = input;
  } else if (x < 1.1875) {
    if (x < 0.6875) {
      id = 0;
      x = (2 * x - 1) / (2 + x);
    } else {
      id = 1;
      x = (x - 1) / (x + 1);
    }
  } else if (x < 2.4375) {
    id = 2;
    x = (x - 1.5) / (1 + 1.5 * x);
  } else {
    id = 3;
    x = -1 / x;
  }
  const z = x * x;
  const w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  const r = ATAN_HI[id]! - (x * (s1 + s2) - ATAN_LO[id]! - x);
  return sign * r;
}

export function datan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (x === 1) return datan(y);
  if (y === 0) {
    if (x > 0 || Object.is(x, 0)) return y;
    return Object.is(y, -0) ? -PI : PI;
  }
  if (x === 0) return y > 0 ? PI / 2 : -PI / 2;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Math.atan2(y, x);
  const z = datan(Math.abs(y / x));
  if (x > 0) return y > 0 ? z : -z;
  return y > 0 ? PI - (z - PI_LO) : z - PI_LO - PI;
}

export function dacos(x: number): number {
  return datan2(Math.sqrt((1 - x) * (1 + x)), x);
}

/** sqrt is correctly rounded everywhere; Math.hypot is not. */
export function dhypot(...values: number[]): number {
  let sum = 0;
  for (const v of values) sum += v * v;
  return Math.sqrt(sum);
}

// ── Scoped patch ──────────────────────────────────────────────────────────

const NATIVE = { sin: Math.sin, cos: Math.cos, tan: Math.tan, atan: Math.atan, atan2: Math.atan2, acos: Math.acos, hypot: Math.hypot };
const PATCHED = { sin: dsin, cos: dcos, tan: dtan, atan: datan, atan2: datan2, acos: dacos, hypot: dhypot };
let depth = 0;

/**
 * Run `fn` with deterministic trigonometry installed on `Math` (so libraries
 * such as Matter.js use it too). Re-entrant; always restores the natives.
 */
export function withDeterministicMath<T>(fn: () => T): T {
  if (depth++ === 0) Object.assign(Math, PATCHED);
  try {
    return fn();
  } finally {
    if (--depth === 0) Object.assign(Math, NATIVE);
  }
}
