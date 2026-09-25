import type { Country, CountryDataset } from "../countryTypes";
import {
  continentFromRegion,
  flagFor,
  sortCountries,
  toRegion,
} from "../normalize";

/**
 * mledoze/countries: the open (ODbL-1.0) dataset REST Countries was originally
 * built on. Served by jsDelivr, no API key, permissive CORS.
 */
export const OPEN_DATA_URL =
  "https://cdn.jsdelivr.net/gh/mledoze/countries@master/countries.json";

interface OpenDataCountry {
  name?: { common?: string; official?: string };
  cca2?: string;
  cca3?: string;
  region?: string;
  subregion?: string;
  independent?: boolean | null;
  unMember?: boolean;
  flag?: string;
}

export function normalizeOpenData(raw: unknown): Country[] {
  if (!Array.isArray(raw)) {
    throw new Error("Open data: expected an array of countries");
  }
  const countries: Country[] = [];
  for (const item of raw as OpenDataCountry[]) {
    const region = toRegion(item.region);
    const name = item.name?.common;
    if (!region || !name || !item.cca2 || !item.cca3) continue;
    const subregion = item.subregion || null;
    const unMember = item.unMember === true;
    countries.push({
      name,
      officialName: item.name?.official || name,
      cca2: item.cca2.toUpperCase(),
      cca3: item.cca3.toUpperCase(),
      flag: flagFor(item.cca2, item.flag),
      region,
      subregion,
      continents: [continentFromRegion(region, subregion)],
      sovereign: unMember || item.independent === true,
      unMember,
      population: null,
    });
  }
  return sortCountries(countries);
}

export async function fetchOpenData(
  url: string = OPEN_DATA_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<CountryDataset> {
  const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Open data request failed: ${res.status}`);
  const countries = normalizeOpenData(await res.json());
  if (countries.length === 0) throw new Error("Open data returned no countries");
  return {
    source: "open-data",
    fetchedAt: new Date().toISOString(),
    maxStaleMs: null,
    countries,
  };
}
