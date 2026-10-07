"use client";

import type { Country } from "@/countries/countryTypes";
import { generateSeed } from "@/engine/random";
import type { CameraMode } from "@/engine/simulation";
import type { ModeId, PhysicsSettings, SimulationConfig } from "@/engine/types";
import { getMode, listModes, modeDefaults } from "@/modes";
import { TOURNAMENT_SIZES, type TournamentSize } from "@/modes/tournament";
import { findMap, listMaps } from "@/tracks/maps";
import type { DisplayOptions, LabelMode } from "@/render/displayOptions";
import { FORMATS, type VideoFormat } from "@/render/formats";
import { THEMES, type ThemeId } from "@/render/theme";
import { PresetChips, selectPreset, type SelectionState } from "./CountrySelector";
import { TrackEditor } from "./TrackEditor";
import { LANGUAGES } from "@/render/i18n";
import { Button, Field, Section, Segmented, Select, Slider, Toggle } from "./ui";

export const CAMERA_OPTIONS: { value: CameraMode; label: string }[] = [
  { value: "fixed", label: "Whole map" },
  { value: "follow-leader", label: "Follow leader" },
  { value: "follow-action", label: "Follow action" },
  { value: "follow-group", label: "Follow main group" },
  { value: "leader-last", label: "Leader ↔ Last (Shorts)" },
];

export function seedPrefix(mode: ModeId): string {
  const prefixes: Record<ModeId, string> = {
    "last-country-standing": "lcs",
    race: "race",
    "elimination-drop": "drop",
    "marble-race": "marble",
    "last-place-elimination": "last",
  };
  return prefixes[mode];
}

