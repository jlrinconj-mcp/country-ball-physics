"use client";

import { useState } from "react";
import type { ControllerSnapshot, RankingRow } from "@/runtime/SimulationController";
import { Button, cn } from "./ui";

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function LivePanel({ snapshot }: { snapshot: ControllerSnapshot }) {
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

      {winner && result && (
        <div className="border-b border-white/[0.06] px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-300">Winner</p>
          <div className="mt-2 flex items-center gap-3">
            <span className="text-4xl leading-none">{winner.emoji}</span>
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">{winner.name}</p>
              <p className="text-xs text-zinc-500">
                {result.decidedBy === "timeout" ? "Decided at the time limit" : "Last one standing"} ·{" "}
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
