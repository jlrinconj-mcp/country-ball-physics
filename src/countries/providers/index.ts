import type { CountryDataset } from "../countryTypes";
import { fetchOpenData, OPEN_DATA_URL } from "./openData";
import { fetchRestCountries } from "./restCountries";

export interface ProviderEnv {
  RESTCOUNTRIES_API_KEY?: string;
  COUNTRIES_DATASET_URL?: string;
}

/**
 * Fetch countries from the configured upstream. REST Countries v5 is used when
 * an API key is configured; the open dataset is the key-free default and also
 * the fallback if REST Countries fails.
 */
export async function fetchUpstreamCountries(
  env: ProviderEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<CountryDataset> {
  const openDataUrl = env.COUNTRIES_DATASET_URL || OPEN_DATA_URL;
  if (env.RESTCOUNTRIES_API_KEY) {
    try {
      return await fetchRestCountries(env.RESTCOUNTRIES_API_KEY, fetchImpl);
    } catch (error) {
      console.warn("[countries] REST Countries failed, using open data", error);
    }
  }
  return fetchOpenData(openDataUrl, fetchImpl);
}
