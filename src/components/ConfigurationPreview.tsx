"use client";

import { useMemo } from "react";
import type { Country } from "@/countries/countryTypes";
import type { SimulationConfig } from "@/engine/types";
import { selectParticipants } from "@/engine/simulation";
import { validateExportRequest } from "@/export/configuration";
import { getMode } from "@/modes";
import { Tournament } from "@/modes/tournament";
import type { DisplayOptions } from "@/render/displayOptions";
import { findMap } from "@/tracks/maps";

export function ConfigurationPreview({ config, display, countries }: { config: SimulationConfig; display: DisplayOptions; countries: Country[] }) {
  const preview = useMemo(() => {
    try {
      const request = validateExportRequest({ config, display }, countries);
      const tournament = request.config.tournament ? new Tournament(request.config, request.config.tournament) : null;
      const codes = tournament?.rounds[0]?.heats.flatMap(h => h.countries) ?? selectParticipants(request.config, countries).map(c => c.cca3);
      return { codes, tournament, error: null };
    } catch (error) {
      return { codes: [], tournament: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [config, display, countries]);
  const byCode = new Map(countries.map(c => [c.cca3, c]));
  return (
    <section aria-label="Configuración del video" className="border-b border-white/[0.06] px-4 py-3 text-xs">
      <p className="font-medium text-zinc-200">{config.tournament ? `Torneo de ${config.tournament.size}` : config.continuous ? "Carrera continua" : "Partida"} · {getMode(config.mode).label} · {config.continuous ? "mapas variados" : findMap(config.map ?? config.scenario)?.label ?? config.scenario} · {display.format}</p>
      <p className="mt-1 text-zinc-400">Semilla: <span className="font-mono">{config.seed || "pendiente"}</span> · {preview.codes.length} participantes · {display.language === "es" ? "Español" : "English"} · Video con sonido, a 1× · Partes de hasta 120 s</p>
      {config.continuous && <p className="mt-1 text-zinc-400">Empieza en {findMap(config.map ?? config.scenario)?.label ?? config.scenario}; los supervivientes cambian de mapa en cada ronda.</p>}
      {config.tournament && <p className="mt-1 text-zinc-400">Solo el ganador de cada grupo pasa a la final.</p>}
      {preview.error ? <p role="alert" className="mt-2 text-amber-300">{preview.error}</p> : (
        <details className="mt-2 text-zinc-400">
          <summary className="cursor-pointer">Ver participantes{preview.tournament ? " y sorteo" : ""}</summary>
          {preview.tournament ? preview.tournament.rounds[0]?.heats.map((heat, i) => (
            <p key={heat.seed} className="mt-1"><strong>Grupo {i + 1}:</strong> {heat.countries.map(code => `${byCode.get(code)?.flag.emoji ?? ""} ${byCode.get(code)?.name ?? code}`).join(" · ")} <span className="block font-mono text-[10px] text-zinc-500">{heat.seed}</span></p>
          )) : <p className="mt-1">{preview.codes.map(code => `${byCode.get(code)?.flag.emoji ?? ""} ${byCode.get(code)?.name ?? code}`).join(" · ")}</p>}
        </details>
      )}
    </section>
  );
}
