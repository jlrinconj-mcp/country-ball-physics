import { createMemoryCache } from "@/countries/countryCache";
import { CountryService } from "@/countries/countryService";
import { fetchUpstreamCountries } from "@/countries/providers";

// One service per server process: upstream is hit at most once per TTL, and a
// failed refresh keeps serving the previous dataset.
const service = new CountryService({
  source: () =>
    fetchUpstreamCountries({
      RESTCOUNTRIES_API_KEY: process.env.RESTCOUNTRIES_API_KEY,
      COUNTRIES_DATASET_URL: process.env.COUNTRIES_DATASET_URL,
    }),
  store: createMemoryCache(),
  ttlMs: 12 * 60 * 60 * 1000,
});

export async function GET() {
  try {
    const dataset = await service.getDataset();
    return Response.json(dataset, {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=43200, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    console.error("[api/countries]", error);
    return Response.json(
      { error: "Country data is temporarily unavailable" },
      { status: 502 },
    );
  }
}
