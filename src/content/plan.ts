import type { Country } from "@/countries/countryTypes";
import { applyPreset, eligibleCountries, getPreset, PRESETS, type PresetId } from "@/countries/selection";
import { DEFAULT_CONFIG } from "@/engine/defaults";
import { createRandom, generateSeed } from "@/engine/random";
import type { ModeId, PhysicsSettings, SimulationConfig } from "@/engine/types";
import { getMode, listModes, modeDefaults } from "@/modes";
import type { TournamentSize } from "@/modes/tournament";
import { DEFAULT_DISPLAY, type DisplayOptions } from "@/render/displayOptions";
import { getMap } from "@/tracks/maps";
import { MIDDLE_MODULES } from "@/tracks/types";
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
  /** Display name, used as the video title (e.g. "Copa América de Física"). */
  name?: string;
  /** Physics overrides on top of the mode's recommended physics. */
  physics?: Partial<PhysicsSettings>;
  /** Race modes: custom module sequence (see the track editor). */
  customTrack?: { sequence: string[]; difficulty?: number };
  /**
   * Named map from the registry ("plinko", "zigzag"…). Race modes run on it;
   * Last Place Elimination takes it as its scenario.
   */
  map?: string;
  /** Time limit override, seconds. */
  maxDuration?: number;
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

  if (request.map) {
    getMap(request.map);
    if (mode !== "race" && mode !== "marble-race" && mode !== "last-place-elimination") throw new Error(`Maps apply to race modes and last-place-elimination, not ${mode}`);
  }
  const scenario =
    request.map && mode === "last-place-elimination"
      ? request.map
      : request.track === "random"
      ? random.fork("scenario").pick(definition.scenarios).id
      : (request.track ?? definition.scenarios[0]?.id ?? "default");
  if (!definition.scenarios.some((s) => s.id === scenario)) {
    const ids = definition.scenarios.map((s) => s.id).join(", ");
    throw new Error(`Unknown scenario "${scenario}" for ${mode} (expected one of: ${ids}, random)`);
  }

  const tournament = request.mode === "tournament" ? { size: request.tournamentSize ?? pickSize(codes.length) } : undefined;
  if (tournament && codes.length < tournament.size) {
    throw new Error(`A ${tournament.size}-country tournament needs ${tournament.size} countries; "${label}" has ${codes.length}`);
  }
  if (codes.length < 2) throw new Error(`"${label}" selects fewer than 2 countries`);

  let track: SimulationConfig["track"];
  if (request.customTrack) {
    if (mode !== "race" && mode !== "marble-race") throw new Error(`Custom tracks only apply to race modes, not ${mode}`);
    const unknown = request.customTrack.sequence.filter((k) => !(MIDDLE_MODULES as readonly string[]).includes(k));
    if (unknown.length) throw new Error(`Unknown track modules: ${unknown.join(", ")} (expected: ${MIDDLE_MODULES.join(", ")})`);
    track = { ...request.customTrack };
  }
  const maxParticipants = tournament
    ? tournament.size
    : Math.min(250, request.participants ?? codes.length);

  const defaults = modeDefaults(mode);
  const config: SimulationConfig = {
    ...DEFAULT_CONFIG,
    ...defaults,
    seed,
    scenario,
    countries: codes,
    maxParticipants,
    physics: { ...defaults.physics, ...request.physics },
    maxDuration: request.maxDuration ?? defaults.maxDuration,
    ...(tournament ? { tournament } : {}),
    ...(track ? { track } : {}),
    ...(request.map && mode !== "last-place-elimination" ? { map: request.map } : {}),
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
