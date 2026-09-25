import type { Country } from "@/countries/countryTypes";
import { Simulation, type ModeDefinition } from "@/engine/simulation";
import type { ModeId, SimulationConfig } from "@/engine/types";
import { lastCountryStanding } from "./lastCountryStanding";

export const MODES: Partial<Record<ModeId, ModeDefinition>> = {
  "last-country-standing": lastCountryStanding,
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
