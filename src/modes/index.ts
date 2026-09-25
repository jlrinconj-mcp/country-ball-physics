import type { Country } from "@/countries/countryTypes";
import { Simulation, type ModeDefinition } from "@/engine/simulation";
import { DEFAULT_CONFIG, DEFAULT_PHYSICS } from "@/engine/defaults";
import type { ModeId, SimulationConfig } from "@/engine/types";
import { lastCountryStanding } from "./lastCountryStanding";
import { race } from "./race";

export const MODES: Partial<Record<ModeId, ModeDefinition>> = {
  "last-country-standing": lastCountryStanding,
  race,
};

export function getMode(id: ModeId): ModeDefinition {
  const mode = MODES[id];
  if (!mode) throw new Error(`Unknown mode: ${id}`);
  return mode;
}

export function listModes(): ModeDefinition[] {
  return Object.values(MODES).filter((m): m is ModeDefinition => !!m);
}

export function createSimulation(config: SimulationConfig, countries: Country[]): Simulation {
  return new Simulation(config, countries, getMode(config.mode));
}

/** Starting config for a mode: its recommended physics, limits and camera. */
export function modeDefaults(id: ModeId): Pick<SimulationConfig, "mode" | "scenario" | "maxParticipants" | "maxDuration" | "physics"> {
  const mode = getMode(id);
  return {
    mode: id,
    scenario: mode.scenarios[0]?.id ?? "default",
    maxParticipants: mode.defaultParticipants,
    maxDuration: mode.defaultDuration ?? DEFAULT_CONFIG.maxDuration,
    physics: { ...DEFAULT_PHYSICS, ...mode.recommendedPhysics },
  };
}
