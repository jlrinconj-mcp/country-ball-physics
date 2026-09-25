import type { Country } from "@/countries/countryTypes";
import { applyPreset, eligibleCountries, getPreset, PRESETS, type PresetId } from "@/countries/selection";
import { DEFAULT_CONFIG } from "@/engine/defaults";
import { createRandom, generateSeed } from "@/engine/random";
import type { ModeId, SimulationConfig } from "@/engine/types";
import { getMode, listModes, modeDefaults } from "@/modes";
import type { TournamentSize } from "@/modes/tournament";
import { DEFAULT_DISPLAY, type DisplayOptions } from "@/render/displayOptions";
import type { VideoFormat } from "@/render/formats";

export type ContentMode = ModeId | "tournament" | "random";

/**
 * High-level description of a video. Everything not given is derived from
 * the seed, so a request with a seed always resolves to the same simulation.
 */
export interface GenerateRequest {
  mode: ContentMode;
  /** "all", a preset ("europe", "random-32"…), a continent name, or ISO codes. */
  countries?: "all" | PresetId | string | string[];
  /** "random" picks a scenario with the seed; otherwise a scenario id. */
  track?: "random" | string;
  seed?: string;
  format?: VideoFormat;
  participants?: number;
  includeTerritories?: boolean;
  /** Tournament only. */
  tournamentSize?: TournamentSize;
  /** Tournament only: the mode heats are played in (default: seeded pick). */
  heatMode?: ModeId;
}

export interface SimulationPlan {
  request: GenerateRequest;
  seed: string;
  config: SimulationConfig;
  display: DisplayOptions;
  /** Human label for the country selection ("Europe", "All Countries", "🇨🇴 vs 🇦🇷"). */
  label: string;
  /** Participants that actually take part (after sampling / tournament draw). */
  participants: number;
}

/** Resolve a request into a concrete, reproducible config. Pure given the seed. */
export function planSimulation(request: GenerateRequest, countries: Country[]): SimulationPlan {
  const seed = request.seed || generateSeed(request.mode === "random" ? "world" : request.mode.split("-")[0]);
  const random = createRandom(seed).fork("content");

  const mode: ModeId =
    request.mode === "random"
      ? random.fork("mode").pick(listModes().map((m) => m.id))
      : request.mode === "tournament"
        ? (request.heatMode ?? random.fork("heat-mode").pick(["race", "marble-race", "last-country-standing"] as const))
        : request.mode;
  const definition = getMode(mode);

  const { codes, label } = resolveCountries(request, countries, random.fork("selection"));

  const scenario =
    request.track === "random"
      ? random.fork("scenario").pick(definition.scenarios).id
      : (request.track ?? definition.scenarios[0]?.id ?? "default");

  const tournament = request.mode === "tournament" ? { size: request.tournamentSize ?? pickSize(codes.length) } : undefined;
  const maxParticipants = tournament
    ? tournament.size
    : Math.min(250, request.participants ?? codes.length);

  const config: SimulationConfig = {
    ...DEFAULT_CONFIG,
    ...modeDefaults(mode),
    seed,
    scenario,
    countries: codes,
    maxParticipants,
    ...(tournament ? { tournament } : {}),
  };
  const display: DisplayOptions = {
    ...DEFAULT_DISPLAY,
    format: request.format ?? "9:16",
    camera: definition.defaultCamera,
  };
  return {
    request,
    seed,
    config,
    display,
    label,
    participants: Math.min(codes.length, maxParticipants),
  };
}

function resolveCountries(
  request: GenerateRequest,
  countries: Country[],
  random: ReturnType<typeof createRandom>,
): { codes: string[]; label: string } {
  const pool = eligibleCountries(countries, { includeTerritories: !!request.includeTerritories, excluded: new Set() });
  const spec = request.countries ?? "all";

  if (Array.isArray(spec) || (typeof spec === "string" && spec.includes(","))) {
    const wanted = (Array.isArray(spec) ? spec : spec.split(",")).map((c) => c.trim().toUpperCase()).filter(Boolean);
    const byCode = new Map(countries.flatMap((c) => [[c.cca2, c] as const, [c.cca3, c] as const]));
    const found = wanted.map((c) => byCode.get(c)).filter((c): c is Country => !!c);
    const unique = [...new Map(found.map((c) => [c.cca3, c])).values()];
    const label =
      unique.length <= 4 ? unique.map((c) => c.name).join(" vs ") : `${unique.length} Countries`;
    return { codes: unique.map((c) => c.cca3).sort(), label };
  }

  const key = spec.toLowerCase().replace(/\s+/g, "-");
  const preset = getPreset(key) ?? PRESETS.find((p) => p.continent?.toLowerCase().replace(/\s+/g, "-") === key);
  if (preset) return { codes: applyPreset(preset, pool, random), label: preset.label };

  throw new Error(`Unknown country selection "${spec}"`);
}

/** Largest standard size the selection supports, capped at 32 for video length. */
function pickSize(available: number): TournamentSize {
  if (available >= 32) return 32;
  if (available >= 16) return 16;
  return 8;
}
