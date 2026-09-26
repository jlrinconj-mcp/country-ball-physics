/**
 * Stall report: where balls sit still (within two radii for STALL seconds)
 * while racing, per track map, in Last Place Elimination.
 *   npm run stalls -- [map] [countries=32] [seconds=5]      DETAIL=1 for each case
 */
import { DEFAULT_CONFIG } from "../src/engine/defaults";
import { makeTestCountries } from "../src/engine/testing";
import { createSimulation, modeDefaults } from "../src/modes";
import { listTrackMaps } from "../src/tracks/maps";
const N = Number(process.argv[3] ?? 32);
const STALL = Number(process.argv[4] ?? 5);
const countries = makeTestCountries(N);
const only = process.argv[2] || undefined;
for (const map of listTrackMaps()) {
  if (only && map.id !== only) continue;
  const spots = new Map<string, number>();
  for (const seed of ["s1", "s2", "s3"]) {
    const sim = createSimulation({ ...DEFAULT_CONFIG, ...modeDefaults("last-place-elimination"), scenario: map.id, seed: `stall-${seed}`, countries: countries.map((c) => c.cca3), maxParticipants: N }, countries);
    const anchor = new Map<number, { x: number; y: number; t: number }>();
    let rounds = 0;
    sim.events.on("roundStarted", () => { rounds++; anchor.clear(); });
    const mods = sim.layout.modules ?? [];
    while (sim.status !== "finished" && rounds <= 40) {
      sim.step();
      const hud = sim.rules.hud();
      if (!hud.status?.includes("SAFE")) continue;
      for (const b of sim.balls) {
        if (!b.active) { anchor.delete(b.id); continue; }
        const a = anchor.get(b.id);
        if (!a || Math.hypot(b.x - a.x, b.y - a.y) > 2 * b.radius) { anchor.set(b.id, { x: b.x, y: b.y, t: sim.tick }); continue; }
        if (sim.tick - a.t === Math.round(STALL * 60)) {
          const mod = mods.find((m) => b.y >= m.y && b.y < m.y + m.height);
          const key = `${mod?.kind}@${Math.round(b.x / 20) * 20},${Math.round((b.y - (mod?.y ?? 0)) / 20) * 20}`;
          spots.set(key, (spots.get(key) ?? 0) + 1);
          if (process.env.DETAIL) {
            const near = sim.obstacles.filter((o) => Math.hypot(o.x - b.x, o.y - b.y) < 700).map((o) => `${o.id}@${o.x.toFixed(0)},${o.y.toFixed(0)}`);
            const others = sim.activeBalls.filter((o) => o !== b && Math.hypot(o.x - b.x, o.y - b.y) < 3 * b.radius).map((o) => `${o.x.toFixed(0)},${o.y.toFixed(0)}`);
            console.log(`  seed=${seed} tick=${sim.tick} ball=${b.id} at ${b.x.toFixed(1)},${b.y.toFixed(1)} r=${b.radius} v=${b.vx.toFixed(2)},${b.vy.toFixed(2)} near: ${near.join(" ")} | balls: ${others.join(" ")} | mod ${JSON.stringify(mods.map((m) => [m.kind, Math.round(m.y)]))}`);
          }
        }
      }
    }
    sim.destroy();
  }
  const list = [...spots].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k}×${n}`);
  console.log(map.id.padEnd(13), list.length ? list.join("  ") : `no ${STALL} s stalls`);
}
