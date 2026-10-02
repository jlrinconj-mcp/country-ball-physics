import type { Country } from "@/countries/countryTypes";
import { countryName } from "@/render/i18n";

/** Lower case, no accents, letters and digits only: "Côte d'Ivoire" → "cotedivoire". */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Everyday names chat uses that aren't a country's common name. */
const ALIASES: Record<string, string> = {
  usa: "USA",
  eeuu: "USA",
  eua: "USA",
  america: "USA",
  estadosunidos: "USA",
  unitedstatesofamerica: "USA",
  uk: "GBR",
  england: "GBR",
  inglaterra: "GBR",
  greatbritain: "GBR",
  granbretana: "GBR",
  britain: "GBR",
  holland: "NLD",
  holanda: "NLD",
  korea: "KOR",
  southkorea: "KOR",
  corea: "KOR",
  coreadelsur: "KOR",
  northkorea: "PRK",
  coreadelnorte: "PRK",
  russia: "RUS",
  czechia: "CZE",
  czech: "CZE",
  chequia: "CZE",
  republicacheca: "CZE",
  ivorycoast: "CIV",
  costademarfil: "CIV",
  uae: "ARE",
  emiratos: "ARE",
  drc: "COD",
  congo: "COG",
  vatican: "VAT",
  vaticano: "VAT",
  turkey: "TUR",
  turquia: "TUR",
  turkiye: "TUR",
  bolivia: "BOL",
  venezuela: "VEN",
  iran: "IRN",
  syria: "SYR",
  siria: "SYR",
  laos: "LAO",
  vietnam: "VNM",
  moldova: "MDA",
  tanzania: "TZA",
  palestina: "PSE",
  palestine: "PSE",
  taiwan: "TWN",
};

/** "🇨🇴" → "CO"; null if the text isn't a single flag emoji. */
export function flagToCca2(text: string): string | null {
  const points = [...text.trim()].map((c) => c.codePointAt(0) ?? 0);
  if (points.length !== 2 || points.some((p) => p < 0x1f1e6 || p > 0x1f1ff)) return null;
  return points.map((p) => String.fromCharCode(p - 0x1f1e6 + 65)).join("");
}

/**
 * Finds the country a viewer means: ISO codes, English or Spanish names,
 * common aliases, a flag emoji, or an unambiguous start of a name ("arg").
 */
export class CountryMatcher {
  private readonly exact = new Map<string, Country>();
  private readonly names: [string, Country][] = [];

  constructor(countries: Country[]) {
    const byCode = new Map(countries.map((c) => [c.cca3, c]));
    const add = (key: string, country: Country) => {
      if (key && !this.exact.has(key)) this.exact.set(key, country);
    };
    // Names first, then codes: "peru" is Peru, not a code clash.
    for (const c of countries) {
      for (const name of [c.name, countryName(c, "es"), c.officialName]) {
        const key = normalize(name);
        add(key, c);
        this.names.push([key, c]);
      }
    }
    for (const c of countries) {
      add(c.cca3.toLowerCase(), c);
      add(c.cca2.toLowerCase(), c);
    }
    for (const [alias, code] of Object.entries(ALIASES)) {
      const c = byCode.get(code);
      if (c) this.exact.set(alias, c);
    }
  }

  find(query: string): Country | null {
    const flag = flagToCca2(query);
    if (flag) return this.exact.get(flag.toLowerCase()) ?? null;
    const key = normalize(query);
    if (!key) return null;
    const hit = this.exact.get(key);
    if (hit) return hit;
    if (key.length < 3) return null;
    // An unambiguous start of a name: "argen" → Argentina.
    const starts = new Set(this.names.filter(([name]) => name.startsWith(key)).map(([, c]) => c));
    return starts.size === 1 ? ([...starts][0] as Country) : null;
  }
}
