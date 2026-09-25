import type { Country } from "@/countries/countryTypes";
import { flagFor } from "@/countries/normalize";

/** Synthetic countries for tests and benchmarks (no network needed). */
export function makeTestCountries(count: number): Country[] {
  return Array.from({ length: count }, (_, i) => {
    const a = String.fromCharCode(65 + Math.floor(i / 26) % 26);
    const b = String.fromCharCode(65 + (i % 26));
    const cca2 = `${a}${b}`;
    return {
      name: `Country ${cca2}`,
      officialName: `Republic of ${cca2}`,
      cca2,
      cca3: `${cca2}X`,
      flag: flagFor(cca2),
      region: "Europe",
      subregion: null,
      continents: ["Europe"],
      sovereign: true,
      unMember: true,
      population: null,
    };
  });
}
