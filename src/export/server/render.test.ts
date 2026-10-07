import { expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { DEFAULT_CONFIG } from "@/engine/defaults";
import { makeTestCountries } from "@/engine/testing";
import { AMERICAS_20 } from "@/countries/selection";
import { modeDefaults } from "@/modes";
import { runTournament } from "@/modes/tournament";
import { DEFAULT_DISPLAY } from "@/render/displayOptions";
import type { VideoExport } from "../types";
import { MAX_VIDEO_SECONDS, PART_SECONDS, VIDEO_FPS } from "../types";
import { createExport, deleteExport, readExport, saveExport, setExportPaused } from "./store";
import { renderVideoExport } from "./render";
import { monitorExportControl } from "./control";
import { command } from "../../../scripts/pipeline/media";

it("encodes a continuous 20-country tournament as ordered, decodable MP4 parts of at most 120 seconds", async () => {
  const root = await mkdtemp(join(tmpdir(), "bolworld-encoding-"));
  try {
    const flag = createCanvas(8, 4).toDataURL("image/png");
    const countries = makeTestCountries(20).map((c, i) => ({ ...c, cca3: AMERICAS_20[i]!, region: "Americas" as const, flag: { ...c.flag, png: flag } }));
    const config = { ...DEFAULT_CONFIG, ...modeDefaults("last-place-elimination"), seed: "america-20", countries: countries.map(c => c.cca3), tournament: { size: 20 as const } };
    const baseline = runTournament(config, { size: 20 }, countries);
    const video = await createExport({ config, display: { ...DEFAULT_DISPLAY, language: "es" } }, countries, root);
    const directory = join(root, video.id);
    // Real renderer, real physics, full simulated duration and FFmpeg. Only pixels are reduced.
    await renderVideoExport(video, countries, directory, { scale: 0.1 });
    expect(video.status).toBe("complete");
    expect(video.parts.length).toBeGreaterThan(1);
    expect(video.results).toEqual(baseline.outcomes.map(o => o.result));
    expect(video.fingerprint).toBe(baseline.fingerprint);
    expect(video.tournament?.champion).toBe(baseline.champion);
    expect(video.parts.reduce((total, part) => total + part.frames, 0)).toBe(video.frames);
    expect(video.parts.at(-1)!.end.tick / 60).toBeCloseTo(video.frames / VIDEO_FPS, 1);
    let foundMidHeatCut = false;
    for (const [i, part] of video.parts.entries()) {
      expect(part.number).toBe(i + 1);
      expect(part.frames).toBeLessThanOrEqual(PART_SECONDS * VIDEO_FPS);
      expect(part.duration).toBeLessThanOrEqual(MAX_VIDEO_SECONDS);
      expect(part.metadata?.title).toContain(`Parte ${i + 1}/${video.parts.length}`);
      if (i > 0) {
        const previous = video.parts[i - 1]!;
        expect(part.start).toEqual(previous.end);
        if (previous.start.heatSeed === previous.end.heatSeed && previous.end.heatTick > previous.start.heatTick) foundMidHeatCut = true;
      }
      const info = JSON.parse(await command("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name,nb_frames,width,height", "-of", "json", join(directory, part.file)]));
      expect(Number(info.format.duration)).toBeLessThanOrEqual(120);
      expect(info.streams.map((s: { codec_name: string }) => s.codec_name)).toEqual(["h264", "aac"]);
      expect(Number(info.streams[0].nb_frames)).toBe(part.frames);
      const text = JSON.parse(await readFile(join(directory, part.file.replace(/\.mp4$/, ".json")), "utf8"));
      expect(text.config).toEqual(config);
      expect(text.hashtags.length).toBeGreaterThan(0);
    }
    // A cut during a heat is also recognizable from the next part's positive heat tick.
    expect(foundMidHeatCut || video.parts.slice(1).some(part => part.start.heatTick > 0)).toBe(true);
    const manifest: VideoExport = JSON.parse(await readFile(join(directory, "metadata.json"), "utf8"));
    expect(manifest).toEqual(video);
    expect((await readdir(directory)).some(file => file.endsWith(".wav") || file.includes(".silent."))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 180_000);

async function shortExport(root: string) {
  const flag = createCanvas(8, 4).toDataURL("image/png");
  const countries = makeTestCountries(2).map(country => ({ ...country, flag: { ...country.flag, png: flag } }));
  const request = { config: { ...DEFAULT_CONFIG, seed: "pause-and-cancel", countries: countries.map(country => country.cca3), maxDuration: 1 }, display: DEFAULT_DISPLAY };
  const video = await createExport(request, countries, root);
  video.workerPid = process.pid;
  await saveExport(video, root);
  return { video, countries, request };
}

it("actually stops producing frames while paused, resumes the same timeline, and ends the recording", async () => {
  const root = await mkdtemp(join(tmpdir(), "bolworld-paused-"));
  const { video, countries, request } = await shortExport(root);
  const control = monitorExportControl(video.id, root);
  let pauseReached!: () => void;
  const paused = new Promise<void>(resolve => { pauseReached = resolve; });
  const rendering = renderVideoExport(video, countries, join(root, video.id), {
    scale: 0.1, signal: control.signal, checkpoint: control.checkpoint,
    progress: async value => {
      await saveExport(value, root);
      if (value.frames === 30 && value.status === "recording") {
        await setExportPaused(value.id, true, root);
        pauseReached();
      }
    },
  });
  void rendering.catch(() => {});
  try {
    await Promise.race([paused, rendering.then(() => { throw new Error("No se alcanzó la pausa."); })]);
    const frames = video.frames;
    await sleep(250);
    expect(video.frames).toBe(frames);
    expect((await readExport(video.id, root)).status).toBe("paused");
    await setExportPaused(video.id, false, root);
    await rendering;
    expect(video.status).toBe("complete");
    expect(video.workerPid).toBeUndefined();
    expect((await readExport(video.id, root)).status).toBe("complete");
    expect((await createExport(request, countries, root)).id).not.toBe(video.id);
  } finally {
    control.cancel();
    await rendering.catch(() => {});
    control.dispose();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

it("cancels a paused render, closes its encoder, deletes all parts, and immediately allows a new video", async () => {
  const root = await mkdtemp(join(tmpdir(), "bolworld-cancelled-"));
  const { video, countries, request } = await shortExport(root);
  const control = monitorExportControl(video.id, root);
  let pauseReached!: () => void;
  const paused = new Promise<void>(resolve => { pauseReached = resolve; });
  const rendering = renderVideoExport(video, countries, join(root, video.id), {
    scale: 0.1, signal: control.signal, checkpoint: control.checkpoint,
    progress: async value => {
      await saveExport(value, root);
      if (value.frames === 30) { await setExportPaused(value.id, true, root); pauseReached(); }
    },
  });
  const result = rendering.catch(error => error);
  try {
    await Promise.race([paused, rendering.then(() => { throw new Error("No se alcanzó la pausa."); })]);
    await deleteExport(video.id, async () => { await result; }, root);
    expect(await result).toBeInstanceOf(Error);
    await expect(readExport(video.id, root)).rejects.toThrow();
    await expect(saveExport(video, root)).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
    expect((await createExport(request, countries, root)).id).not.toBe(video.id);
  } finally {
    control.cancel();
    await result;
    control.dispose();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
