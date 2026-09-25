import type { CountryDataset } from "./countryTypes";
import { isCountry } from "./normalize";

/** Persistent storage for the last good dataset (localStorage, disk, memory). */
export interface CountryCacheStore {
  read(): Promise<CountryDataset | null>;
  write(dataset: CountryDataset): Promise<void>;
}

export function isDataset(value: unknown): value is CountryDataset {
  if (!value || typeof value !== "object") return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.source === "string" &&
    typeof d.fetchedAt === "string" &&
    Array.isArray(d.countries) &&
    d.countries.length > 0 &&
    d.countries.every(isCountry)
  );
}

export function createMemoryCache(initial: CountryDataset | null = null): CountryCacheStore {
  let entry = initial;
  return {
    async read() {
      return entry;
    },
    async write(dataset) {
      entry = dataset;
    },
  };
}

const STORAGE_KEY = "cbp:countries:v1";

/** Browser cache. Silently degrades when storage is unavailable or full. */
export function createLocalStorageCache(key: string = STORAGE_KEY): CountryCacheStore {
  return {
    async read() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return isDataset(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    async write(dataset) {
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(dataset));
      } catch {
        // Private mode or quota exceeded: the in-memory copy still works.
      }
    },
  };
}
