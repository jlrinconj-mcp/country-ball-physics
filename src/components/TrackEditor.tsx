"use client";

import { useState } from "react";
import { createRandom, generateSeed } from "@/engine/random";
import type { SimulationConfig } from "@/engine/types";
import { MARBLE_SCENARIOS } from "@/modes/marbleRace";
import { previewSequence, RACE_SCENARIOS } from "@/modes/race";
import { TRACK_MODULES } from "@/tracks/modules";
import { MIDDLE_MODULES, type ModuleKind } from "@/tracks/types";
import { Button, Section, Slider, Toggle } from "./ui";

const label = (kind: string) => TRACK_MODULES[kind as ModuleKind]?.label ?? kind;

/**
 * Track editor for race modes: pick, order and remove the modules between the
 * start gate and the final drop. Module geometry still comes from the seed.
 */
export function TrackEditor({ config, onConfig }: { config: SimulationConfig; onConfig: (c: SimulationConfig) => void }) {
  const scenarios = config.mode === "marble-race" ? MARBLE_SCENARIOS : RACE_SCENARIOS;
  const preview = previewSequence(scenarios, config.scenario, config.seed);
  const [adding, setAdding] = useState<ModuleKind>("zigzag");
  const custom = config.track;
  const sequence = custom?.sequence ?? preview;
  const difficulty = custom?.difficulty ?? scenarios.find((s) => s.id === config.scenario)?.difficulty ?? 0.5;

  const set = (next: string[], nextDifficulty = difficulty) =>
    onConfig({ ...config, track: { sequence: next, difficulty: nextDifficulty } });
  const move = (i: number, delta: number) => {
    const next = [...sequence];
    const j = i + delta;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j] as string, next[i] as string];
    set(next);
  };

  return (
    <Section title="Track">
      <Toggle
        label="Custom track"
        checked={!!custom}
        onChange={(on) => onConfig({ ...config, track: on ? { sequence: preview, difficulty } : undefined })}
      />
      {!custom ? (
        <p className="text-xs leading-relaxed text-zinc-500">
          Generated from the seed: <span className="text-zinc-400">{preview.map(label).join(" → ")}</span>
        </p>
      ) : (
        <>
          <ol className="space-y-1 text-[13px]">
            <li className="rounded-md bg-zinc-900/60 px-2 py-1 text-zinc-500">Start gate</li>
            {sequence.map((kind, i) => (
              <li key={`${kind}-${i}`} className="flex items-center gap-1 rounded-md bg-zinc-900 px-2 py-1">
                <span className="w-5 font-mono text-[11px] text-zinc-500">{i + 1}</span>
                <span className="flex-1 text-zinc-200">{label(kind)}</span>
                <button type="button" className="px-1 text-zinc-500 hover:text-zinc-200" onClick={() => move(i, -1)} aria-label="Move up">
                  ↑
                </button>
                <button type="button" className="px-1 text-zinc-500 hover:text-zinc-200" onClick={() => move(i, 1)} aria-label="Move down">
                  ↓
                </button>
                <button
                  type="button"
                  className="px-1 text-zinc-500 hover:text-red-300"
                  onClick={() => set(sequence.filter((_, j) => j !== i))}
                  aria-label="Remove"
                >
                  ✕
                </button>
              </li>
            ))}
            <li className="rounded-md bg-zinc-900/60 px-2 py-1 text-zinc-500">Final drop → Finish</li>
          </ol>
          <div className="flex gap-2">
            <select className="input" value={adding} onChange={(e) => setAdding(e.target.value as ModuleKind)} aria-label="Module to add">
              {MIDDLE_MODULES.map((kind) => (
                <option key={kind} value={kind}>
                  {label(kind)}
                </option>
              ))}
            </select>
            <Button onClick={() => set([...sequence, adding])} disabled={sequence.length >= 20}>
              Add
            </Button>
          </div>
          <Slider label="Difficulty" value={difficulty} min={0} max={1} step={0.05} onChange={(d) => set(sequence, d)} format={(v) => `${Math.round(v * 100)}%`} />
          <Button
            className="w-full"
            onClick={() => set(createRandom(generateSeed("mix")).shuffle(sequence))}
            disabled={sequence.length < 2}
          >
            Shuffle order
          </Button>
        </>
      )}
    </Section>
  );
}
