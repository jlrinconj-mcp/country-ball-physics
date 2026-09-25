import type { Random } from "@/engine/random";
import type { Continent, Country } from "./countryTypes";

export type PresetId =
  | "all"
  | "europe"
  | "asia"
  | "africa"
  | "north-america"
  | "south-america"
  | "oceania"
  | "random-16"
  | "random-32"
  | "random-64";

export interface Preset {
  id: PresetId;
  label: string;
  continent?: Continent;
  random?: number;
}

export const PRESETS: Preset[] = [
  { id: "all", label: "All Countries" },
  { id: "europe", label: "Europe", continent: "Europe" },
  { id: "asia", label: "Asia", continent: "Asia" },
  { id: "africa", label: "Africa", continent: "Africa" },
  { id: "north-america", label: "North America", continent: "North America" },
  { id: "south-america", label: "South America", continent: "South America" },
  { id: "oceania", label: "Oceania", continent: "Oceania" },
  { id: "random-16", label: "Random 16", random: 16 },
  { id: "random-32", label: "Random 32", random: 32 },
  { id: "random-64", label: "Random 64", random: 64 },
];

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** Countries a preset selects (sorted alpha-3 codes). Random presets need a Random. */
export function applyPreset(preset: Preset, pool: Country[], random?: Random): string[] {
  let chosen = pool;
  if (preset.continent) {
    chosen = pool.filter((c) => c.continents.includes(preset.continent as Continent));
  } else if (preset.random) {
    if (!random) throw new Error(`Preset ${preset.id} needs a Random`);
    chosen = random.sample(sortByCode(pool), preset.random);
  }
  return chosen.map((c) => c.cca3).sort();
}

/** Eligible pool: sovereign unless territories are allowed, minus exclusions. */
export function eligibleCountries(
  countries: Country[],
  options: { includeTerritories: boolean; excluded: ReadonlySet<string> },
): Country[] {
  return countries.filter(
    (c) => (options.includeTerritories || c.sovereign) && !options.excluded.has(c.cca3),
  );
}

function sortByCode(countries: Country[]): Country[] {
  return [...countries].sort((a, b) => a.cca3.localeCompare(b.cca3));
}
