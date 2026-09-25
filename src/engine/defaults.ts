import type { PhysicsSettings, SimulationConfig } from "./types";

export const DEFAULT_PHYSICS: PhysicsSettings = {
  gravity: 1,
  restitution: 0.95,
  friction: 0.01,
  frictionAir: 0,
  maxSpeed: 24,
  ballScale: 1,
  chaos: 0.35,
};

export const DEFAULT_CONFIG: SimulationConfig = {
  mode: "last-country-standing",
  scenario: "ring",
  seed: "world-001",
  countries: [],
  maxParticipants: 48,
  physics: DEFAULT_PHYSICS,
  maxDuration: 90,
};
