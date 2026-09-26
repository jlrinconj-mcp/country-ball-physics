"use client";

import { useState } from "react";
import type { Country } from "@/countries/countryTypes";
import type { TournamentSummary } from "@/modes/tournament";
import type { ControllerSnapshot, RankingRow } from "@/runtime/SimulationController";
import { Button, cn } from "./ui";

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function LivePanel({ snapshot, countries }: { snapshot: ControllerSnapshot; countries: Map<string, Country> }) {
  const [copied, setCopied] = useState(false);
  const { phase, result, winner } = snapshot;

  const copyResult = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(JSON.stringify({ config: snapshot.config, result }, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid grid-cols-3 border-b border-white/[0.06]">
        <Stat label="Status" value={phaseLabel(snapshot)} />
        <Stat label="Time" value={formatClock(snapshot.time)} />
        <Stat label="Remaining" value={snapshot.total ? `${snapshot.alive}/${snapshot.total}` : "–"} />
      </div>

      {snapshot.fps > 0 && snapshot.fps < 24 && snapshot.phase === "running" && !snapshot.paused && (
        <p className="border-b border-white/[0.06] bg-amber-400/10 px-4 py-2.5 text-xs leading-relaxed text-amber-200">
          Low frame rate ({snapshot.fps} fps): motion looks choppy, but the simulation still runs at real speed. Embedded
          previews throttle animation; open the app in a regular browser tab for smooth playback.
        </p>
      )}

      {winner && result && (
        <div className="border-b border-white/[0.06] px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-300">Winner</p>
          <div className="mt-2 flex items-center gap-3">
            <span className="text-4xl leading-none">{winner.emoji}</span>
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">{winner.name}</p>
              <p className="text-xs text-zinc-500">
                {result.decidedBy === "timeout"
                  ? "Decided at the time limit"
                  : result.mode === "race" || result.mode === "marble-race"
                    ? "First across the line"
                    : "Last one standing"}{" "}
                ·{" "}
                {result.seconds.toFixed(1)}s
              </p>
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-zinc-500">Seed</dt>
            <dd className="truncate font-mono text-zinc-300">{result.seed}</dd>
            <dt className="text-zinc-500">Fingerprint</dt>
            <dd className="font-mono text-zinc-300">
              {result.fingerprint}
              {snapshot.replay === "identical" && <span className="ml-2 text-emerald-400">✓ identical replay</span>}
              {snapshot.replay === "different" && <span className="ml-2 text-red-400">✗ differs from last run</span>}
            </dd>
          </dl>
          <Button className="mt-3 w-full" onClick={copyResult}>
            {copied ? "Copied" : "Copy result JSON"}
          </Button>
        </div>
      )}

      {snapshot.tournament && <Bracket summary={snapshot.tournament} countries={countries} />}

      {snapshot.leader && phase === "running" && (
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3 text-sm">
          <span className="text-zinc-500">Leader</span>
          <span className="text-lg leading-none">{snapshot.leader.emoji}</span>
          <span className="truncate font-medium">{snapshot.leader.name}</span>
        </div>
      )}

      <div className="px-4 pt-4 pb-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">Ranking</h2>
      </div>
      <ol className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {snapshot.ranking.map((row, i) => (
          <RankRow key={row.cca3} row={row} index={i} isWinner={winner?.cca3 === row.cca3} />
        ))}
        {snapshot.ranking.length === 0 && (
          <li className="px-2 py-6 text-center text-sm text-zinc-500">
            {phase === "loading" ? "Loading flags…" : "Generate a simulation to begin."}
          </li>
        )}
      </ol>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">{label}</p>
      <p className="mt-0.5 font-mono text-sm tabular-nums text-zinc-100">{value}</p>
    </div>
  );
}

function RankRow({ row, index, isWinner }: { row: RankingRow; index: number; isWinner: boolean }) {
  const place = row.place ?? index + 1;
  return (
    <li
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2 py-1 text-sm",
        isWinner && "bg-amber-400/10",
        row.status === "eliminated" && "text-zinc-500",
      )}
    >
      <span className="w-7 text-right font-mono text-xs tabular-nums text-zinc-500">{place}</span>
      <span className="text-base leading-none">{row.emoji}</span>
      <span className="min-w-0 flex-1 truncate">{row.name}</span>
      {row.status === "eliminated" && <span className="text-[10px] uppercase tracking-wide text-red-400/70">out</span>}
      {row.status === "finished" && <span className="text-[10px] uppercase tracking-wide text-emerald-400/80">finished</span>}
    </li>
  );
}

function phaseLabel(snapshot: ControllerSnapshot): string {
  if (snapshot.phase === "running" && snapshot.paused) return "Paused";
  return { idle: "Idle", loading: "Loading", running: "Running", finished: "Finished", error: "Error" }[snapshot.phase];
}

function Bracket({ summary, countries }: { summary: TournamentSummary; countries: Map<string, Country> }) {
  const flag = (code: string) => countries.get(code)?.flag.emoji ?? code;
  const champion = summary.champion ? countries.get(summary.champion) : null;
  return (
    <div className="border-b border-white/[0.06] px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
        Tournament · {summary.size}
      </p>
      {champion && (
        <p className="mt-2 text-sm">
          <span className="text-amber-300">Champion</span> {champion.flag.emoji} <span className="font-semibold">{champion.name}</span>
        </p>
      )}
      <div className="mt-2 space-y-2.5">
        {summary.rounds.map((round, r) => (
          <div key={round.name}>
            <p className="text-xs text-zinc-500">
              {round.name}
              {round.advance > 0 && ` · top ${round.advance} advance`}
            </p>
            {round.heats.length === 0 && <p className="text-xs text-zinc-600">Waiting for qualifiers…</p>}
            <ul className="mt-1 space-y-1">
              {round.heats.map((heat, h) => {
                const active = summary.current?.round === r && summary.current.heat === h;
                const done = heat.winner !== null;
                return (
                  <li
                    key={h}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1",
                      active ? "bg-amber-400/10 ring-1 ring-amber-400/30" : "bg-zinc-900/60",
                    )}
                  >
                    <span className="w-5 font-mono text-[10px] text-zinc-500">{round.heats.length > 1 ? `H${h + 1}` : "F"}</span>
                    <span className="flex flex-wrap gap-0.5 text-sm leading-none">
                      {heat.countries.map((code) => (
                        <span
                          key={code}
                          title={countries.get(code)?.name ?? code}
                          className={cn(done && !heat.advanced.includes(code) && code !== heat.winner && "opacity-25")}
                        >
                          {flag(code)}
                        </span>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
