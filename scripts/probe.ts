import { createSimulation } from "../src/modes/index";
import { DEFAULT_CONFIG } from "../src/engine/defaults";
import { makeTestCountries } from "../src/engine/testing";

const [scenario = "ring", nArg = "48", seedCount = "5"] = process.argv.slice(2);
const countries = makeTestCountries(Number(nArg));
for (let i = 0; i < Number(seedCount); i++) {
  const t0 = performance.now();
  const sim = createSimulation(
    { ...DEFAULT_CONFIG, scenario, seed: `probe-${i}`, countries: countries.map((c) => c.cca3), maxParticipants: 999 },
    countries,
  );
  let firstOut = -1;
  sim.events.on("countryEliminated", () => { if (firstOut < 0) firstOut = sim.time; });
  const r = sim.runToEnd();
  const ms = performance.now() - t0;
  const outs = r!.timeline.filter((e) => e.type === "eliminated").map((e) => e.tick / 60);
  const half = outs[Math.floor(outs.length / 2)] ?? 0;
  console.log(`${scenario} n=${sim.balls.length} r=${sim.ballRadius} seed=${i} winner=${r?.winner.cca3} by=${r?.decidedBy} t=${r?.seconds.toFixed(1)}s first=${firstOut.toFixed(1)} half=${half.toFixed(1)} fp=${r?.fingerprint} cpu=${ms.toFixed(0)}ms (${(ms / sim.tick).toFixed(2)}ms/tick)`);
  sim.destroy();
}
