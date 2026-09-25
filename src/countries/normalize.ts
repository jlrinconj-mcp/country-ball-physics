import {
  CONTINENTS,
  REGIONS,
  type Continent,
  type Country,
  type CountryFlag,
  type Region,
} from "./countryTypes";

const FLAG_CDN = "https://flagcdn.com";

/**
 * Flags always come from flagcdn.com regardless of the data provider: it sends
 * `Access-Control-Allow-Origin: *`, so images can be drawn on a canvas without
 * tainting it (required for video capture later).
 */
export function flagFor(cca2: string, emoji?: string): CountryFlag {
  const code = cca2.toLowerCase();
  return {
    png: `${FLAG_CDN}/w320/${code}.png`,
    svg: `${FLAG_CDN}/${code}.svg`,
    emoji: emoji || emojiFromCca2(cca2),
  };
}

export function emojiFromCca2(cca2: string): string {
  if (!/^[A-Za-z]{2}$/.test(cca2)) return "";
  const base = 0x1f1e6;
  return String.fromCodePoint(
    ...cca2
      .toUpperCase()
      .split("")
      .map((c) => base + c.charCodeAt(0) - 65),
  );
}

export function toRegion(value: unknown): Region | null {
  return REGIONS.find((r) => r === value) ?? null;
}

export function toContinents(values: unknown): Continent[] {
  if (!Array.isArray(values)) return [];
  return values.filter((v): v is Continent =>
    (CONTINENTS as readonly string[]).includes(v as string),
  );
}

/** Derive a continent when the provider only exposes region + subregion. */
export function continentFromRegion(
  region: Region,
  subregion: string | null,
): Continent {
  switch (region) {
    case "Africa":
    case "Asia":
    case "Europe":
    case "Oceania":
      return region;
    case "Antarctic":
      return "Antarctica";
    case "Americas":
      return subregion === "South America" ? "South America" : "North America";
  }
}

export function sortCountries(countries: Country[]): Country[] {
  return [...countries].sort((a, b) => a.cca3.localeCompare(b.cca3));
}

export function isCountry(value: unknown): value is Country {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.name === "string" &&
    typeof c.cca2 === "string" &&
    typeof c.cca3 === "string" &&
    typeof c.region === "string" &&
    Array.isArray(c.continents) &&
    !!c.flag &&
    typeof (c.flag as Record<string, unknown>).png === "string"
  );
}
