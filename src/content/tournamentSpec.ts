import type { Country } from "@/countries/countryTypes";
import type { ModeId, PhysicsSettings } from "@/engine/types";
import { listModes } from "@/modes";
import { TOURNAMENT_SIZES, type TournamentSize } from "@/modes/tournament";
import { FORMATS, type VideoFormat } from "@/render/formats";
import { runPlan, type GeneratedSimulation } from "./generateSimulation";
import type { Language } from "./metadata";
import { planSimulation, type GenerateRequest } from "./plan";

/**
 * A custom tournament, as JSON. Everything optional is derived from the seed.
 *
 *   {
 *     "name": "Copa América de Física",
 *     "countries": "south-america",
 *     "size": 8,
 *     "heatMode": "marble-race",
 *     "heatScenario": "switchbacks",
 *     "language": "es"
 *   }
 */
export interface TournamentSpec {
  name?: string;
  seed?: string;
  /** "all", a preset ("europe", "random-32"), a continent, or ISO codes. */
  countries: string | string[];
  size?: TournamentSize;
  heatMode?: ModeId;
  /** Scenario id for every heat, or "random" (seeded). */
  heatScenario?: string;
  /** Race modes: the same custom module sequence for every heat. */
  track?: { sequence: string[]; difficulty?: number };
  physics?: Partial<PhysicsSettings>;
  maxDuration?: number;
  format?: VideoFormat;
  language?: Language;
  includeTerritories?: boolean;
}

const PHYSICS_KEYS: (keyof PhysicsSettings)[] = ["gravity", "restitution", "friction", "frictionAir", "maxSpeed", "ballScale", "chaos"];

/** Validate untrusted JSON into a spec, with messages that say what to fix. */
export function parseTournamentSpec(raw: unknown): TournamentSpec {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Tournament spec must be a JSON object");
  const o = raw as Record<string, unknown>;
  const errors: string[] = [];
  const str = (key: string) => {
    if (o[key] !== undefined && typeof o[key] !== "string") errors.push(`"${key}" must be a string`);
    return o[key] as string | undefined;
  };

  const countries = o.countries;
  if (typeof countries !== "string" && !(Array.isArray(countries) && countries.every((c) => typeof c === "string"))) {
    errors.push(`"countries" is required: "all", a preset like "europe", or a list of ISO codes`);
  }
  if (o.size !== undefined && !(TOURNAMENT_SIZES as readonly unknown[]).includes(o.size)) {
    errors.push(`"size" must be one of ${TOURNAMENT_SIZES.join(", ")}`);
  }
  const modes = listModes().map((m) => m.id);
  if (o.heatMode !== undefined && !modes.includes(o.heatMode as ModeId)) {
    errors.push(`"heatMode" must be one of ${modes.join(", ")}`);
  }
  if (o.format !== undefined && !Object.keys(FORMATS).includes(o.format as string)) errors.push(`"format" must be one of ${Object.keys(FORMATS).join(", ")}`);
  if (o.language !== undefined && o.language !== "en" && o.language !== "es") errors.push(`"language" must be "en" or "es"`);
  if (o.maxDuration !== undefined && !(typeof o.maxDuration === "number" && o.maxDuration >= 10)) errors.push(`"maxDuration" must be a number of seconds ≥ 10`);
  if (o.physics !== undefined) {
    if (!o.physics || typeof o.physics !== "object") errors.push(`"physics" must be an object`);
    else {
      for (const [key, value] of Object.entries(o.physics)) {
        if (!PHYSICS_KEYS.includes(key as keyof PhysicsSettings)) errors.push(`unknown physics setting "${key}" (expected: ${PHYSICS_KEYS.join(", ")})`);
        else if (typeof value !== "number" || !Number.isFinite(value) || value < 0) errors.push(`physics.${key} must be a non-negative number`);
      }
    }
  }
  if (o.track !== undefined) {
    const t = o.track as Record<string, unknown> | null;
    if (!t || !Array.isArray(t.sequence) || !t.sequence.every((k) => typeof k === "string")) errors.push(`"track.sequence" must be a list of module names`);
  }
  const name = str("name");
  const seed = str("seed");
  const heatScenario = str("heatScenario");
  if (errors.length) throw new Error(`Invalid tournament spec:\n- ${errors.join("\n- ")}`);

  return {
    name,
    seed,
    countries: countries as string | string[],
    size: o.size as TournamentSize | undefined,
    heatMode: o.heatMode as ModeId | undefined,
    heatScenario,
    track: o.track as TournamentSpec["track"],
    physics: o.physics as TournamentSpec["physics"],
    maxDuration: o.maxDuration as number | undefined,
    format: o.format as VideoFormat | undefined,
    language: o.language as Language | undefined,
    includeTerritories: o.includeTerritories === true,
  };
}

export function tournamentRequest(spec: TournamentSpec, seed?: string): GenerateRequest {
  return {
    mode: "tournament",
    name: spec.name,
    seed: seed ?? spec.seed,
    countries: spec.countries,
    tournamentSize: spec.size,
    heatMode: spec.heatMode ?? "race",
    track: spec.heatScenario,
    customTrack: spec.track,
    physics: spec.physics,
    maxDuration: spec.maxDuration,
    format: spec.format,
    includeTerritories: spec.includeTerritories,
  };
}

export interface TournamentRun extends GeneratedSimulation {
  /** Heats that needed the time limit (a smooth run has none). */
  timeouts: string[];
}

/** Plan and run a custom tournament headless. Same spec + seed → same bracket. */
export function runTournamentSpec(spec: TournamentSpec, countries: Country[], seed?: string): TournamentRun {
  const plan = planSimulation(tournamentRequest(spec, seed), countries);
  const generated = runPlan(plan, countries, spec.language ?? "en");
  const timeouts = (generated.tournament?.outcomes ?? []).filter((o) => o.result.decidedBy === "timeout").map((o) => o.heat.seed);
  return { ...generated, timeouts };
}

/** Human-readable bracket (Markdown) for a finished tournament. */
export function bracketMarkdown(run: TournamentRun, countries: Country[]): string {
  const byCode = new Map(countries.map((c) => [c.cca3, c]));
  const label = (code: string) => {
    const c = byCode.get(code);
    return c ? `${c.flag.emoji} ${c.name}` : code;
  };
  const t = run.tournament;
  if (!t) return "";
  const lines = [`# ${run.metadata.title}`, "", `Seed \`${run.plan.seed}\` · ${t.size} countries · ${run.plan.config.mode} (${run.plan.config.scenario})`, ""];
  let round = -1;
  for (const outcome of t.outcomes) {
    if (outcome.heat.round !== round) {
      round = outcome.heat.round;
      const isFinal = outcome.advanced.length === 0;
      lines.push(`## ${isFinal ? "Final" : `Round ${round + 1}`}`, "");
    }
    const place = (code: string) => outcome.result.ranking.find((r) => r.cca3 === code)?.place ?? 0;
    const ordered = [...outcome.heat.countries].sort((a, b) => place(a) - place(b));
    lines.push(
      `**Heat ${outcome.heat.heat + 1}** (${outcome.result.seconds.toFixed(1)} s${outcome.result.decidedBy === "timeout" ? ", time limit" : ""}): ` +
        ordered
          .map((code) => {
            const through = outcome.advanced.includes(code) || (outcome.advanced.length === 0 && code === t.champion);
            return `${place(code)}. ${label(code)}${through ? " ✅" : ""}`;
          })
          .join(" · "),
      "",
    );
  }
  lines.push(`🏆 **Champion: ${label(t.champion)}**`, "");
  return lines.join("\n");
}
