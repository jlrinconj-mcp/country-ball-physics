import type { Country } from "@/countries/countryTypes";

/**
 * Language of everything drawn on the video. Modes and the HUD build their
 * text in English; `translate` turns those (a fixed, known set of phrases)
 * into the video's language at draw time, so the simulation itself stays
 * language-free and a result never depends on it.
 */
export type Language = "en" | "es";

export const LANGUAGES: { id: Language; label: string }[] = [
  { id: "en", label: "English" },
  { id: "es", label: "Español" },
];

const ES_PHRASES: Record<string, string> = {
  "WHO WILL WIN THE RACE?": "¿QUIÉN GANARÁ LA CARRERA?",
  "WHICH MARBLE WINS?": "¿QUÉ CANICA GANA?",
  "WHICH COUNTRY WILL WIN?": "¿QUÉ PAÍS GANARÁ?",
  "WHICH COUNTRY SURVIVES?": "¿QUÉ PAÍS SOBREVIVE?",
  "LAST ONE ON THE TRACK WINS": "GANA EL ÚLTIMO EN LA PISTA",
  "LAST PLACE IS ELIMINATED": "EL ÚLTIMO QUEDA ELIMINADO",
  COUNTRIES: "PAÍSES",
  "COUNTRIES LEFT": "QUEDAN",
  "COUNTRIES REMAINING": "QUEDAN",
  FINISHED: "EN META",
  "GO!": "¡YA!",
  "FINAL ROUND": "RONDA FINAL",
  FINAL: "FINAL",
  DANGER: "PELIGRO",
  "LAST PLACE": "ÚLTIMO",
  LEADER: "LÍDER",
  WINNER: "GANADOR",
  CHAMPION: "CAMPEÓN",
  "HEAT WINNER": "GANADOR DE LA SERIE",
  "DECIDED AT THE TIME LIMIT": "DECIDIDO AL LÍMITE DE TIEMPO",
  "SEMI-FINALS": "SEMIFINALES",
  "QUARTER-FINALS": "CUARTOS DE FINAL",
  "ROUND OF 16": "OCTAVOS DE FINAL",
  "ROUND OF 32": "DIECISEISAVOS",
  "ROUND OF 64": "TREINTAIDOSAVOS",
};

const ES_PATTERNS: [RegExp, string][] = [
  [/^ROUND (\d+)$/, "RONDA $1"],
  [/^FINAL (\d+)$/, "FINAL $1"],
  [/^(\d+) COUNTRIES$/, "$1 PAÍSES"],
  [/^(\d+) COUNTRIES LEFT$/, "QUEDAN $1 PAÍSES"],
  [/^LAST (\d+) ARE ELIMINATED$/, "LOS ÚLTIMOS $1 QUEDAN ELIMINADOS"],
  [/^(\d+)\/(\d+) SAFE$/, "$1/$2 A SALVO"],
  [/^HEAT (\d+)\/(\d+)$/, "SERIE $1/$2"],
  [/^OUT (\d+)$/, "FUERA $1"],
];

/** A HUD phrase in `language` ("ROUND 4 · 3/21 SAFE" → "RONDA 4 · 3/21 A SALVO"). */
export function translate(text: string, language: Language = "en"): string {
  if (language === "en" || !text) return text;
  return text
    .split(" · ")
    .map((part) => {
      const exact = ES_PHRASES[part];
      if (exact) return exact;
      for (const [pattern, replacement] of ES_PATTERNS) if (pattern.test(part)) return part.replace(pattern, replacement);
      return part;
    })
    .join(" · ");
}

/** True when `translate` knows the phrase (for tests). */
export function isTranslated(text: string, language: Language): boolean {
  if (language === "en") return true;
  return text.split(" · ").every((part) => part in ES_PHRASES || ES_PATTERNS.some(([p]) => p.test(part)) || /^[\d/.:#-]*$/.test(part));
}

const regionNames = new Map<Language, Intl.DisplayNames | null>();

/** A country's name in `language` (from the runtime's ICU data, English as fallback). */
export function countryName(country: Pick<Country, "name" | "cca2">, language: Language = "en"): string {
  if (language === "en") return country.name;
  if (!regionNames.has(language)) {
    try {
      regionNames.set(language, new Intl.DisplayNames([language], { type: "region", fallback: "none" }));
    } catch {
      regionNames.set(language, null);
    }
  }
  try {
    return regionNames.get(language)?.of(country.cca2) ?? country.name;
  } catch {
    return country.name;
  }
}

/** "COLOMBIA WINS" / "¡GANA COLOMBIA!" */
export function winsLine(name: string, language: Language = "en"): string {
  return language === "es" ? `¡GANA ${name}!` : `${name} WINS`;
}

/** Feed line: "COLOMBIA FINISHED #3" / "COLOMBIA IS OUT". */
export function feedLine(name: string, event: { kind: "finished" | "eliminated"; place: number | null }, language: Language = "en"): string {
  if (language === "es") return event.kind === "finished" ? `${name} LLEGA #${event.place}` : `${name} ELIMINADO`;
  return event.kind === "finished" ? `${name} FINISHED #${event.place}` : `${name} IS OUT`;
}
