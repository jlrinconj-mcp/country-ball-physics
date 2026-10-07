import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { makeTestCountries } from "@/engine/testing";
import { DEFAULT_CONFIG } from "@/engine/defaults";
import { modeDefaults } from "@/modes";
import { DEFAULT_DISPLAY } from "@/render/displayOptions";
import { RecordingTimeline } from "@/export/timeline";
import type { VideoExport } from "@/export/types";
import { ExportPanel, reconcileExports } from "./ExportPanel";

const noAction = async () => {};

function makeVideo(overrides: Partial<VideoExport> = {}): VideoExport {
  return {
    id: "video-folder", createdAt: "2026-10-02", request: { config: DEFAULT_CONFIG, display: DEFAULT_DISPLAY },
    status: "recording", frames: 300, parts: [], metadata: null, results: [], tournament: null,
    fingerprint: null, error: null, ...overrides,
  };
}

function renderVideo(video: VideoExport | null): string {
  return renderToStaticMarkup(createElement(ExportPanel, { current: video, countries: new Map(), onPause: noAction, onDelete: noAction }));
}

it("puts finished parts in a visible folder with in-app playback and a separate download", () => {
  const video = makeVideo({ parts: [{
    number: 1, file: "part-01.mp4", frames: 300, duration: 10,
    start: { tick: 0, heatSeed: "preview-seed", heatTick: 0 },
    end: { tick: 600, heatSeed: "preview-seed", heatTick: 600 },
  }] });
  const html = renderVideo(video);
  expect(html).toContain('id="video-library"');
  expect(html).toContain('id="video-library-title" tabindex="-1"');
  expect(html).toContain("Mis videos");
  expect(html).toContain("output/manual");
  expect(html).toContain("1 carpeta");
  expect(html).toContain("<video controls=\"\"");
  expect(html).toContain('preload="metadata"');
  expect(html).toContain('src="/api/exports/video-folder/files/part-01.mp4?preview=1"');
  expect(html).toContain('href="/api/exports/video-folder/files/part-01.mp4" download=""');
  expect(html).toContain("Las partes guardadas ya se pueden reproducir");
  expect(html).toContain("Pausar grabación");
  expect(html).toContain("Eliminar grabación");
});

it("distinguishes preparation, pause, completion and an empty folder", () => {
  expect(renderVideo(makeVideo({ status: "queued", frames: 0 }))).toContain("Preparando grabación");
  const paused = renderVideo(makeVideo({ status: "paused" }));
  expect(paused).toContain("Grabación pausada");
  expect(paused).toContain("Reanudar grabación");
  const complete = renderVideo(makeVideo({ status: "complete" }));
  expect(complete).toContain("Guardado");
  expect(complete).toContain("Eliminar video");
  expect(complete).not.toContain("Pausar grabación");
  expect(renderVideo(null)).toContain("Tu carpeta está vacía");
});

it("explains when the simulation ended and the encoder is saving the final file", () => {
  const html = renderToStaticMarkup(createElement(ExportPanel, {
    current: makeVideo(), countries: new Map(), onPause: noAction, onDelete: noAction, finalizingId: "video-folder",
  }));
  expect(html).toContain("Guardando archivo final");
  expect(html).toContain("La simulación terminó. Se está guardando el MP4 final.");
  expect(html).not.toContain("Grabando y guardando");
});

it("keeps the server's finished export when the runtime still says recording", () => {
  const stale = makeVideo();
  const complete = makeVideo({ status: "complete", frames: 600 });
  const other = makeVideo({ id: "other", status: "paused" });
  expect(reconcileExports(stale, [complete, other])).toEqual([complete, other]);
  const failed = makeVideo({ status: "failed", error: "Encoder detenido" });
  expect(reconcileExports(stale, [failed])).toEqual([failed]);
});

it("keeps a fresh current pause and completed state over a stale active list", () => {
  const stored = makeVideo();
  const paused = makeVideo({ status: "paused" });
  expect(reconcileExports(paused, [stored])).toEqual([paused]);
  expect(reconcileExports(paused, [{ ...stored, frames: paused.frames + 30 }])).toEqual([paused]);
  expect(reconcileExports(stored, [{ ...paused, frames: stored.frames + 30 }])).toEqual([stored]);
  const complete = makeVideo({ status: "complete", frames: 120 });
  expect(reconcileExports(complete, [stored])).toEqual([complete]);
});

it("shows saved tournament seeds, order and results independently of the current preview", () => {
  const countries = makeTestCountries(20);
  const config = { ...DEFAULT_CONFIG, ...modeDefaults("last-place-elimination"), seed: "saved-tournament", countries: countries.map(c => c.cca3), tournament: { size: 20 as const } };
  const timeline = new RecordingTimeline(config, countries);
  try {
    while (!timeline.done) timeline.advance(60);
    const video: VideoExport = {
      id: "saved", createdAt: "2026-10-02", request: { config, display: DEFAULT_DISPLAY }, status: "complete",
      frames: timeline.tick / 2, parts: [], metadata: null, results: timeline.results,
      tournament: timeline.tournament!.summary(), fingerprint: null, error: null,
    };
    const html = renderToStaticMarkup(createElement(ExportPanel, { current: video, countries: new Map(countries.map(c => [c.cca3, c])), onPause: noAction, onDelete: noAction }));
    expect(html).toContain("Sorteo y resultados guardados");
    expect(html).toContain("Campeón");
    expect(html).toContain(timeline.results.at(-1)!.winner.name);
    for (const result of timeline.results) expect(html).toContain(result.fingerprint);
    const seeds = [1, 2, 3, 4].map(i => `saved-tournament/r1-h${i}`).concat("saved-tournament/r2-h1");
    const positions = seeds.map(seed => html.indexOf(seed));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  } finally {
    timeline.dispose();
  }
});
