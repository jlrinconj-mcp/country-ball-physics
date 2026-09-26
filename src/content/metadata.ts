import { createRandom } from "@/engine/random";
import type { ModeId } from "@/engine/types";
import type { SimulationPlan } from "./plan";

export type Language = "en" | "es";

export interface ContentOutcome {
  winnerName: string;
  winnerEmoji: string;
  seconds: number;
}

export interface ContentMetadata {
  language: Language;
  title: string;
  description: string;
  /** Short on-video / TikTok caption. */
  caption: string;
  hashtags: string[];
  /** Text for a thumbnail or cover frame. */
  thumbnailText: string;
  /** Spoiler line, kept separate so it's never in the title by accident. */
  result: string;
}

type Templates = Record<ModeId | "tournament", string[]>;

const TITLES: Record<Language, Templates> = {
  en: {
    "last-country-standing": ["{label}: Last Country Standing", "Which Country Survives? ({label})", "{n} Countries, Only One Survives"],
    race: ["{label} Country Race", "Which Country Wins the Race? {label}", "{n}-Country Race to the Finish"],
    "marble-race": ["{label} Marble Race", "{n} Countries Marble Race", "Marble Race: {label}"],
    "elimination-drop": ["{label} Elimination", "Plinko Elimination: {label}", "Which Country Survives the Drop?"],
    tournament: ["{label} Tournament", "{n}-Country Tournament: Who Takes the Cup?", "World Cup of Physics: {label}"],
  },
  es: {
    "last-country-standing": ["{label}: el último país en pie", "¿Qué país sobrevive? ({label})", "{n} países, solo uno sobrevive"],
    race: ["Carrera de países: {label}", "¿Qué país gana la carrera? {label}", "Carrera de {n} países"],
    "marble-race": ["Carrera de canicas: {label}", "{n} países en carrera de canicas", "Marble race: {label}"],
    "elimination-drop": ["Eliminación: {label}", "Plinko de eliminación: {label}", "¿Qué país sobrevive a la caída?"],
    tournament: ["Torneo: {label}", "Torneo de {n} países: ¿quién gana la copa?", "Mundial de física: {label}"],
  },
};

const CAPTIONS: Record<Language, string[]> = {
  en: ["Guess the winner before the end 👀", "Which country are you rooting for? 🌍", "Comment your country 👇", "Pick one before it starts ⏱️"],
  es: ["Adivina el ganador antes del final 👀", "¿Por qué país vas? 🌍", "Comenta tu país 👇", "Elige uno antes de que empiece ⏱️"],
};

const MODE_TAGS: Record<ModeId | "tournament", string[]> = {
  "last-country-standing": ["lastcountrystanding", "survival"],
  race: ["countryrace", "race"],
  "marble-race": ["marblerace", "marbles"],
  "elimination-drop": ["plinko", "elimination"],
  tournament: ["tournament", "worldcup"],
};

/** Titles, captions and hashtags for a finished simulation. Seeded, so stable per seed. */
export function buildMetadata(plan: SimulationPlan, outcome: ContentOutcome, language: Language = "en"): ContentMetadata {
  const random = createRandom(plan.seed).fork("metadata");
  const kind = plan.config.tournament ? "tournament" : plan.config.mode;
  const fill = (template: string) =>
    template.replace("{label}", plan.label).replace("{n}", String(plan.participants));

  const generated = fill(random.pick(TITLES[language][kind]));
  const title = plan.request.name ? plan.request.name : generated;
  const caption = random.pick(CAPTIONS[language]);
  const labelTag = plan.label.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const hashtags = [
    "countryballs",
    "countries",
    "physics",
    ...MODE_TAGS[kind],
    ...(labelTag && labelTag.length <= 20 ? [labelTag] : []),
    "shorts",
  ];
  const seconds = Math.round(outcome.seconds);
  const intro = plan.request.name ? `${plan.request.name} · ${generated}\n\n` : "";
  const description =
    intro +
    (language === "es"
      ? `${plan.participants} países, un ganador. Simulación física reproducible (seed: ${plan.seed}).\n\n${hashtags.map((h) => `#${h}`).join(" ")}`
      : `${plan.participants} countries, one winner. A reproducible physics simulation (seed: ${plan.seed}).\n\n${hashtags.map((h) => `#${h}`).join(" ")}`);
  const result =
    language === "es"
      ? `${outcome.winnerEmoji} ${outcome.winnerName} gana en ${seconds}s`
      : `${outcome.winnerEmoji} ${outcome.winnerName} wins in ${seconds}s`;
  return {
    language,
    title,
    description,
    caption,
    hashtags,
    thumbnailText: language === "es" ? "¿QUÉ PAÍS GANARÁ?" : "WHICH COUNTRY WILL WIN?",
    result,
  };
}
