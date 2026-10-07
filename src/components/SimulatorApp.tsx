"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getBrowserCountryService } from "@/countries/browserCountryService";
import type { CountryDataStatus } from "@/countries/countryService";
import type { Country } from "@/countries/countryTypes";
import { DEFAULT_CONFIG } from "@/engine/defaults";
import { modeDefaults } from "@/modes";
import { generateSeed } from "@/engine/random";
import type { SimulationConfig } from "@/engine/types";
import { DEFAULT_DISPLAY, type DisplayOptions } from "@/render/displayOptions";
import { EMPTY_SNAPSHOT, SimulationController } from "@/runtime/SimulationController";
import { ControlPanel, seedPrefix } from "./ControlPanel";
import { CountrySelector, selectPreset, type SelectionState } from "./CountrySelector";
import { LiveControls } from "./LiveControls";
import { LivePanel } from "./LivePanel";
import { SimulatorViewport } from "./SimulatorViewport";
import { Button } from "./ui";
import { ConfigurationPreview } from "./ConfigurationPreview";
import { ExportPanel } from "./ExportPanel";
import { localVideoExporter } from "@/export/client";

/** For values that never change after hydration (browser capabilities). */
const subscribeNever = () => () => {};

const INITIAL_SELECTION: SelectionState = {
  selected: [],
  excluded: [],
  includeTerritories: false,
  label: "América",
};

const INITIAL_CONFIG: SimulationConfig = { ...DEFAULT_CONFIG, ...modeDefaults("last-place-elimination") };