export function ControlPanel({
  config,
  onConfig,
  display,
  onDisplay,
  countries,
  selection,
  onSelection,
  onOpenSelector,
}: {
  config: SimulationConfig;
  onConfig: (config: SimulationConfig) => void;
  display: DisplayOptions;
  onDisplay: (display: DisplayOptions) => void;
  countries: Country[];
  selection: SelectionState;
  onSelection: (selection: SelectionState) => void;
  onOpenSelector: () => void;
}) {
  const mode = getMode(config.mode);
  const scenario = mode.scenarios.find((s) => s.id === config.scenario) ?? mode.scenarios[0];
  const physics = (patch: Partial<PhysicsSettings>) => onConfig({ ...config, physics: { ...config.physics, ...patch } });
  const show = (patch: Partial<DisplayOptions>) => onDisplay({ ...display, ...patch });
  const participants = Math.min(selection.selected.length, config.maxParticipants);
  const tournament = config.tournament;
  const continuous = config.continuous === true;
  const format = tournament ? "tournament" : continuous ? "continuous" : "single";

  return (
    <div>
      <Section title="Competición">
        <Select
          label="Formato de competición"
          value={format}
          options={[
            { value: "single", label: "Partida · un mapa" },
            { value: "tournament", label: "Torneo · grupos y final" },
            { value: "continuous", label: "Carrera continua · mapas variados" },
          ]}
          onChange={(id) => {
            const defaults = config.mode === "last-place-elimination" ? {} : modeDefaults("last-place-elimination");
            onConfig({ ...config, ...defaults, tournament: id === "tournament" ? { size: 16 } : undefined, continuous: id === "continuous" ? true : undefined, track: undefined, map: undefined, seed: generateSeed(id === "tournament" ? "cup" : id === "continuous" ? "tour" : "last") });
            onDisplay({ ...display, camera: getMode("last-place-elimination").defaultCamera });
          }}
        />
        {tournament && (
          <>
            <p className="text-xs leading-relaxed text-zinc-500">
              {tournament.size === 20 ? "Cuatro grupos de cinco países de América. Solo el ganador de cada grupo avanza a la final de cuatro." : `Sorteo de ${tournament.size} países en grupos. Solo el primero de cada grupo clasifica; los ganadores se enfrentan en la final.`}
            </p>
            <Segmented
              label="Países en el torneo"
              value={String(tournament.size) as "8" | "16" | "20" | "32" | "64"}
              options={TOURNAMENT_SIZES.map((n) => ({ value: String(n) as "8" | "16" | "20" | "32" | "64", label: n === 20 ? "20 · América" : String(n) }))}
              onChange={(size) => {
                if (size === "20") {
                  onConfig({ ...config, ...modeDefaults("last-place-elimination"), tournament: { size: 20 }, continuous: undefined, maxParticipants: 20, track: undefined, map: undefined });
                  onSelection(selectPreset("americas-20", countries, selection));
                  onDisplay({ ...display, camera: getMode("last-place-elimination").defaultCamera });
                } else onConfig({ ...config, tournament: { size: Number(size) as TournamentSize } });
              }}
            />
          </>
        )}
        {!tournament && <p className="text-xs leading-relaxed text-zinc-500">{continuous
          ? "El último queda eliminado y los supervivientes pasan a otro mapa en cada ronda: Plinko, obstáculos, anillos y más. Continúa hasta quedar un campeón."
          : config.mode === "last-place-elimination" ? "El último queda eliminado en cada ronda. Los supervivientes vuelven a competir en el mismo mapa hasta quedar un ganador." : mode.description}</p>}
        <Select
          label={continuous ? "Primer mapa" : config.mode === "last-place-elimination" ? (tournament ? "Mapa de grupos y final" : "Mapa") : tournament ? "Escenario de grupos y final" : "Escenario"}
          value={scenario?.id ?? ""}
          options={mode.scenarios.map((s) => ({ value: s.id, label: s.label }))}
          onChange={(id) => onConfig({ ...config, scenario: id })}
        />
        {scenario && <p className="text-xs text-zinc-500">{scenario.description}</p>}
        {continuous && <p className="text-xs text-zinc-400">Después del primer mapa, los mapas cambian automáticamente sin repetir hasta completar la vuelta.</p>}
        {config.mode === "last-place-elimination" && (
          <Segmented
            label="Ritmo de eliminación"
            value={config.elimination ?? "batch"}
            options={[
              { value: "batch", label: "Rápido · por tandas" },
              { value: "single", label: "Uno por ronda" },
            ]}
            onChange={(elimination) => onConfig({ ...config, elimination })}
          />
        )}
        {config.mode !== "last-place-elimination" && (
          <>
            <Select
              label="Map"
              value={config.map ?? ""}
              options={[{ value: "", label: "Mode's own (scenario)" }, ...listMaps().map((m) => ({ value: m.id, label: m.label }))]}
              onChange={(id) => onConfig({ ...config, map: id || undefined, track: undefined })}
            />
            {findMap(config.map) && <p className="text-xs text-zinc-500">{findMap(config.map)?.description}</p>}
          </>
        )}
        {!continuous && tournament?.size !== 20 && <details className="rounded-lg border border-white/[0.06] p-3">
          <summary className="cursor-pointer text-xs text-zinc-400">Otras reglas de juego</summary>
          <div className="mt-3 space-y-2">
            <p className="text-xs text-zinc-500">Last Place reúne pistas, obstáculos y anillos con la misma regla. Aquí puedes usar los juegos clásicos.</p>
            <Select
              label="Reglas"
              value={config.mode}
              options={listModes().map((m) => ({ value: m.id, label: m.label }))}
              onChange={(id) => {
                onConfig({ ...config, ...modeDefaults(id), tournament, continuous: undefined, track: undefined, map: undefined });
                onDisplay({ ...display, camera: getMode(id).defaultCamera });
              }}
            />
          </div>
        </details>}
      </Section>

      {(config.mode === "race" || config.mode === "marble-race") && !findMap(config.map)?.arena && <TrackEditor config={config} onConfig={onConfig} />}

      <Section
        title="Countries"
        aside={
          <button type="button" onClick={onOpenSelector} className="text-xs font-medium text-amber-300 hover:text-amber-200">
            Edit selection →
          </button>
        }
      >
        <p className="text-sm text-zinc-200">
          <span className="font-semibold">{selection.label}</span>{" "}
          <span className="text-zinc-500">
            · {selection.selected.length} selected
            {tournament
              ? `, ${Math.min(tournament.size, selection.selected.length)} drawn`
              : selection.selected.length > config.maxParticipants && `, ${participants} take part (seeded sample)`}
          </span>
        </p>
        {tournament?.size === 20 && <p className="text-xs text-zinc-400">Puedes cambiar cualquiera de los 20 participantes. Usa Edit selection; el torneo sólo acepta países de América.</p>}
        <PresetChips countries={countries} state={selection} onChange={onSelection} />
        {tournament ? (
          (selection.selected.length < tournament.size || (tournament.size === 20 && selection.selected.length !== 20)) && (
            <p className="text-xs text-amber-300/80">
              {tournament.size === 20 ? "Selecciona exactamente 20 países de América." : `Select at least ${tournament.size} countries for a ${tournament.size}-country tournament.`}
            </p>
          )
        ) : (
          <Slider
            label="Max participants"
            value={config.maxParticipants}
            min={2}
            max={250}
            step={1}
            onChange={(maxParticipants) => onConfig({ ...config, maxParticipants })}
          />
        )}
      </Section>

      <Section title="Seed">
        <div className="flex gap-2">
          <input
            className="input font-mono"
            value={config.seed}
            spellCheck={false}
            onChange={(e) => onConfig({ ...config, seed: e.target.value })}
            aria-label="Seed"
          />
          <Button onClick={() => onConfig({ ...config, seed: generateSeed(tournament ? "cup" : continuous ? "tour" : seedPrefix(config.mode)) })} title="Random seed">
            ⟳
          </Button>
        </div>
        <p className="text-xs text-zinc-500">
          Same settings + same seed = the exact same simulation, on any machine.
        </p>
      </Section>

      <Section
        title="Physics"
        aside={
          <button type="button" onClick={() => onConfig({ ...config, physics: modeDefaults(config.mode).physics })} className="text-xs text-zinc-500 hover:text-zinc-300">
            Reset
          </button>
        }
      >
        <Slider label="Gravity" value={config.physics.gravity} min={0} max={3} step={0.05} onChange={(gravity) => physics({ gravity })} format={(v) => `${v.toFixed(2)}×`} />
        <Slider label="Bounciness (restitution)" value={config.physics.restitution} min={0} max={1} step={0.01} onChange={(restitution) => physics({ restitution })} format={(v) => v.toFixed(2)} />
        <Slider label="Friction" value={config.physics.friction} min={0} max={0.5} step={0.005} onChange={(friction) => physics({ friction })} format={(v) => v.toFixed(3)} />
        <Slider label="Air drag" value={config.physics.frictionAir} min={0} max={0.05} step={0.001} onChange={(frictionAir) => physics({ frictionAir })} format={(v) => v.toFixed(3)} />
        <Slider label="Ball size" value={config.physics.ballScale} min={0.5} max={1.6} step={0.05} onChange={(ballScale) => physics({ ballScale })} format={(v) => `${Math.round(v * 100)}%`} />
        <Slider label="Max speed" value={config.physics.maxSpeed} min={8} max={40} step={1} onChange={(maxSpeed) => physics({ maxSpeed })} />
        <Slider label="Chaos (random kicks)" value={config.physics.chaos} min={0} max={1} step={0.05} onChange={(chaos) => physics({ chaos })} format={(v) => `${Math.round(v * 100)}%`} />
        <Slider label="Max duration" value={config.maxDuration} min={10} max={3600} step={10} onChange={(maxDuration) => onConfig({ ...config, maxDuration })} format={(v) => `${v}s`} />
      </Section>

      <Section title="Video">
        <Segmented
          label="Format"
          value={display.format}
          options={(Object.keys(FORMATS) as VideoFormat[]).map((f) => ({ value: f, label: f }))}
          onChange={(format) => show({ format })}
        />
        <p className="-mt-1 text-xs text-zinc-500">
          {FORMATS[display.format].label} · {FORMATS[display.format].width}×{FORMATS[display.format].height}
        </p>
        <Select label="Camera" value={display.camera} options={CAMERA_OPTIONS} onChange={(camera) => show({ camera })} />
        <Toggle label="Dynamic zoom" checked={display.dynamicZoom} onChange={(dynamicZoom) => show({ dynamicZoom })} />
        <Slider label="Preview speed (video 1×)" value={display.speed} min={0.25} max={4} step={0.25} onChange={(speed) => show({ speed })} format={(v) => `${v}×`} />
        <Segmented
          label="Theme"
          value={display.theme}
          options={(Object.keys(THEMES) as ThemeId[]).map((t) => ({ value: t, label: THEMES[t].label }))}
          onChange={(theme) => show({ theme })}
        />
        <Segmented<LabelMode>
          label="Ball labels"
          value={display.labels}
          options={[
            { value: "none", label: "None" },
            { value: "code", label: "Code" },
            { value: "name", label: "Name" },
          ]}
          onChange={(labels) => show({ labels })}
        />
        <Segmented label="Video language" value={display.language} options={LANGUAGES.map((l) => ({ value: l.id, label: l.label }))} onChange={(language) => show({ language })} />
        <Toggle label="Countryball eyes" checked={display.eyes} onChange={(eyes) => show({ eyes })} />
        <Toggle label="Show safe areas" checked={display.safeArea} onChange={(safeArea) => show({ safeArea })} />
      </Section>

      <Section title="Sound">
        <Toggle label="Sound effects" checked={display.audio} onChange={(audio) => show({ audio })} />
        {display.audio && (
          <Slider label="Volume" value={display.volume} min={0} max={1} step={0.05} onChange={(volume) => show({ volume })} format={(v) => `${Math.round(v * 100)}%`} />
        )}
        <p className="text-xs text-zinc-500">Impacts, eliminations, lead changes, finish and victory. Rate-limited so big crowds stay pleasant.</p>
      </Section>

      <Section title="HUD">
        <Toggle label="Show HUD" checked={display.hud} onChange={(hud) => show({ hud })} />
        <Toggle label="Live ranking" checked={display.ranking} onChange={(ranking) => show({ ranking })} />
        <Toggle label="Event feed" checked={display.feed} onChange={(feed) => show({ feed })} />
        <Field label="Headline">
          <input
            className="input"
            placeholder="Mode default (e.g. WHICH COUNTRY WILL WIN?)"
            value={display.headline}
            onChange={(e) => show({ headline: e.target.value })}
          />
        </Field>
      </Section>
    </div>
  );
}
