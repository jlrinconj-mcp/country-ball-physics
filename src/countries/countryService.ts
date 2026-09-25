import type { CountryCacheStore } from "./countryCache";
import type {
  Continent,
  Country,
  CountryDataset,
  CountrySourceId,
  Region,
} from "./countryTypes";

export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface CountryServiceOptions {
  /** Loads a fresh dataset from wherever this runtime gets its data. */
  source: () => Promise<CountryDataset>;
  store?: CountryCacheStore;
  /** How long a dataset counts as fresh. */
  ttlMs?: number;
  /** After an upstream failure, keep serving cached data this long before retrying. */
  retryAfterMs?: number;
  now?: () => number;
}

export interface CountryQueryOptions {
  /** Include dependent territories (Greenland, Puerto Rico…). Default false. */
  includeTerritories?: boolean;
}

export interface CountryDataStatus {
  source: CountrySourceId;
  fetchedAt: string;
  /** Served from a cache after the upstream request failed. */
  stale: boolean;
  count: number;
}

/**
 * The only entry point the app uses for country data. It hides the upstream
 * API behind a cache: fresh data is reused, and if the upstream fails the last
 * good dataset keeps the simulator working.
 */
export class CountryService {
  private readonly source: () => Promise<CountryDataset>;
  private readonly store: CountryCacheStore | undefined;
  private readonly ttlMs: number;
  private readonly retryAfterMs: number;
  private readonly now: () => number;

  private dataset: CountryDataset | null = null;
  private stale = false;
  private byCode = new Map<string, Country>();
  private inflight: Promise<CountryDataset> | null = null;
  private lastFailureAt = -Infinity;

  constructor(options: CountryServiceOptions) {
    this.source = options.source;
    this.store = options.store;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.retryAfterMs = options.retryAfterMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  /** The full dataset (territories included) with its provenance. */
  async getDataset(): Promise<CountryDataset> {
    return this.load();
  }

  async getAllCountries(options: CountryQueryOptions = {}): Promise<Country[]> {
    const { countries } = await this.load();
    return options.includeTerritories
      ? countries
      : countries.filter((c) => c.sovereign);
  }

  /** Accepts ISO alpha-2 or alpha-3, case-insensitive. */
  async getCountryByCode(code: string): Promise<Country | undefined> {
    await this.load();
    return this.byCode.get(code.trim().toUpperCase());
  }

  async getCountriesByCodes(codes: readonly string[]): Promise<Country[]> {
    await this.load();
    return codes
      .map((code) => this.byCode.get(code.trim().toUpperCase()))
      .filter((c): c is Country => !!c);
  }

  async getCountriesByRegion(
    region: Region,
    options: CountryQueryOptions = {},
  ): Promise<Country[]> {
    return (await this.getAllCountries(options)).filter((c) => c.region === region);
  }

  async getCountriesByContinent(
    continent: Continent,
    options: CountryQueryOptions = {},
  ): Promise<Country[]> {
    return (await this.getAllCountries(options)).filter((c) =>
      c.continents.includes(continent),
    );
  }

  async searchCountries(
    query: string,
    options: CountryQueryOptions = {},
  ): Promise<Country[]> {
    const q = normalizeText(query);
    const all = await this.getAllCountries(options);
    if (!q) return all;
    return all.filter(
      (c) =>
        normalizeText(c.name).includes(q) ||
        normalizeText(c.officialName).includes(q) ||
        c.cca2.toLowerCase() === q ||
        c.cca3.toLowerCase() === q,
    );
  }

  getStatus(): CountryDataStatus | null {
    if (!this.dataset) return null;
    return {
      source: this.dataset.source,
      fetchedAt: this.dataset.fetchedAt,
      stale: this.stale,
      count: this.dataset.countries.length,
    };
  }

  /** Force a refetch on the next call. */
  invalidate(): void {
    this.dataset = null;
  }

  private async load(): Promise<CountryDataset> {
    if (this.dataset && this.isFresh(this.dataset)) return this.dataset;
    if (this.dataset && this.now() - this.lastFailureAt < this.retryAfterMs) {
      return this.dataset;
    }
    this.inflight ??= this.resolve().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async resolve(): Promise<CountryDataset> {
    const cached = this.dataset ?? (await this.store?.read()) ?? null;
    if (cached && this.isFresh(cached)) return this.use(cached, false);

    try {
      const fresh = await this.source();
      await this.store?.write(fresh);
      return this.use(fresh, false);
    } catch (error) {
      this.lastFailureAt = this.now();
      if (cached && this.canServeStale(cached)) {
        console.warn("[countries] upstream failed, serving cached data", error);
        return this.use(cached, true);
      }
      throw error;
    }
  }

  private use(dataset: CountryDataset, stale: boolean): CountryDataset {
    this.dataset = dataset;
    this.stale = stale;
    this.byCode = new Map();
    for (const c of dataset.countries) {
      this.byCode.set(c.cca2, c);
      this.byCode.set(c.cca3, c);
    }
    return dataset;
  }

  private age(dataset: CountryDataset): number {
    const fetched = Date.parse(dataset.fetchedAt);
    return Number.isFinite(fetched) ? this.now() - fetched : Infinity;
  }

  private isFresh(dataset: CountryDataset): boolean {
    return this.age(dataset) < this.ttlMs;
  }

  private canServeStale(dataset: CountryDataset): boolean {
    return dataset.maxStaleMs === null || this.age(dataset) < dataset.maxStaleMs;
  }
}

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}
