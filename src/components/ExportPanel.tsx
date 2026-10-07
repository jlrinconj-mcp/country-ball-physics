"use client";

import { useEffect, useState } from "react";
import { exportFileUrl, localVideoExporter } from "@/export/client";
import type { VideoExport } from "@/export/types";
import type { Country } from "@/countries/countryTypes";
import { Bracket } from "./LivePanel";

function isFinished(video: VideoExport): boolean {
  return video.status === "complete" || video.status === "failed";
}

/** A completed server job must replace a stale recording snapshot from the runtime. */
export function reconcileExports(current: VideoExport | null, saved: VideoExport[]): VideoExport[] {
  if (!current) return saved;
  const stored = saved.find(video => video.id === current.id);
  const latest = stored && (isFinished(stored) || (stored.status === current.status && !isFinished(current) && (stored.parts.length > current.parts.length || stored.frames > current.frames)))
    ? stored
    : current;
  return [latest, ...saved.filter(video => video.id !== current.id)];
}

function FolderIcon({ className = "h-5 w-5" }: { className?: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M3 10h18" stroke="currentColor" strokeWidth="1.6" />
  </svg>;
}

const statusLabel: Record<VideoExport["status"], string> = {
  queued: "Preparando grabación",
  recording: "Grabando y guardando",
  paused: "Grabación pausada",
  complete: "Guardado",
  failed: "Grabación interrumpida",
};

export function ExportPanel({ current, countries, onPause, onDelete, finalizingId, controlsBusy = false }: {
  current: VideoExport | null;
  countries: Map<string, Country>;
  onPause: (paused: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  finalizingId?: string | null;
  controlsBusy?: boolean;
}) {
  const [saved, setSaved] = useState<VideoExport[]>([]);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: string; action: "pause" | "delete" } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const response = await fetch("/api/exports", { signal: abort.signal, cache: "no-store" });
        if (!response.ok) throw new Error("No se pudo cargar la carpeta de videos.");
        const videos: VideoExport[] = await response.json();
        if (abort.signal.aborted) return;
        setSaved(videos);
        setListError(null);
      } catch (reason) {
        if (!abort.signal.aborted) setListError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        // Keep discovering recordings even after the last visible job finishes.
        if (!abort.signal.aborted) timer = setTimeout(refresh, 3000);
      }
    };
    void refresh();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [current?.id, current?.status, refreshKey]);

  const pause = async (video: VideoExport) => {
    setPending({ id: video.id, action: "pause" });
    setActionError(null);
    try {
      const paused = video.status !== "paused";
      if (video.id === current?.id) {
        await onPause(paused);
      } else {
        const updated = await localVideoExporter.setPaused(video.id, paused);
        setSaved(videos => videos.map(item => item.id === updated.id ? updated : item));
      }
      setRefreshKey(value => value + 1);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "No se pudo cambiar la pausa de la grabación.");
    } finally {
      setPending(null);
    }
  };

  const remove = async (video: VideoExport) => {
    setPending({ id: video.id, action: "delete" });
    setActionError(null);
    try {
      await onDelete(video.id);
      setDeletedIds(ids => new Set(ids).add(video.id));
      setSaved(videos => videos.filter(item => item.id !== video.id));
      setRefreshKey(value => value + 1);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "No se pudo eliminar el video.");
    } finally {
      setPending(null);
    }
  };

  const videos = reconcileExports(current, saved).filter(video => !deletedIds.has(video.id));
  return (
    <section id="video-library" tabIndex={-1} aria-labelledby="video-library-title" className="border-b border-white/[0.06] px-4 py-4 outline-none">
      <div className="flex items-center gap-2.5">
        <span className="rounded-lg bg-amber-400/10 p-2 text-amber-300"><FolderIcon /></span>
        <div className="min-w-0 flex-1">
          <h2 id="video-library-title" tabIndex={-1} className="text-sm font-semibold outline-none focus-visible:text-amber-300">Mis videos</h2>
          <p className="mt-0.5 text-[11px] text-zinc-500">{videos.length} {videos.length === 1 ? "carpeta" : "carpetas"} · guardadas en este equipo</p>
        </div>
      </div>
      <p className="mt-3 rounded-md bg-zinc-900 px-2.5 py-2 text-[11px] text-zinc-400">Carpeta local: <code className="text-amber-200/80">output/manual</code></p>
      <p className="mt-2 text-xs leading-relaxed text-zinc-500">Abre una carpeta para ver, reproducir o descargar sus partes y metadatos.</p>
      {(listError || actionError) && <p role="alert" className="mt-2 text-xs text-red-300">{actionError || listError}</p>}
      {videos.length === 0 && <p className="mt-3 rounded-lg border border-dashed border-white/10 p-3 text-xs leading-relaxed text-zinc-400">Tu carpeta está vacía. Revisa la vista previa y pulsa Grabar cuando esté lista.</p>}
      <div className="mt-3 space-y-3">
        {videos.map(video => {
          const active = !isFinished(video);
          const title = video.metadata?.title ?? video.request.config.seed;
          const deleting = pending?.id === video.id && pending.action === "delete";
          const pausing = pending?.id === video.id && pending.action === "pause";
          const finalizing = finalizingId === video.id && video.status === "recording";
          return (
            <details key={video.id} open={current?.id === video.id || undefined} className="group rounded-lg border border-white/[0.06] bg-zinc-900 text-xs">
              <summary className="cursor-pointer list-none p-3 [&::-webkit-details-marker]:hidden">
                <div className="flex items-start gap-2.5">
                  <FolderIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                  <div className="min-w-0 flex-1">
                    <h3 className="break-words font-medium text-zinc-100">{title}</h3>
                    <p aria-live="polite" className={`mt-1 ${video.status === "complete" ? "text-emerald-300" : video.status === "failed" ? "text-red-300" : "text-amber-200/80"}`}>{finalizing ? "Guardando archivo final" : statusLabel[video.status]}</p>
                    <p className="mt-1 text-[11px] text-zinc-500">{video.parts.length} {video.parts.length === 1 ? "parte" : "partes"} · {(video.frames / 30).toFixed(1)} s</p>
                  </div>
                  <span aria-hidden="true" className="text-zinc-500 transition-transform group-open:rotate-90">›</span>
                </div>
                <span className="mt-2 block text-[11px] text-zinc-400 group-open:hidden">Abrir carpeta</span>
                <span className="mt-2 hidden text-[11px] text-zinc-400 group-open:block">Cerrar carpeta</span>
              </summary>
              <div className="border-t border-white/[0.06] p-3">
                <p className="mb-3 break-words text-[11px] text-zinc-500">Mis videos / <span className="text-zinc-300">{video.request.config.seed}</span></p>
                <div className="mb-3 flex flex-wrap gap-2">
                  {active && <button type="button" disabled={pending !== null || controlsBusy} onClick={() => void pause(video)} className="rounded-md bg-zinc-800 px-2.5 py-2 font-medium text-amber-200 ring-1 ring-white/10 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40">{pausing ? "Actualizando…" : video.status === "paused" ? "Reanudar grabación" : "Pausar grabación"}</button>}
                  <button type="button" disabled={pending !== null || controlsBusy} onClick={() => void remove(video)} className="rounded-md px-2.5 py-2 text-red-300 ring-1 ring-red-400/20 hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-40">{deleting ? "Eliminando…" : active ? "Eliminar grabación" : "Eliminar video"}</button>
                </div>
                {video.error && <p className="mb-3 text-red-300">{video.error}</p>}
                {active && <p className="mb-3 leading-relaxed text-zinc-400">{video.status === "paused" ? "La creación está en pausa. Reanuda para continuar o elimina la grabación." : finalizing ? "La simulación terminó. Se está guardando el MP4 final." : "Puedes pausar o eliminar la grabación mientras se crea."} {video.parts.length > 0 ? "Las partes guardadas ya se pueden reproducir." : "La primera parte aparecerá cuando termine de guardarse."}</p>}
                <ol className="space-y-3">
                  {video.parts.map(part => (
                    <li key={part.number} className="rounded-lg bg-zinc-950/70 p-2.5">
                      <p className="mb-2 flex items-center justify-between gap-2 font-medium text-zinc-200"><span>Parte {String(part.number).padStart(2, "0")}</span><span className="font-mono text-[11px] text-zinc-500">{part.duration.toFixed(1)} s</span></p>
                      <video controls playsInline preload="metadata" src={`${exportFileUrl(video.id, part.file)}?preview=1`} aria-label={`Reproducir parte ${part.number} de ${title}`} className="max-h-72 w-full rounded-md bg-black" />
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-2">
                        <a className="text-amber-300 underline underline-offset-2" href={exportFileUrl(video.id, part.file)} download>Descargar MP4</a>
                        {part.metadata && <a className="text-zinc-400 underline underline-offset-2" href={exportFileUrl(video.id, part.file.replace(/\.mp4$/, ".json"))} download>Metadatos de la parte</a>}
                      </div>
                    </li>
                  ))}
                </ol>
                {video.metadata && (
                  <>
                    <a className="mt-3 block text-amber-300 underline underline-offset-2" href={exportFileUrl(video.id, "metadata.json")} download>Descargar metadatos JSON</a>
                    <details className="mt-3 text-zinc-300">
                      <summary className="cursor-pointer">Título, descripción y hashtags</summary>
                      <p className="mt-2 whitespace-pre-wrap">{video.metadata.description}</p>
                      <p className="mt-2">{video.metadata.caption}</p>
                      <p className="mt-2">{video.metadata.hashtags.map(tag => `#${tag}`).join(" ")}</p>
                    </details>
                  </>
                )}
                {video.tournament && <details className="mt-3 text-zinc-300">
                  <summary className="cursor-pointer">Sorteo y resultados guardados</summary>
                  <Bracket summary={video.tournament} countries={countries} />
                </details>}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
