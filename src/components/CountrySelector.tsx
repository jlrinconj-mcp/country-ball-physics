"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeText } from "@/countries/countryService";
import { CONTINENTS, type Continent, type Country } from "@/countries/countryTypes";
import { applyPreset, eligibleCountries, PRESETS } from "@/countries/selection";
import { createRandom, generateSeed } from "@/engine/random";
import { Button, cn, Toggle } from "./ui";

export interface SelectionState {
  selected: string[];
  excluded: string[];
  includeTerritories: boolean;
  /** What the user picked last, for the summary ("Europe", "Custom"…). */
  label: string;
}

export function selectPreset(
  presetId: string,
  countries: Country[],
  state: SelectionState,
): SelectionState {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) return state;
  const pool = eligibleCountries(countries, {
    includeTerritories: state.includeTerritories,
    excluded: new Set(state.excluded),
  });
  const random = preset.random ? createRandom(generateSeed("pick")) : undefined;
  return { ...state, selected: applyPreset(preset, pool, random), label: preset.label };
}

export function PresetChips({
  countries,
  state,
  onChange,
}: {
  countries: Country[];
  state: SelectionState;
  onChange: (state: SelectionState) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          onClick={() => onChange(selectPreset(preset.id, countries, state))}
          className={cn(
            "rounded-full px-2.5 py-1 text-xs transition-colors",
            state.label === preset.label
              ? "bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/40"
              : "bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700",
          )}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}

/** Full country picker: search, filters, manual selection and exclusions. */
export function CountrySelector({
  open,
  onClose,
  countries,
  state,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  countries: Country[];
  state: SelectionState;
  onChange: (state: SelectionState) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [continent, setContinent] = useState<Continent | "all">("all");
  const [region, setRegion] = useState<string>("all");
  const [randomCount, setRandomCount] = useState(24);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // showModal focuses the first button; searching is what people want.
      searchRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const selected = useMemo(() => new Set(state.selected), [state.selected]);
  const excluded = useMemo(() => new Set(state.excluded), [state.excluded]);

  const regions = useMemo(() => {
    const set = new Set<string>();
    for (const c of countries) set.add(c.subregion ? `${c.region} › ${c.subregion}` : c.region);
    return [...set].sort();
  }, [countries]);

  const visible = useMemo(() => {
    const q = normalizeText(query);
    return countries
      .filter((c) => state.includeTerritories || c.sovereign)
      .filter((c) => continent === "all" || c.continents.includes(continent))
      .filter(
        (c) =>
          region === "all" ||
          region === c.region ||
          region === `${c.region} › ${c.subregion ?? ""}`,
      )
      .filter(
        (c) =>
          !q ||
          normalizeText(c.name).includes(q) ||
          normalizeText(c.officialName).includes(q) ||
          c.cca2.toLowerCase() === q ||
          c.cca3.toLowerCase() === q,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [countries, query, continent, region, state.includeTerritories]);

  const set = (next: Set<string>, label = "Custom") =>
    onChange({ ...state, selected: [...next].sort(), label });

  const toggle = (code: string) => {
    if (excluded.has(code)) return;
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    set(next);
  };

  const toggleExcluded = (code: string) => {
    const nextExcluded = new Set(excluded);
    const nextSelected = new Set(selected);
    if (nextExcluded.has(code)) nextExcluded.delete(code);
    else {
      nextExcluded.add(code);
      nextSelected.delete(code);
    }
    onChange({ ...state, excluded: [...nextExcluded].sort(), selected: [...nextSelected].sort(), label: "Custom" });
  };

  const selectVisible = (on: boolean) => {
    const next = new Set(selected);
    for (const c of visible) {
      if (excluded.has(c.cca3)) continue;
      if (on) next.add(c.cca3);
      else next.delete(c.cca3);
    }
    set(next);
  };

  const randomFromVisible = () => {
    const pool = visible.filter((c) => !excluded.has(c.cca3)).map((c) => c.cca3).sort();
    set(new Set(createRandom(generateSeed("pick")).sample(pool, randomCount)), `Random ${randomCount}`);
  };

  const eligibleTotal = countries.filter((c) => state.includeTerritories || c.sovereign).length;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => e.target === dialogRef.current && onClose()}
      className="m-auto h-[min(820px,92dvh)] w-[min(760px,94vw)] rounded-2xl bg-zinc-950 p-0 text-zinc-100 ring-1 ring-white/10 backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">Countries</h2>
            <p className="text-xs text-zinc-400">
              {state.selected.length} selected of {eligibleTotal}
              {state.excluded.length > 0 && ` · ${state.excluded.length} excluded`}
            </p>
          </div>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </header>

        <div className="space-y-3 border-b border-white/[0.06] px-5 py-4">
          <input
            ref={searchRef}
            className="input"
            placeholder="Search countries (name or ISO code)…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <PresetChips countries={countries} state={state} onChange={onChange} />
          <div className="flex flex-wrap items-center gap-2">
            <select className="input !w-auto" value={continent} onChange={(e) => setContinent(e.target.value as Continent | "all")}>
              <option value="all">All continents</option>
              {CONTINENTS.filter((c) => c !== "Antarctica").map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select className="input !w-auto max-w-[240px]" value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="all">All regions</option>
              {regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <div className="ml-auto w-44">
              <Toggle
                label="Territories"
                checked={state.includeTerritories}
                onChange={(includeTerritories) => {
                  const sovereign = new Set(countries.filter((c) => c.sovereign).map((c) => c.cca3));
                  onChange({
                    ...state,
                    includeTerritories,
                    selected: includeTerritories ? state.selected : state.selected.filter((code) => sovereign.has(code)),
                  });
                }}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => selectVisible(true)}>Select {visible.length} shown</Button>
            <Button onClick={() => selectVisible(false)}>Deselect shown</Button>
            <Button onClick={() => set(new Set())} variant="ghost">
              Clear all
            </Button>
            <div className="ml-auto flex items-center gap-1.5">
              <input
                type="number"
                min={2}
                max={250}
                value={randomCount}
                onChange={(e) => setRandomCount(Math.max(2, Math.min(250, Number(e.target.value) || 2)))}
                className="input !w-16 text-center"
                aria-label="Random count"
              />
              <Button onClick={randomFromVisible}>Random from shown</Button>
            </div>
          </div>
        </div>

        <ul className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {visible.map((c) => {
            const isSelected = selected.has(c.cca3);
            const isExcluded = excluded.has(c.cca3);
            return (
              <li key={c.cca3}>
                <div
                  className={cn(
                    "group flex items-center gap-3 rounded-lg px-3 py-1.5",
                    isExcluded ? "opacity-40" : "hover:bg-zinc-900",
                  )}
                >
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-amber-400"
                      checked={isSelected}
                      disabled={isExcluded}
                      onChange={() => toggle(c.cca3)}
                    />
                    <span className="text-lg leading-none">{c.flag.emoji}</span>
                    <span className="truncate text-sm">{c.name}</span>
                    <span className="font-mono text-[11px] text-zinc-500">{c.cca3}</span>
                    {!c.sovereign && <span className="text-[11px] text-zinc-500">territory</span>}
                  </label>
                  <span className="hidden text-xs text-zinc-500 sm:block">{c.continents[0]}</span>
                  <button
                    type="button"
                    onClick={() => toggleExcluded(c.cca3)}
                    className={cn(
                      "rounded-md px-2 py-0.5 text-[11px]",
                      isExcluded
                        ? "bg-red-500/15 text-red-300"
                        : "text-zinc-500 opacity-0 group-hover:opacity-100 hover:bg-zinc-800 hover:text-zinc-200",
                    )}
                  >
                    {isExcluded ? "Excluded" : "Exclude"}
                  </button>
                </div>
              </li>
            );
          })}
          {visible.length === 0 && <li className="px-3 py-8 text-center text-sm text-zinc-500">No countries match.</li>}
        </ul>
      </div>
    </dialog>
  );
}
