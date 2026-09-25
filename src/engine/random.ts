/**
 * Seeded pseudo-randomness. Every random decision inside a simulation must go
 * through a `Random` created from the simulation seed — never `Math.random()`.
 *
 * `fork(label)` derives an independent stream, so each subsystem (country
 * order, spawns, track generation, forces…) consumes its own sequence. Adding
 * a random call in one subsystem therefore doesn't shift the others.
 */
export interface Random {
  readonly seed: string;
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  float(min: number, max: number): number;
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** -1 or 1. */
  sign(): 1 | -1;
  pick<T>(items: readonly T[]): T;
  /** Returns a new shuffled array (Fisher–Yates); the input is untouched. */
  shuffle<T>(items: readonly T[]): T[];
  /** Pick n distinct items. */
  sample<T>(items: readonly T[], n: number): T[];
  /** Pick one item by weight. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T;
  /** Independent stream derived from this seed and a label. */
  fork(label: string): Random;
}

/** cyrb128: 128-bit string hash, used to expand a text seed into PRNG state. */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** sfc32: small, fast, well-distributed 32-bit PRNG. */
function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export function createRandom(seed: string): Random {
  const [a, b, c, d] = cyrb128(seed);
  const next = sfc32(a, b, c, d);
  // Discard the first outputs; sfc32 needs a few rounds to mix weak seeds.
  for (let i = 0; i < 12; i++) next();

  const random: Random = {
    seed,
    next,
    float: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    sign: () => (next() < 0.5 ? -1 : 1),
    pick(items) {
      if (items.length === 0) throw new Error("Random.pick: empty array");
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    shuffle(items) {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j] as (typeof out)[number], out[i] as (typeof out)[number]];
      }
      return out;
    },
    sample(items, n) {
      return random.shuffle(items).slice(0, Math.max(0, n));
    },
    weighted(items, weight) {
      if (items.length === 0) throw new Error("Random.weighted: empty array");
      const total = items.reduce((sum, item) => sum + Math.max(0, weight(item)), 0);
      let r = next() * total;
      for (const item of items) {
        r -= Math.max(0, weight(item));
        if (r < 0) return item;
      }
      return items[items.length - 1] as (typeof items)[number];
    },
    fork: (label) => createRandom(`${seed}::${label}`),
  };
  return random;
}

const SEED_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/**
 * Human-friendly seed for the UI ("race-k7m2qx"). This is the one place where
 * non-seeded randomness is allowed: it *creates* seeds, it doesn't consume them.
 */
export function generateSeed(prefix = "world"): string {
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += SEED_ALPHABET[Math.floor(Math.random() * SEED_ALPHABET.length)];
  }
  return `${prefix}-${id}`;
}

/** Stable 32-bit hash of a string, handy for fingerprints and colors. */
export function hashString(value: string): number {
  return cyrb128(value)[0];
}
