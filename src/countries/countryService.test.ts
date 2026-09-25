import { describe, expect, it, vi } from "vitest";
import sample from "./__fixtures__/openData.sample.json";
import { createMemoryCache } from "./countryCache";
import { CountryService } from "./countryService";
import type { CountryDataset } from "./countryTypes";
import { emojiFromCca2 } from "./normalize";
import { normalizeOpenData } from "./providers/openData";
import { normalizeRestCountries } from "./providers/restCountries";

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse("2026-01-01T00:00:00Z");

function dataset(fetchedAt = T0, maxStaleMs: number | null = null): CountryDataset {
  return {
    source: "open-data",
    fetchedAt: new Date(fetchedAt).toISOString(),
    maxStaleMs,
    countries: normalizeOpenData(sample),
  };
}

describe("normalizeOpenData", () => {
  it("maps the open dataset into Country records", () => {
    const countries = normalizeOpenData(sample);
    const col = countries.find((c) => c.cca3 === "COL");
    expect(col).toMatchObject({
      name: "Colombia",
      officialName: "Republic of Colombia",
      cca2: "CO",
      region: "Americas",
      subregion: "South America",
      continents: ["South America"],
      sovereign: true,
    });
    expect(col?.flag.png).toBe("https://flagcdn.com/w320/co.png");
    expect(col?.flag.emoji).toBe("🇨🇴");
  });

  it("derives continents and marks territories", () => {
    const countries = normalizeOpenData(sample);
    const byCode = new Map(countries.map((c) => [c.cca3, c]));
    expect(byCode.get("USA")?.continents).toEqual(["North America"]);
    expect(byCode.get("NZL")?.continents).toEqual(["Oceania"]);
    expect(byCode.get("ATA")?.continents).toEqual(["Antarctica"]);
    expect(byCode.get("GRL")?.sovereign).toBe(false);
  });

  it("sorts by alpha-3 so downstream seeding is order-independent", () => {
    const codes = normalizeOpenData([...sample].reverse()).map((c) => c.cca3);
    expect(codes).toEqual([...codes].sort());
  });
});

describe("normalizeRestCountries", () => {
  it("maps the v5 response shape", () => {
    const [ca] = normalizeRestCountries([
      {
        names: { common: "Canada", official: "Canada" },
        codes: { alpha_2: "CA", alpha_3: "CAN" },
        flag: { emoji: "🇨🇦" },
        region: "Americas",
        subregion: "North America",
        continents: ["North America"],
        classification: { sovereign: true, un_member: true },
        population: 41_000_000,
      },
    ]);
    expect(ca).toMatchObject({ cca3: "CAN", sovereign: true, population: 41_000_000 });
    expect(ca?.flag.png).toBe("https://flagcdn.com/w320/ca.png");
  });
});

describe("emojiFromCca2", () => {
  it("builds regional indicator pairs", () => {
    expect(emojiFromCca2("br")).toBe("🇧🇷");
    expect(emojiFromCca2("XYZ")).toBe("");
  });
});

describe("CountryService", () => {
  it("filters, looks up and searches", async () => {
    const service = new CountryService({ source: async () => dataset(), now: () => T0 });
    expect((await service.getAllCountries()).some((c) => c.cca3 === "GRL")).toBe(false);
    expect(
      (await service.getAllCountries({ includeTerritories: true })).some((c) => c.cca3 === "GRL"),
    ).toBe(true);
    expect((await service.getCountryByCode("co"))?.name).toBe("Colombia");
    expect((await service.getCountryByCode("ARG"))?.name).toBe("Argentina");
    expect((await service.getCountriesByRegion("Europe")).map((c) => c.cca3)).toEqual(["FRA"]);
    expect(
      (await service.getCountriesByContinent("South America")).map((c) => c.cca3),
    ).toEqual(["ARG", "BRA", "COL"]);
    expect((await service.searchCountries("japón")).length).toBe(0);
    expect((await service.searchCountries("japan"))[0]?.cca3).toBe("JPN");
    expect((await service.searchCountries("Colómbia"))[0]?.cca3).toBe("COL");
  });

  it("fetches once while fresh and dedupes concurrent loads", async () => {
    const source = vi.fn(async () => dataset());
    const service = new CountryService({ source, now: () => T0 });
    await Promise.all([service.getAllCountries(), service.getAllCountries()]);
    await service.getCountryByCode("FR");
    expect(source).toHaveBeenCalledTimes(1);
  });

  it("uses a fresh persisted cache without hitting the source", async () => {
    const source = vi.fn(async () => dataset());
    const store = createMemoryCache(dataset(T0 - HOUR));
    const service = new CountryService({ source, store, now: () => T0 });
    expect(await service.getAllCountries()).not.toHaveLength(0);
    expect(source).not.toHaveBeenCalled();
  });

  it("serves stale cached data when the source fails", async () => {
    const store = createMemoryCache(dataset(T0 - 48 * HOUR));
    const service = new CountryService({
      source: async () => {
        throw new Error("offline");
      },
      store,
      now: () => T0,
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await service.getCountryByCode("COL"))?.name).toBe("Colombia");
    expect(service.getStatus()?.stale).toBe(true);
  });

  it("respects a provider's maximum stale age", async () => {
    const store = createMemoryCache(dataset(T0 - 96 * HOUR, 72 * HOUR));
    const service = new CountryService({
      source: async () => {
        throw new Error("offline");
      },
      store,
      now: () => T0,
    });
    await expect(service.getAllCountries()).rejects.toThrow("offline");
  });

  it("refreshes expired data and persists it", async () => {
    const store = createMemoryCache(dataset(T0 - 48 * HOUR));
    const source = vi.fn(async () => dataset(T0));
    const service = new CountryService({ source, store, now: () => T0 });
    await service.getAllCountries();
    expect(source).toHaveBeenCalledTimes(1);
    expect((await store.read())?.fetchedAt).toBe(new Date(T0).toISOString());
    expect(service.getStatus()?.stale).toBe(false);
  });
});
