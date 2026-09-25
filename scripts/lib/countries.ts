import { CountryService } from "../../src/countries/countryService";
import { fetchUpstreamCountries } from "../../src/countries/providers";
import { createFileCache } from "./fileCache";

/** CountryService for Node: upstream directly, cached in .cache/. */
export function createNodeCountryService(): CountryService {
  return new CountryService({
    source: () =>
      fetchUpstreamCountries({
        RESTCOUNTRIES_API_KEY: process.env.RESTCOUNTRIES_API_KEY,
        COUNTRIES_DATASET_URL: process.env.COUNTRIES_DATASET_URL,
      }),
    store: createFileCache(".cache/countries.json"),
  });
}
