import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "@/engine/defaults";
import { TICK_RATE } from "@/engine/physicsWorld";
import { makeTestCountries } from "@/engine/testing";
import { DEFAULT_DISPLAY } from "@/render/displayOptions";
import type { VideoExport, VideoExportAdapter } from "@/export/types";
import { VideoExportNotFoundError } from "@/export/client";
import { SimulationController } from "./SimulationController";
import { FlagAtlas } from "@/render/flagAtlas";

vi.mock("@/render/flagAtlas", () => ({ FlagAtlas: class {
  async preload(countries: unknown[]) { return { loaded: countries.length, failed: 0 }; }
} }));
vi.mock("@/render/canvasRenderer", () => ({ CanvasRenderer: class {
  render() {}
  renderLobby() {}
} }));

const countries = makeTestCountries(3);
const config = { ...DEFAULT_CONFIG, seed: "play-from-draft", countries: countries.map(c => c.cca3), maxParticipants: 3 };
const video: VideoExport = { id: "fixture", createdAt: "2026-10-02", request: { config, display: DEFAULT_DISPLAY }, status: "recording", frames: 0, parts: [], results: [], tournament: null, metadata: null, fingerprint: null, error: null };
function adapter(): VideoExportAdapter {
  return {
    create: vi.fn(async () => video),
    get: vi.fn(() => new Promise<VideoExport>(() => {})),
    setPaused: vi.fn(async (_id: string, paused: boolean): Promise<VideoExport> => ({ ...video, status: paused ? "paused" : "recording" })),
    delete: vi.fn(async () => {}),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Deliver real loop frames without needing a browser or canvas implementation. */
function attachFrames(controller: SimulationController) {
  let callback: FrameRequestCallback | null = null;
  let time = performance.now();
  vi.spyOn(performance, "now").mockImplementation(() => time);
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  vi.stubGlobal("getComputedStyle", () => ({ fontFamily: "sans-serif" }));
  vi.stubGlobal("requestAnimationFrame", (next: FrameRequestCallback) => { callback = next; return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => { callback = null; });
  controller.attach({ clientWidth: 360, width: 360, height: 640 } as HTMLCanvasElement);
  return (milliseconds: number) => {
    time += milliseconds;
    const next = callback;
    callback = null;
    next?.(time);
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Play and recording", () => {
  it("keeps a configured preview paused and never exports on load", async () => {
    const exporter = adapter(), controller = new SimulationController(exporter);
    await controller.load(config, countries, true);
    expect(controller.getSnapshot()).toMatchObject({ time: 0, paused: true, recording: false });
    expect(exporter.create).not.toHaveBeenCalled();
    controller.dispose();
  });
  it("animates a preview, supports local pause, and never creates an export", async () => {
    const exporter = adapter(), controller = new SimulationController(exporter);
    const frame = attachFrames(controller);
    await controller.preview(config, countries);
    frame(250);
    expect(controller.simulation!.tick).toBeGreaterThan(0);
    await controller.setPaused(true);
    const tick = controller.simulation!.tick;
    frame(250);
    expect(controller.simulation!.tick).toBe(tick);
    expect(controller.getSnapshot()).toMatchObject({ paused: true, recording: false });
    expect(exporter.create).not.toHaveBeenCalled();
    expect(exporter.setPaused).not.toHaveBeenCalled();
    controller.dispose();
  });
  it("commits current configuration and starts one recording on Play", async () => {
    const exporter = adapter(), controller = new SimulationController(exporter);
    const draft = { ...config, seed: "my-seed", physics: { ...config.physics, restitution: 0.75 } };
    await Promise.all([controller.playAndRecord(draft, countries), controller.playAndRecord(draft, countries)]);
    expect(exporter.create).toHaveBeenCalledExactlyOnceWith({ config: draft, display: DEFAULT_DISPLAY });
    expect(controller.getSnapshot()).toMatchObject({ paused: false, recording: true, config: draft, videoExport: video });
    expect(controller.simulation?.tick).toBe(0);
    controller.dispose();
  });
  it("keeps the recording lock while loading and ignores a duplicate start", async () => {
    const flags = deferred<{ loaded: number; failed: number }>();
    const preload = vi.spyOn(FlagAtlas.prototype, "preload").mockImplementationOnce(() => flags.promise);
    const exporter = adapter(), controller = new SimulationController(exporter);
    try {
      const first = controller.playAndRecord(config, countries);
      expect(controller.getSnapshot()).toMatchObject({ phase: "loading", paused: true, recording: true });
      await controller.playAndRecord(config, countries);
      flags.resolve({ loaded: countries.length, failed: 0 });
      await first;
      expect(exporter.create).toHaveBeenCalledTimes(1);
    } finally {
      controller.dispose(); preload.mockRestore();
    }
  });
  it("stops the previous simulation while a new draft loads", async () => {
    const exporter = adapter(), controller = new SimulationController(exporter);
    const frame = attachFrames(controller);
    await controller.preview(config, countries);
    frame(250);
    const old = controller.simulation!;
    const tick = old.tick;
    const flags = deferred<{ loaded: number; failed: number }>();
    const preload = vi.spyOn(FlagAtlas.prototype, "preload").mockImplementationOnce(() => flags.promise);
    try {
      const loading = controller.load({ ...config, seed: "new-draft" }, countries, true);
      frame(1000);
      expect(old.tick).toBe(tick);
      expect(controller.simulation).toBeNull();
      expect(controller.getSnapshot().phase).toBe("loading");
      flags.resolve({ loaded: countries.length, failed: 0 });
      await loading;
      expect(controller.getSnapshot()).toMatchObject({ time: 0, paused: true, config: { seed: "new-draft" } });
    } finally {
      controller.dispose(); preload.mockRestore();
    }
  });
  it("ignores failure from a superseded draft load", async () => {
    const flags = deferred<{ loaded: number; failed: number }>();
    const preload = vi.spyOn(FlagAtlas.prototype, "preload").mockImplementationOnce(() => flags.promise);
    const controller = new SimulationController(adapter());
    try {
      const stale = controller.load(config, countries);
      await controller.load({ ...config, seed: "latest" }, countries, true);
      flags.reject(new Error("Old flags unavailable"));
      await stale;
      expect(controller.getSnapshot()).toMatchObject({ phase: "running", paused: true, config: { seed: "latest" }, error: null });
    } finally {
      controller.dispose(); preload.mockRestore();
    }
  });
  it("pauses and resumes the encoder as well as the simulation", async () => {
    const exporter = adapter(), controller = new SimulationController(exporter);
    const frame = attachFrames(controller);
    await controller.playAndRecord(config, countries);
    await controller.setPaused(true);
    const tick = controller.simulation!.tick;
    frame(1000);
    expect(controller.simulation!.tick).toBe(tick);
    expect(exporter.setPaused).toHaveBeenCalledWith(video.id, true);
    expect(controller.getSnapshot()).toMatchObject({ recording: true, paused: true, videoExport: { status: "paused" } });
    await controller.setPaused(false);
    frame(250);
    expect(controller.simulation!.tick).toBeGreaterThan(tick);
    expect(exporter.setPaused).toHaveBeenCalledWith(video.id, false);
    expect(controller.getSnapshot()).toMatchObject({ recording: true, paused: false, videoExport: { status: "recording" } });
    controller.dispose();
  });
  it("rolls back a failed pause and allows retrying it", async () => {
    const exporter = adapter(), controller = new SimulationController(exporter);
    vi.mocked(exporter.setPaused).mockRejectedValueOnce(new Error("Pause failed"));
    await controller.playAndRecord(config, countries);
    await expect(controller.setPaused(true)).rejects.toThrow("Pause failed");
    expect(controller.getSnapshot()).toMatchObject({ paused: false, recording: true, error: "Pause failed" });
    await controller.setPaused(true);
    expect(controller.getSnapshot()).toMatchObject({ paused: true, recording: true, error: null });
    controller.dispose();
  });
  it("does not let a poll started before a pause undo that pause", async () => {
    vi.useFakeTimers();
    const poll = deferred<VideoExport>();
    const exporter = adapter(), controller = new SimulationController(exporter);
    vi.mocked(exporter.get).mockImplementationOnce(() => poll.promise);
    await controller.playAndRecord(config, countries);
    await controller.setPaused(true);
    poll.resolve(video);
    await Promise.resolve();
    expect(controller.getSnapshot()).toMatchObject({ paused: true, recording: true, videoExport: { status: "paused" } });
    controller.dispose();
  });
  it.each([true, false])("restores acknowledged server state after queued pause/resume failures (first succeeds: %s)", async firstSucceeds => {
    const exporter = adapter(), controller = new SimulationController(exporter);
    if (firstSucceeds) vi.mocked(exporter.setPaused).mockResolvedValueOnce({ ...video, status: "paused" });
    else vi.mocked(exporter.setPaused).mockRejectedValueOnce(new Error("First failed"));
    vi.mocked(exporter.setPaused).mockRejectedValueOnce(new Error("Resume failed"));
    await controller.playAndRecord(config, countries);
    const first = controller.setPaused(true);
    const second = controller.setPaused(false);
    await first;
    await expect(second).rejects.toThrow("Resume failed");
    expect(controller.getSnapshot()).toMatchObject({ paused: firstSucceeds, recording: true, videoExport: { status: firstSucceeds ? "paused" : "recording" } });
    controller.dispose();
  });
  it("deletes an active job and ignores its late polling response", async () => {
    const poll = deferred<VideoExport>();
    const exporter = adapter(), controller = new SimulationController(exporter);
    vi.mocked(exporter.get).mockImplementationOnce(() => poll.promise);
    await controller.playAndRecord(config, countries);
    await controller.deleteRecording();
    expect(exporter.delete).toHaveBeenCalledExactlyOnceWith(video.id);
    expect(controller.getSnapshot()).toMatchObject({ time: 0, paused: true, recording: false, videoExport: null });
    poll.resolve(video);
    await Promise.resolve();
    expect(controller.getSnapshot()).toMatchObject({ paused: true, recording: false, videoExport: null });
    controller.dispose();
  });
  it("unlocks editing and stops polling when another window deletes the current recording", async () => {
    vi.useFakeTimers();
    const exporter = adapter(), controller = new SimulationController(exporter);
    const frame = attachFrames(controller);
    const poll = deferred<VideoExport>();
    vi.mocked(exporter.get).mockImplementationOnce(() => poll.promise);
    await controller.playAndRecord(config, countries);
    frame(250);
    const tick = controller.simulation!.tick;
    poll.reject(new VideoExportNotFoundError("Video no encontrado"));
    await Promise.resolve();
    expect(controller.getSnapshot()).toMatchObject({ recording: false, paused: true, videoExport: null });
    expect(controller.getSnapshot().error).toContain("eliminada desde otra ventana");
    frame(1000);
    expect(controller.simulation!.tick).toBe(tick);
    await vi.advanceTimersByTimeAsync(5000);
    expect(exporter.get).toHaveBeenCalledTimes(1);
    await controller.preview(config, countries);
    expect(controller.getSnapshot()).toMatchObject({ recording: false, paused: false, error: null });
    controller.dispose();
  });
  it("clears a missing job even when its disappearance is detected by a pause request", async () => {
    const exporter = adapter(), controller = new SimulationController(exporter);
    vi.mocked(exporter.setPaused).mockRejectedValueOnce(new VideoExportNotFoundError("Video no encontrado"));
    await controller.playAndRecord(config, countries);
    await expect(controller.setPaused(true)).rejects.toBeInstanceOf(VideoExportNotFoundError);
    expect(controller.getSnapshot()).toMatchObject({ recording: false, paused: true, videoExport: null });
    expect(controller.getSnapshot().error).toContain("eliminada desde otra ventana");
    await controller.playAndRecord(config, countries);
    expect(exporter.create).toHaveBeenCalledTimes(2);
    controller.dispose();
  });
  it("treats a delete 404 as an already removed job and allows a new recording", async () => {
    const exporter = adapter(), controller = new SimulationController(exporter);
    vi.mocked(exporter.delete).mockRejectedValueOnce(new VideoExportNotFoundError("Video no encontrado"));
    await controller.playAndRecord(config, countries);
    await controller.deleteRecording();
    expect(controller.getSnapshot()).toMatchObject({ recording: false, paused: true, videoExport: null });
    await controller.playAndRecord(config, countries);
    expect(exporter.create).toHaveBeenCalledTimes(2);
    controller.dispose();
  });
  it("continues polling after a temporary server error", async () => {
    vi.useFakeTimers();
    const exporter = adapter(), controller = new SimulationController(exporter);
    vi.mocked(exporter.get).mockRejectedValueOnce(new Error("Servidor no disponible"));
    await controller.playAndRecord(config, countries);
    expect(controller.getSnapshot()).toMatchObject({ recording: true, videoExport: video });
    await vi.advanceTimersByTimeAsync(1000);
    expect(exporter.get).toHaveBeenCalledTimes(2);
    controller.dispose();
  });
  it("cancels during flag loading without creating a video", async () => {
    const flags = deferred<{ loaded: number; failed: number }>();
    const preload = vi.spyOn(FlagAtlas.prototype, "preload").mockImplementationOnce(() => flags.promise);
    const exporter = adapter(), controller = new SimulationController(exporter);
    try {
      const starting = controller.playAndRecord(config, countries);
      await controller.deleteRecording();
      flags.resolve({ loaded: countries.length, failed: 0 });
      await starting;
      expect(exporter.create).not.toHaveBeenCalled();
      expect(controller.getSnapshot()).toMatchObject({ time: 0, paused: true, recording: false, videoExport: null });
    } finally {
      controller.dispose(); preload.mockRestore();
    }
  });
  it("deletes a job whose create response arrives after cancellation", async () => {
    const creation = deferred<VideoExport>();
    const exporter = adapter(), controller = new SimulationController(exporter);
    vi.mocked(exporter.create).mockImplementationOnce(() => creation.promise);
    const starting = controller.playAndRecord(config, countries);
    await vi.waitFor(() => expect(exporter.create).toHaveBeenCalledTimes(1));
    const deleting = controller.deleteRecording();
    creation.resolve(video);
    await Promise.all([starting, deleting]);
    expect(exporter.delete).toHaveBeenCalledExactlyOnceWith(video.id);
    expect(exporter.get).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({ time: 0, paused: true, recording: false, videoExport: null });
    controller.dispose();
  });
  it("retains the active job and its monitor if deletion fails", async () => {
    const exporter = adapter(), controller = new SimulationController(exporter);
    vi.mocked(exporter.delete).mockRejectedValueOnce(new Error("Delete failed"));
    await controller.playAndRecord(config, countries);
    await expect(controller.deleteRecording()).rejects.toThrow("Delete failed");
    expect(controller.getSnapshot()).toMatchObject({ recording: true, paused: false, videoExport: video, error: "Delete failed" });
    await controller.deleteRecording();
    expect(controller.getSnapshot()).toMatchObject({ recording: false, videoExport: null, error: null });
    controller.dispose();
  });
  it.each(["complete", "failed"] as const)("unlocks editing and stops canvas ticks when the encoder reports %s", async status => {
    const poll = deferred<VideoExport>();
    const exporter = adapter(), controller = new SimulationController(exporter);
    const frame = attachFrames(controller);
    vi.mocked(exporter.get).mockImplementationOnce(() => poll.promise);
    await controller.playAndRecord(config, countries);
    frame(250);
    const tick = controller.simulation!.tick;
    poll.resolve({ ...video, status, error: status === "failed" ? "Encoder failed" : null });
    await Promise.resolve();
    expect(controller.getSnapshot()).toMatchObject({ phase: status === "complete" ? "finished" : "error", paused: true, recording: false, videoExport: { status } });
    await controller.setPaused(false);
    frame(1000);
    expect(controller.simulation!.tick).toBe(tick);
    controller.setDisplay({ ...DEFAULT_DISPLAY, speed: 2 });
    await controller.preview(config, countries);
    expect(controller.getSnapshot().videoExport).toBeNull();
    frame(250);
    expect(controller.simulation!.tick).toBeGreaterThan(20);
    controller.dispose();
  });
  it("stops after the winner outro while the server still finalizes the export", async () => {
    const exporter = adapter(), controller = new SimulationController(exporter);
    const frame = attachFrames(controller);
    await controller.playAndRecord(config, countries);
    const simulation = controller.simulation!;
    simulation.declareWinner(simulation.balls[0]);
    for (let index = 0; index < 9; index++) frame(1000);
    expect(simulation.tick).toBe(6 * TICK_RATE);
    expect(controller.getSnapshot()).toMatchObject({ phase: "finished", paused: true, recording: true });
    frame(1000);
    expect(simulation.tick).toBe(6 * TICK_RATE);
    await controller.setPaused(false);
    frame(1000);
    expect(simulation.tick).toBe(6 * TICK_RATE);
    expect(controller.getSnapshot().paused).toBe(true);
    controller.dispose();
  });
  it("clears the current reference when its video is deleted from the folder", async () => {
    const poll = deferred<VideoExport>();
    const exporter = adapter(), controller = new SimulationController(exporter);
    vi.mocked(exporter.get).mockImplementationOnce(() => poll.promise);
    await controller.playAndRecord(config, countries);
    controller.forgetExport("another-video");
    expect(controller.getSnapshot().videoExport).toBe(video);
    controller.forgetExport(video.id);
    poll.resolve(video);
    await Promise.resolve();
    expect(controller.getSnapshot()).toMatchObject({ paused: true, recording: false, videoExport: null });
    controller.dispose();
  });
  it("shows an export failure and leaves the simulation paused", async () => {
    const exporter = adapter();
    vi.mocked(exporter.create).mockRejectedValue(new Error("FFmpeg unavailable"));
    const controller = new SimulationController(exporter);
    await controller.playAndRecord(config, countries);
    expect(controller.getSnapshot()).toMatchObject({ paused: true, recording: false, error: "FFmpeg unavailable" });
    controller.dispose();
  });
  it("rejects invalid selections before calling the exporter", async () => {
    const exporter = adapter(), controller = new SimulationController(exporter);
    await controller.playAndRecord({ ...config, countries: [] }, countries);
    expect(exporter.create).not.toHaveBeenCalled();
    expect(controller.getSnapshot().error).toMatch(/dos países/);
    controller.dispose();
  });
  it("allows choosing a preview with pending flags but never records placeholders", async () => {
    const preload = vi.spyOn(FlagAtlas.prototype, "preload").mockResolvedValue({ loaded: 1, failed: 2 });
    const exporter = adapter(), controller = new SimulationController(exporter);
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await controller.load(config, countries, true);
      expect(controller.getSnapshot()).toMatchObject({ paused: true, phase: "running", time: 0 });
      await controller.playAndRecord(config, countries);
      expect(exporter.create).not.toHaveBeenCalled();
      expect(controller.getSnapshot()).toMatchObject({ recording: false, error: "No se cargaron todas las banderas. Reintenta cuando estén disponibles." });
    } finally {
      controller.dispose(); preload.mockRestore(); diagnostic.mockRestore();
    }
  });
});
