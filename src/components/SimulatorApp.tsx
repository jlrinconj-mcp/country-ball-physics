"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getBrowserCountryService } from "@/countries/browserCountryService";
import type { CountryDataStatus } from "@/countries/countryService";
import type { Country } from "@/countries/countryTypes";
import { DEFAULT_CONFIG } from "@/engine/defaults";
import { generateSeed } from "@/engine/random";
import type { SimulationConfig } from "@/engine/types";
import { DEFAULT_DISPLAY, type DisplayOptions } from "@/render/displayOptions";
import { EMPTY_SNAPSHOT, SimulationController } from "@/runtime/SimulationController";
import { ControlPanel, seedPrefix } from "./ControlPanel";
import { CountrySelector, selectPreset, type SelectionState } from "./CountrySelector";
import { LivePanel } from "./LivePanel";
import { SimulatorViewport } from "./SimulatorViewport";
import { Button } from "./ui";

/** For values that never change after hydration (browser capabilities). */
const subscribeNever = () => () => {};

const INITIAL_SELECTION: SelectionState = {
  selected: [],
  excluded: [],
  includeTerritories: false,
  label: "All Countries",
};

export function SimulatorApp() {
  const [controller] = useState(() => new SimulationController());
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, () => EMPTY_SNAPSHOT);

  const [countries, setCountries] = useState<Country[] | null>(null);
  const [dataStatus, setDataStatus] = useState<CountryDataStatus | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [config, setConfig] = useState<SimulationConfig>(DEFAULT_CONFIG);
  const [display, setDisplay] = useState<DisplayOptions>(DEFAULT_DISPLAY);
  const [selection, setSelection] = useState<SelectionState>(INITIAL_SELECTION);
  const [selectorOpen, setSelectorOpen] = useState(false);

  useEffect(() => () => controller.dispose(), [controller]);

  useEffect(() => {
    controller.setDisplay(display);
  }, [controller, display]);

  const run = useCallback(
    (cfg: SimulationConfig) => {
      if (!countries) return;
      void controller.load(cfg, countries);
    },
    [controller, countries],
  );

  // Load country data, then start a simulation right away.
  useEffect(() => {
    let cancelled = false;
    const service = getBrowserCountryService();
    service
      .getAllCountries({ includeTerritories: true })
      .then((all) => {
        if (cancelled) return;
        setCountries(all);
        setDataStatus(service.getStatus());
        const initial = selectPreset("all", all, INITIAL_SELECTION);
        setSelection(initial);
        const cfg = { ...DEFAULT_CONFIG, seed: generateSeed(seedPrefix(DEFAULT_CONFIG.mode)), countries: initial.selected };
        setConfig(cfg);
        void controller.load(cfg, all);
      })
      .catch((error: unknown) => {
        if (!cancelled) setDataError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [controller]);

  const generate = useCallback(() => run({ ...config, countries: selection.selected }), [config, run, selection.selected]);

  const newSeed = useCallback(() => {
    const next = { ...config, seed: generateSeed(config.tournament ? "cup" : seedPrefix(config.mode)), countries: selection.selected };
    setConfig(next);
    run(next);
  }, [config, run, selection.selected]);

  const replaySameSeed = useCallback(() => {
    const seed = snapshot.config?.seed ?? config.seed;
    const next = { ...config, seed, countries: selection.selected };
    setConfig(next);
    run(next);
  }, [config, run, selection.selected, snapshot.config?.seed]);

  const restart = useCallback(() => void controller.restart(), [controller]);

  const togglePause = useCallback(() => controller.setPaused(!snapshot.paused), [controller, snapshot.paused]);

  // Keyboard shortcuts: Space pause, R restart, N new seed, G generate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (selectorOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === " ") {
        e.preventDefault();
        togglePause();
      } else if (key === "r") restart();
      else if (key === "n") newSeed();
      else if (key === "g") generate();
      else if (key === ".") controller.stepOnce();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controller, generate, newSeed, restart, selectorOpen, togglePause]);

  // Expose the runtime for debugging and automation in development.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __cbp?: SimulationController }).__cbp = controller;
    }
  }, [controller]);

  const running = snapshot.config;
  const canRecord = useSyncExternalStore(subscribeNever, () => controller.canRecord, () => false);
  const countryIndex = useMemo(() => new Map((countries ?? []).map((c) => [c.cca3, c])), [countries]);
  const pendingChanges =
    !!running &&
    (JSON.stringify({ ...config, countries: [] }) !== JSON.stringify({ ...running, countries: [] }) ||
      [...running.countries].sort().join() !== [...selection.selected].sort().join());

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
        {dataStatus && (
          <p className="border-t border-white/[0.06] px-4 py-3 text-[11px] leading-relaxed text-zinc-600">
            {dataStatus.count} countries ·{" "}
            {dataStatus.source === "open-data" ? "mledoze/countries (ODbL)" : "REST Countries v5"}
            {dataStatus.stale && " · offline cache"} · flags by flagcdn.com
          </p>
        )}
      </aside>

      <main className="order-1 flex min-h-[80dvh] min-w-0 flex-1 flex-col bg-[radial-gradient(ellipse_at_center,#18181b_0%,#09090b_70%)] lg:order-2 lg:min-h-0">
        {dataError && (
          <div className="m-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300 ring-1 ring-red-500/30">
            Couldn&apos;t load country data: {dataError}
          </div>
        )}
        <div className="flex min-h-0 flex-1 p-4 lg:p-6">
          <SimulatorViewport controller={controller} format={display.format} />
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 border-t border-white/[0.06] px-4 py-3">
          <Button
            variant="primary"
            onClick={generate}
            disabled={!countries || selection.selected.length < (config.tournament?.size ?? 2)}
          >
            Generate Simulation
          </Button>
          <Button onClick={restart} disabled={!running} title="Restart this run from the beginning (R)">
            Restart
          </Button>
          <Button onClick={replaySameSeed} disabled={!countries} title="Run again with the last seed and current settings">
            Replay Same Seed
          </Button>
          <Button onClick={newSeed} disabled={!countries} title="Fresh seed, run immediately (N)">
            New Seed
          </Button>
          <span className="mx-1 h-5 w-px bg-white/10" />
          <Button variant="ghost" onClick={togglePause} disabled={!running} title="Pause / resume (Space)">
            {snapshot.paused ? "▶ Play" : "❚❚ Pause"}
          </Button>
          {snapshot.paused && (
            <Button variant="ghost" onClick={() => controller.stepOnce()} title="Step one tick (.)">
              Step
            </Button>
          )}
          <span className="mx-1 h-5 w-px bg-white/10" />
          {snapshot.recording ? (
            <Button onClick={() => void controller.stopRecording()} title="Stop and download now">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> Stop recording
            </Button>
          ) : (
            <Button
              onClick={() => void controller.record()}
              disabled={!running || !canRecord}
              title={canRecord ? "Replay from the start and download a full-resolution video" : "Video recording isn't supported in this browser"}
            >
              <span className="h-2 w-2 rounded-full bg-red-500" /> Record video
            </Button>
          )}
          {pendingChanges && <span className="text-xs text-amber-300/80">Settings changed · Generate to apply</span>}
        </div>
      </main>

      <aside className="order-3 border-white/[0.06] bg-zinc-950 lg:w-[300px] lg:shrink-0 lg:border-l">
        <LivePanel snapshot={snapshot} countries={countryIndex} />
      </aside>

      {countries && (
        <CountrySelector
          open={selectorOpen}
          onClose={() => setSelectorOpen(false)}
          countries={countries}
          state={selection}
          onChange={setSelection}
        />
      )}
    </div>
  );
}
