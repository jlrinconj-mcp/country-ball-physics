/**
 * Map pacing report: Last Place Elimination on every map, full runs.
 *   npm run maps -- --count=32 --seeds=2
 * A round is intro + race + result; the target is 8–15 s.
 */
import { parseArgs } from "node:util";
import { DEFAULT_CONFIG } from "../src/engine/defaults";
import { makeTestCountries } from "../src/engine/testing";
import { createSimulation, modeDefaults } from "../src/modes/index";
import { listMaps } from "../src/tracks/maps";

const { values } = parseArgs({
  options: {
    count: { type: "string", default: "32" },
    seeds: { type: "string", default: "2" },
    map: { type: "string", default: "" },
  },
});

const count = Number(values.count);
const countries = makeTestCountries(count);
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] ?? 0;

for (const map of listMaps()) {
  if (values.map && map.id !== values.map) continue;
  const rounds: number[] = [];
  let totals = 0;
  for (let s = 0; s < Number(values.seeds); s++) {
    const sim = createSimulation(
      { ...DEFAULT_CONFIG, ...modeDefaults("last-place-elimination"), scenario: map.id, seed: `maps-${s}`, countries: countries.map((c) => c.cca3), maxParticipants: count },
      countries,
    );
    const starts: number[] = [];
    sim.events.on("roundStarted", ({ tick }) => starts.push(tick));
    const result = sim.runToEnd();
    // The final round ends at the decisive crossing; only full rounds count.
    starts.forEach((t, i) => {
      const next = starts[i + 1];
      if (next === undefined) return;
      const seconds = (next - t) / 60;
      rounds.push(seconds);
    });
    totals += result?.seconds ?? 0;
    sim.destroy();
  }
  console.log(
    `${map.id.padEnd(8)} pace=${map.pace.join("–")}s  rounds min=${Math.min(...rounds).toFixed(1)}s p10=${pct(rounds, 0.1).toFixed(1)}s median=${pct(rounds, 0.5).toFixed(1)}s p90=${pct(rounds, 0.9).toFixed(1)}s max=${Math.max(...rounds).toFixed(1)}s  video≈${(totals / Number(values.seeds) / 60).toFixed(1)} min`,
  );
}
