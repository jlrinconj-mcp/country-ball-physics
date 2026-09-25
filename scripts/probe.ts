/**
 * Headless statistics for tuning modes.
 *   npm run probe -- --mode=race --scenario=classic --count=32 --runs=5
 */
import { parseArgs } from "node:util";
import { DEFAULT_CONFIG } from "../src/engine/defaults";
import { makeTestCountries } from "../src/engine/testing";
import type { ModeId } from "../src/engine/types";
import { createSimulation, modeDefaults } from "../src/modes/index";

const { values } = parseArgs({
  options: {
    mode: { type: "string", default: DEFAULT_CONFIG.mode },
    scenario: { type: "string", default: "" },
    count: { type: "string", default: "48" },
    runs: { type: "string", default: "5" },
    seed: { type: "string", default: "probe" },
    physics: { type: "string", default: "" },
  },
});

const countries = makeTestCountries(Number(values.count));
for (let i = 0; i < Number(values.runs); i++) {
  const t0 = performance.now();
  const sim = createSimulation(
    {
      ...DEFAULT_CONFIG,
      ...modeDefaults(values.mode as ModeId),
      ...(values.scenario ? { scenario: values.scenario } : {}),
      seed: `${values.seed}-${i}`,
      countries: countries.map((c) => c.cca3),
      maxParticipants: 999,
      physics: { ...modeDefaults(values.mode as ModeId).physics, ...JSON.parse(values.physics || "{}") },
    },
    countries,
  );
  const result = sim.runToEnd();
  const ms = performance.now() - t0;
  const events = result?.timeline ?? [];
  const firstOut = events.find((e) => e.type === "eliminated" || e.type === "finished");
  const leaders = events.filter((e) => e.type === "leader").length;
  console.log(
    [
      `${sim.definition.id}/${sim.scenario}`,
      `n=${sim.balls.length} r=${sim.ballRadius}`,
      `h=${Math.round(sim.layout.bounds.h)}`,
      `winner=${result?.winner.cca3} by=${result?.decidedBy}`,
      `t=${result?.seconds.toFixed(1)}s first=${firstOut ? (firstOut.tick / 60).toFixed(1) : "-"}`,
      `leaders=${leaders} finished=${sim.finishedCount} out=${sim.balls.filter((b) => b.status === "eliminated").length}`,
      `modules=${sim.layout.modules?.map((m) => m.kind).join(",") ?? "-"}`,
      `cpu=${(ms / sim.tick).toFixed(2)}ms/tick`,
    ].join("  "),
  );
  sim.destroy();
}
