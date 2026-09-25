export const CONTINENTS = [
  "Africa",
  "Antarctica",
  "Asia",
  "Europe",
  "North America",
  "Oceania",
  "South America",
] as const;

export type Continent = (typeof CONTINENTS)[number];

export const REGIONS = [
  "Africa",
  "Americas",
  "Antarctic",
  "Asia",
  "Europe",
  "Oceania",
] as const;

export type Region = (typeof REGIONS)[number];

export interface CountryFlag {
  /** Raster flag served with permissive CORS so it can be drawn on a canvas. */
  png: string;
  svg: string;
  /** Regional-indicator emoji, e.g. "🇨🇴". */
  emoji: string;
}

/** Normalized country record. The rest of the app only ever sees this shape. */
export interface Country {
  /** Common English name, e.g. "Colombia". */
  name: string;
  /** Official name, e.g. "Republic of Colombia". */
  officialName: string;
  /** ISO 3166-1 alpha-2, upper case. */
  cca2: string;
  /** ISO 3166-1 alpha-3, upper case. Used as the stable id across the app. */
  cca3: string;
  flag: CountryFlag;
  region: Region;
  subregion: string | null;
  continents: Continent[];
  /** Sovereign state (independent or UN member). False for territories. */
  sovereign: boolean;
  unMember: boolean;
  population: number | null;
}

export type CountrySourceId = "open-data" | "restcountries-v5";

export interface CountryDataset {
  source: CountrySourceId;
  /** ISO timestamp of when the upstream data was fetched. */
  fetchedAt: string;
  /**
   * Longest time this dataset may be served from a cache once it is past its
   * freshness window, in milliseconds. Upstream terms differ per source.
   */
  maxStaleMs: number | null;
  countries: Country[];
}
