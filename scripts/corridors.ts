/**
 * Corridor report: open vertical lanes per track module, seed and ball size.
 *   npm run corridors
 */
import { createRandom } from "../src/engine/random";
import { findCorridors } from "../src/tracks/corridors";
import { TRACK_MODULES } from "../src/tracks/modules";
import { MODULE_KINDS } from "../src/tracks/types";

const RADII = [11, 16, 22, 28, 32];
const SEEDS = 12;
let open = 0;
for (const kind of MODULE_KINDS) {
  if (kind === "start" || kind === "finish") continue;
  const worst: string[] = [];
  for (const r of RADII) {
    for (let s = 0; s < SEEDS; s++) {
      const out = TRACK_MODULES[kind].build({
        random: createRandom(`corridor-${s}`).fork(kind),
        y: 0, left: 40, right: 1040, ballRadius: r, count: 32, id: kind, difficulty: (s % 3) / 2,
      });
      const c = findCorridors(out.obstacles, { ballRadius: r, left: 40, right: 1040, top: 0, bottom: out.height });
      if (c.length) {
        open++;
        worst.push(`r=${r} s=${s}: ${c.map((x) => `${x.from.toFixed(0)}–${x.to.toFixed(0)}`).join(", ")}`);
      }
    }
  }
  console.log(`${kind.padEnd(11)} ${worst.length ? `${worst.length} open\n   ${worst.slice(0, 4).join("\n   ")}` : "ok"}`);
}
process.exitCode = open ? 1 : 0;
