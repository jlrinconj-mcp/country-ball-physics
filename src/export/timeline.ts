import type { Country } from "@/countries/countryTypes";
import { TICK_RATE } from "@/engine/physicsWorld";
import type { Simulation, SimulationResult } from "@/engine/simulation";
import type { SimulationConfig } from "@/engine/types";
import { createSimulation } from "@/modes";
import { Tournament } from "@/modes/tournament";
import type { RecordingPosition } from "./types";

export const HEAT_TAIL_TICKS = 4 * TICK_RATE;
export const FINAL_TAIL_TICKS = 3.5 * TICK_RATE;

/** One continuous timeline. A video boundary never changes its world or draw. */
export class RecordingTimeline {
  sim: Simulation;
  readonly tournament: Tournament | null;
  readonly results: SimulationResult[] = [];
  tick = 0;
  done = false;
  private off: () => void = () => {};

  constructor(readonly config: SimulationConfig, private readonly countries: Country[]) {
    this.tournament = config.tournament ? new Tournament(config, config.tournament) : null;
    this.sim = this.build(this.tournament?.current()?.config ?? config);
  }

  get position(): RecordingPosition {
    return { tick: this.tick, heatSeed: this.sim.config.seed, heatTick: this.sim.tick };
  }

  /** Called around each tick by the camera/audio renderer. */
  advance(ticks: number, hooks?: { beforeStep(): void; afterStep(): void; newHeat(): void }): void {
    for (let i = 0; i < ticks && !this.done; i++) {
      if (this.sim.finishedTick !== null) {
        const next = this.tournament?.current();
        const since = this.sim.tick - this.sim.finishedTick;
        if (next && since >= HEAT_TAIL_TICKS) {
          this.off();
          this.sim.destroy();
          this.sim = this.build(next.config);
          hooks?.newHeat();
        } else if (!next && since >= FINAL_TAIL_TICKS) {
          this.done = true;
          return;
        }
      }
      hooks?.beforeStep();
      this.sim.step();
      this.tick++;
      hooks?.afterStep();
    }
  }

  dispose(): void {
    this.off();
    this.sim.destroy();
  }

  private build(config: SimulationConfig): Simulation {
    const sim = createSimulation(config, this.countries);
    this.off = sim.events.on("simulationFinished", ({ result }) => {
      this.results.push(result);
      this.tournament?.record(result);
    });
    return sim;
  }
}
