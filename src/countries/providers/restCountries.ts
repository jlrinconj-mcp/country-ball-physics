import type { Country, CountryDataset } from "../countryTypes";
import {
  continentFromRegion,
  flagFor,
  sortCountries,
  toContinents,
  toRegion,
} from "../normalize";

/**
 * REST Countries v5. Requires an API key (v1–v4 were shut down in 2026).
 * Only used server-side so the key never reaches the browser.
 */
export const REST_COUNTRIES_URL = "https://api.restcountries.com/countries/v5";

/** Their terms allow caching responses for up to three days. */
export const REST_COUNTRIES_MAX_STALE_MS = 3 * 24 * 60 * 60 * 1000;

const FIELDS = [
  "names.common",
  "names.official",
  "codes.alpha_2",
  "codes.alpha_3",
  "flag.emoji",
  "region",
  "subregion",
  "continents",
  "classification.sovereign",
  "classification.un_member",
  "population",
].join(",");

const PAGE_SIZE = 100;

interface V5Country {
  names?: { common?: string; official?: string };
  codes?: { alpha_2?: string; alpha_3?: string };
  flag?: { emoji?: string };
  region?: string;
  subregion?: string;
  continents?: string[];
  classification?: { sovereign?: boolean; un_member?: boolean };
  population?: number;
}

interface V5Response {
  data?: { objects?: V5Country[]; meta?: { total?: number } };
  errors?: { message?: string }[];
}

export function normalizeRestCountries(objects: V5Country[]): Country[] {
  const countries: Country[] = [];
  for (const item of objects) {
    const region = toRegion(item.region);
    const name = item.names?.common;
    const cca2 = item.codes?.alpha_2;
    const cca3 = item.codes?.alpha_3;
    if (!region || !name || !cca2 || !cca3) continue;
    const subregion = item.subregion || null;
    const continents = toContinents(item.continents);
    const unMember = item.classification?.un_member === true;
    countries.push({
      name,
      officialName: item.names?.official || name,
      cca2: cca2.toUpperCase(),
      cca3: cca3.toUpperCase(),
      flag: flagFor(cca2, item.flag?.emoji),
      region,
      subregion,
      continents: continents.length
        ? continents
        : [continentFromRegion(region, subregion)],
      sovereign: unMember || item.classification?.sovereign === true,
      unMember,
      population: typeof item.population === "number" ? item.population : null,
    });
  }
  return sortCountries(countries);
}

export async function fetchRestCountries(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CountryDataset> {
  const objects: V5Country[] = [];
  for (let offset = 0; offset < 1000; offset += PAGE_SIZE) {
    const url = `${REST_COUNTRIES_URL}?response_fields=${FIELDS}&limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`REST Countries request failed: ${res.status}`);
    const body = (await res.json()) as V5Response;
    const page = body.data?.objects ?? [];
    objects.push(...page);
    const total = body.data?.meta?.total ?? 0;
    if (page.length < PAGE_SIZE || objects.length >= total) break;
  }
  const countries = normalizeRestCountries(objects);
  if (countries.length === 0) throw new Error("REST Countries returned no countries");
  return {
    source: "restcountries-v5",
    fetchedAt: new Date().toISOString(),
    maxStaleMs: REST_COUNTRIES_MAX_STALE_MS,
    countries,
  };
}
