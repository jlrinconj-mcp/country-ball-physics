import type { ModuleKind } from "@/tracks/types";
import { createRaceMode, type RaceScenario } from "./race";

/** Marble-run modules: ramps, tunnels, wheels, funnels, platforms, moving parts. */
const MARBLE_POOL: ModuleKind[] = ["zigzag", "spinner", "funnel", "tunnel", "jump", "platforms", "bottleneck", "wheel"];

const MARBLE_SCENARIOS: RaceScenario[] = [
  { id: "grand-prix", label: "Grand Prix", description: "10 marble-run modules with moving obstacles.", length: 10, pool: MARBLE_POOL, difficulty: 0.7 },
  { id: "switchbacks", label: "Switchbacks", description: "Mostly long zigzag ramps: lots of overtaking.", length: 8, pool: ["zigzag", "zigzag", "funnel", "jump"], difficulty: 0.5 },
  { id: "machines", label: "Machines", description: "Wheels, spinners and bottlenecks linked by ramps.", length: 10, pool: ["wheel", "spinner", "bottleneck", "platforms", "zigzag", "zigzag"], difficulty: 0.9 },
];

export const marbleRace = createRaceMode({
  id: "marble-race",
  label: "Marble Race",
  description: "A marble run of ramps, tunnels, wheels, funnels and moving platforms. First country across the line wins.",
  headline: "WHICH MARBLE WINS?",
  scenarios: MARBLE_SCENARIOS,
  maxRadius: 24,
});