export function SimulatorApp() {
  const [controller] = useState(() => new SimulationController());
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, () => EMPTY_SNAPSHOT);

  const [countries, setCountries] = useState<Country[] | null>(null);
  const [dataStatus, setDataStatus] = useState<CountryDataStatus | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [config, setConfig] = useState<SimulationConfig>(INITIAL_CONFIG);
  const [display, setDisplay] = useState<DisplayOptions>(DEFAULT_DISPLAY);
  const [selection, setSelection] = useState<SelectionState>(INITIAL_SELECTION);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<"pause" | "delete" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => () => controller.dispose(), [controller]);

  useEffect(() => {
    controller.setDisplay(display);
  }, [controller, display]);

  const preview = useCallback(
    (cfg: SimulationConfig) => {
      if (!countries) return;
      setActionError(null);
      void controller.preview(cfg, countries);
    },
    [controller, countries],
  );

  // Prepare the canvas without saving a video; preview and recording are explicit actions.
  useEffect(() => {
    let cancelled = false;
    const service = getBrowserCountryService();
    service
      .getAllCountries({ includeTerritories: true })
      .then((all) => {
        if (cancelled) return;
        setCountries(all);
        setDataStatus(service.getStatus());
        const initial = selectPreset("americas", all, INITIAL_SELECTION);
        setSelection(initial);
        const cfg = { ...INITIAL_CONFIG, seed: generateSeed(seedPrefix(INITIAL_CONFIG.mode)), countries: initial.selected };
        setConfig(cfg);
        void controller.load(cfg, all, true);
      })
      .catch((error: unknown) => {
        if (!cancelled) setDataError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [controller]);

  const generate = useCallback(() => preview({ ...config, countries: selection.selected }), [config, preview, selection.selected]);

  const play = useCallback(() => {
    setActionError(null);
    if (countries) void controller.playAndRecord({ ...config, countries: selection.selected }, countries);
  }, [config, controller, countries, selection.selected]);

  const newSeed = useCallback(() => {
    const next = { ...config, seed: generateSeed(config.tournament ? "cup" : config.continuous ? "tour" : seedPrefix(config.mode)), countries: selection.selected };
    setConfig(next);
  }, [config, selection.selected]);

  const restart = useCallback(() => void controller.restart(), [controller]);

  const pause = useCallback(async (paused: boolean) => {
    setPendingAction("pause");
    setActionError(null);
    try {
      await controller.setPaused(paused);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setPendingAction(null);
    }
  }, [controller]);
  const togglePause = useCallback(() => {
    const paused = snapshot.recording ? snapshot.videoExport?.status === "paused" : snapshot.paused;
    void pause(!paused).catch(() => {});
  }, [pause, snapshot.paused, snapshot.recording, snapshot.videoExport?.status]);

  const deleteVideo = useCallback(async (id?: string) => {
    setPendingAction("delete");
    setActionError(null);
    try {
      const current = controller.getSnapshot();
      if (current.recording && (!id || current.videoExport?.id === id)) {
        await controller.deleteRecording();
      } else if (id) {
        await localVideoExporter.delete(id);
        controller.forgetExport(id);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setPendingAction(null);
    }
  }, [controller]);

  const openVideos = useCallback(() => {
    const library = document.getElementById("video-library");
    library?.scrollIntoView({ behavior: "smooth", block: "start" });
    library?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  }, []);

  // Space controls playback. Saving a video always requires the Grabar button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || target.closest("input, select, textarea, button, a, summary, video, [role='dialog']"))) return;
      if (selectorOpen || snapshot.live || pendingAction || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === " ") {
        e.preventDefault();
        if (snapshot.phase === "loading" || (snapshot.recording && !snapshot.videoExport)) return;
        if (snapshot.recording || snapshot.phase === "running") togglePause();
        else generate();
      } else if (snapshot.recording || snapshot.phase === "loading") return;
      else if (key === "r") restart();
      else if (key === "n") newSeed();
      else if (key === "g") generate();
      else if (key === ".") controller.stepOnce();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controller, generate, newSeed, pendingAction, restart, selectorOpen, snapshot.live, snapshot.phase, snapshot.recording, snapshot.videoExport, togglePause]);

  // Expose the runtime for debugging and automation in development.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __cbp?: SimulationController }).__cbp = controller;
    }
  }, [controller]);

  const running = snapshot.config;
  // While live, the show runs itself: no manual runs or recordings.
  const onAir = !!snapshot.live;
  const busy = onAir || snapshot.recording || snapshot.phase === "loading";
  const canRecord = useSyncExternalStore(subscribeNever, () => controller.canRecord, () => false);
  const countryIndex = useMemo(() => new Map((countries ?? []).map((c) => [c.cca3, c])), [countries]);
  const pendingChanges =
    !!running &&
    (JSON.stringify({ ...config, countries: [] }) !== JSON.stringify({ ...running, countries: [] }) ||
      [...running.countries].sort().join() !== [...selection.selected].sort().join());
  const invalidSelection = !countries || selection.selected.length < (config.tournament?.size ?? 2);
  const exportPaused = snapshot.videoExport?.status === "paused";
  const statusText = snapshot.recording
    ? snapshot.phase === "loading" || !snapshot.videoExport ? "Preparando grabación…"
      : exportPaused ? "Grabación pausada"
      : snapshot.phase === "finished" ? "Competencia terminada · guardando video…"
      : "Grabando video"
    : snapshot.phase === "loading" ? "Preparando vista previa…"
      : snapshot.videoExport?.status === "complete" ? "Video guardado en Mis videos"
      : snapshot.phase === "finished" ? "Vista previa terminada"
      : snapshot.paused ? "Vista previa pausada · sin guardar video"
      : "Vista previa · sin guardar video";

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:flex-row lg:overflow-hidden">
      <aside className="scrollbar-thin order-2 border-white/[0.06] bg-zinc-950 lg:order-1 lg:w-[340px] lg:shrink-0 lg:overflow-y-auto lg:border-r">
        <header className="flex items-center gap-2.5 border-b border-white/[0.06] px-4 py-4">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-amber-400 text-base">🌍</span>
          <div>
            <h1 className="text-sm font-semibold leading-tight">Country Ball Physics</h1>
            <p className="text-[11px] text-zinc-500">Deterministic simulator for short-form video</p>
          </div>
        </header>
        <fieldset disabled={busy} className="min-w-0">
        {countries ? (
          <ControlPanel
            config={config}
            onConfig={setConfig}
            display={display}
            onDisplay={setDisplay}
            countries={countries}
            selection={selection}
            onSelection={setSelection}
            onOpenSelector={() => setSelectorOpen(true)}
          />
        ) : (
          <p className="px-4 py-6 text-sm text-zinc-500">{dataError ? "Country data unavailable." : "Loading countries…"}</p>
        )}
        </fieldset>
        <fieldset disabled={snapshot.recording || snapshot.phase === "loading"} className="min-w-0">
          {countries && (
            <details open={onAir || undefined} className="border-b border-white/[0.06] px-4 py-4">
              <summary className="cursor-pointer text-xs text-zinc-400">Modo en vivo (opcional)</summary>
              <div className="mt-4">
                <LiveControls controller={controller} live={snapshot.live} config={config} countries={countries} selected={selection.selected} language={display.language} />
              </div>
            </details>
          )}
        </fieldset>
        {dataStatus && (
          <p className="border-t border-white/[0.06] px-4 py-3 text-[11px] leading-relaxed text-zinc-600">
            {dataStatus.count} countries ·{" "}
            {dataStatus.source === "open-data" ? "mledoze/countries (ODbL)" : "REST Countries v5"}
            {dataStatus.stale && " · offline cache"} · flags by flagcdn.com
          </p>
        )}
      </aside>

      <main className="order-1 flex min-h-[80dvh] min-w-0 flex-1 flex-col bg-[radial-gradient(ellipse_at_center,#18181b_0%,#09090b_70%)] lg:order-2 lg:min-h-0">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
          <div>
            <p className="text-sm font-medium">Estudio de video</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">Configura · prueba la vista previa · graba cuando esté listo</p>
          </div>
          <Button onClick={openVideos} title="Abrir la carpeta de videos guardados dentro de la app">📁 Mis videos</Button>
        </div>
        {countries && <ConfigurationPreview config={{ ...config, countries: selection.selected }} display={display} countries={countries} />}
        {(dataError || snapshot.error || actionError) && (
          <div className="m-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300 ring-1 ring-red-500/30">
            {dataError || snapshot.error || actionError}
          </div>
        )}
        <div className="flex min-h-0 flex-1 p-4 lg:p-6">
          <SimulatorViewport controller={controller} format={display.format} />
        </div>
        {!onAir && <p role="status" className={`px-4 pb-3 text-center text-xs ${snapshot.recording ? "text-amber-300" : "text-zinc-400"}`}>
          {snapshot.recording && !exportPaused && snapshot.phase !== "finished" ? "● " : ""}{statusText}
        </p>}
        <div className="flex flex-wrap items-center justify-center gap-2 border-t border-white/[0.06] px-4 py-3">
          <Button
            variant="primary"
            onClick={generate}
            disabled={busy || !!pendingAction || invalidSelection}
            title="Reproducir la competencia completa sin crear un video (G)"
          >
            ▶ Ver vista previa
          </Button>
          <Button onClick={play} disabled={busy || !!pendingAction || !canRecord || invalidSelection} title="Grabar desde el inicio con esta configuración" className="bg-red-500/15 text-red-200 ring-red-500/30 hover:bg-red-500/25">
            ● Grabar video
          </Button>
          <Button variant="ghost" onClick={togglePause} disabled={!running || onAir || snapshot.phase === "loading" || (snapshot.recording && !snapshot.videoExport) || !!pendingAction || (!snapshot.recording && (snapshot.phase === "finished" || snapshot.phase === "error"))}>
            {pendingAction === "pause" ? "Aplicando…" : snapshot.recording ? exportPaused ? "Reanudar grabación" : "Pausar grabación" : snapshot.paused ? "Reanudar vista previa" : "Pausar vista previa"}
          </Button>
          {snapshot.recording && <Button onClick={() => { void deleteVideo().catch(() => {}); }} disabled={!!pendingAction} className="text-red-300" title="Detener la creación y eliminar este video">
            {pendingAction === "delete" ? "Eliminando…" : "Eliminar grabación"}
          </Button>}
          <Button variant="ghost" onClick={newSeed} disabled={busy || !!pendingAction || !countries} title="Elegir una nueva semilla (N)">
            Nueva semilla
          </Button>
          {pendingChanges && <span className="text-xs text-amber-300/80">Vista previa y Grabar aplicarán los cambios</span>}
        </div>
      </main>

      <aside className="order-3 border-white/[0.06] bg-zinc-950 lg:w-[320px] lg:shrink-0 lg:overflow-y-auto lg:border-l">
        <ExportPanel current={snapshot.videoExport} countries={countryIndex} onPause={pause} onDelete={deleteVideo} controlsBusy={pendingAction !== null} finalizingId={snapshot.recording && snapshot.phase === "finished" ? snapshot.videoExport?.id : null} />
        <LivePanel snapshot={snapshot} countries={countryIndex} />
      </aside>

      {countries && (
        <CountrySelector
          open={selectorOpen && !busy}
          onClose={() => setSelectorOpen(false)}
          countries={countries}
          state={selection}
          onChange={setSelection}
        />
      )}
    </div>
  );
}
