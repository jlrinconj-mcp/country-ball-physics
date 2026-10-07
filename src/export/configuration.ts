import type { Country } from "@/countries/countryTypes";
import type { SimulationConfig } from "@/engine/types";
import { getMode } from "@/modes";
import { TOURNAMENT_SIZES } from "@/modes/tournament";
import { FORMATS } from "@/render/formats";
import { THEMES } from "@/render/theme";
import { MIDDLE_MODULES } from "@/tracks/types";
import { getMap } from "@/tracks/maps";
import type { ExportRequest } from "./types";

/** Validate the UI draft and the HTTP request with the same rules. No seeded defaults. */
export function validateExportRequest(raw: unknown, countries: Country[]): ExportRequest {
  if (!raw || typeof raw !== "object") throw new Error("Se requiere una configuración de video.");
  const request = raw as ExportRequest;
  const { config, display } = request;
  if (!config || !display) throw new Error("Faltan la configuración y el formato.");
  const mode = getMode(config.mode);
  if (!mode.scenarios.some(s => s.id === config.scenario)) throw new Error("El escenario no corresponde al modo seleccionado.");
  if (typeof config.seed !== "string" || !config.seed.trim() || config.seed.length > 160) throw new Error("Escribe una semilla de entre 1 y 160 caracteres.");
  if (!Array.isArray(config.countries) || config.countries.length > 250 || !config.countries.every(c => typeof c === "string")) throw new Error("Selección de países inválida.");
  const codes = [...new Set(config.countries.map(c => c.toUpperCase()))].sort();
  const byCode = new Map(countries.map(c => [c.cca3, c]));
  if (codes.some(c => !byCode.has(c))) throw new Error("La selección contiene países desconocidos.");
  if (codes.length < 2) throw new Error("Selecciona al menos dos países.");
  if (!Number.isInteger(config.maxParticipants) || config.maxParticipants < 2 || config.maxParticipants > 250) throw new Error("El máximo de participantes debe estar entre 2 y 250.");
  if (config.continuous !== undefined && typeof config.continuous !== "boolean") throw new Error("Opción de carrera continua inválida.");
  if (config.continuous && (config.mode !== "last-place-elimination" || config.tournament || config.track)) throw new Error("La carrera continua usa Last Place, sin torneo ni circuito personalizado.");
  if (config.tournament) {
    if (!(TOURNAMENT_SIZES as readonly number[]).includes(config.tournament.size)) throw new Error("Tamaño de torneo inválido.");
    if (codes.length < config.tournament.size) throw new Error(`Selecciona al menos ${config.tournament.size} países para este torneo.`);
    if (config.tournament.size === 20) {
      if (codes.length !== 20 || config.mode !== "last-place-elimination") throw new Error("El mini torneo requiere exactamente 20 países y Last Place Elimination.");
      if (codes.some(code => byCode.get(code)?.region !== "Americas" || !byCode.get(code)?.sovereign)) throw new Error("Elige exactamente 20 países de América, sin territorios, para el mini torneo.");
    }
  }
  if (config.map) getMap(config.map);
  if (config.track) {
    if (!["race", "marble-race"].includes(config.mode)) throw new Error("Este modo no admite un circuito personalizado.");
    if (!Array.isArray(config.track.sequence) || config.track.sequence.length > 30 || config.track.sequence.some(k => !(MIDDLE_MODULES as readonly string[]).includes(k))) throw new Error("Módulos de circuito inválidos.");
    if (config.track.difficulty !== undefined && (!Number.isFinite(config.track.difficulty) || config.track.difficulty < 0 || config.track.difficulty > 1)) throw new Error("Dificultad de circuito inválida.");
  }
  const bounds: Record<keyof SimulationConfig["physics"], [number, number]> = {
    gravity: [0, 3], restitution: [0, 1.2], friction: [0, 1], frictionAir: [0, 0.1],
    maxSpeed: [1, 60], ballScale: [0.3, 3], chaos: [0, 1],
  };
  if (!config.physics) throw new Error("Faltan los parámetros de física.");
  for (const [key, [min, max]] of Object.entries(bounds)) {
    const value = config.physics[key as keyof typeof config.physics];
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Parámetro de física inválido: ${key}.`);
  }
  if (!Number.isFinite(config.maxDuration) || config.maxDuration < 10 || config.maxDuration > 3600) throw new Error("Duración máxima de partida inválida.");
  if (config.elimination !== undefined && !["single", "batch"].includes(config.elimination)) throw new Error("Regla de eliminación inválida.");
  if (config.inputs !== undefined && (!Array.isArray(config.inputs) || config.inputs.length > 100_000 || config.inputs.some(input =>
    !input || input.kind !== "boost" || !Number.isSafeInteger(input.tick) || input.tick < 0 || input.tick > 60 * 3 * 3600 || !codes.includes(input.cca3)
  ))) throw new Error("Intervenciones grabadas inválidas.");
  if (!Object.hasOwn(FORMATS, display.format) || !Object.hasOwn(THEMES, display.theme)) throw new Error("Formato o tema inválido.");
  if (!["fixed", "follow-leader", "follow-action", "follow-group", "leader-last"].includes(display.camera)) throw new Error("Cámara inválida.");
  if (!["none", "code", "name"].includes(display.labels) || !["en", "es"].includes(display.language)) throw new Error("Etiquetas o idioma inválidos.");
  for (const key of ["dynamicZoom", "eyes", "hud", "ranking", "feed", "safeArea", "audio"] as const) {
    if (typeof display[key] !== "boolean") throw new Error(`Opción de video inválida: ${key}.`);
  }
  if (typeof display.headline !== "string" || display.headline.length > 160) throw new Error("El encabezado admite hasta 160 caracteres.");
  if (!Number.isFinite(display.volume) || display.volume < 0 || display.volume > 1 || !Number.isFinite(display.speed) || display.speed < 0.25 || display.speed > 4) throw new Error("Velocidad o volumen inválidos.");
  return structuredClone({ config: { ...config, countries: codes }, display });
}
