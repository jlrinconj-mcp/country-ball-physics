import { createLocalStorageCache, isDataset } from "./countryCache";
import { CountryService } from "./countryService";
import type { CountryDataset } from "./countryTypes";

async function fetchFromApiRoute(): Promise<CountryDataset> {
  const res = await fetch("/api/countries", { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`/api/countries failed: ${res.status}`);
  const body: unknown = await res.json();
  if (!isDataset(body)) throw new Error("/api/countries returned an invalid dataset");
  return body;
}

let instance: CountryService | null = null;

/** Browser singleton: our own API route, backed by a localStorage cache. */
export function getBrowserCountryService(): CountryService {
  instance ??= new CountryService({
    source: fetchFromApiRoute,
    store: createLocalStorageCache(),
  });
  return instance;
}
