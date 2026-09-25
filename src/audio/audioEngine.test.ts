import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioEngine } from "./audioEngine";

/** Just enough of the Web Audio API to exercise scheduling logic. */
class FakeContext {
  static started = 0;
  currentTime = 0;
  sampleRate = 8000;
  state = "running";
  destination = {};
  private node() {
    const n = { connect: () => n, disconnect: () => {}, gain: { value: 1 }, pan: { value: 0 } };
    return n;
  }
  createGain() {
    return this.node();
  }
  createStereoPanner() {
    return this.node();
  }
  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    return { getChannelData: () => data, length };
  }
  createBufferSource() {
    const source = {
      ...this.node(),
      buffer: null as unknown,
      playbackRate: { value: 1 },
      onended: null as null | (() => void),
      start: () => {
        FakeContext.started++;
      },
    };
    return source;
  }
  resume = async () => {};
  suspend = async () => {};
  close = async () => {};
}

describe("AudioEngine", () => {
  let ctx: FakeContext;
  beforeEach(() => {
    FakeContext.started = 0;
    vi.stubGlobal("window", {});
    vi.stubGlobal(
      "AudioContext",
      class extends FakeContext {
        constructor() {
          super();
          // eslint-disable-next-line @typescript-eslint/no-this-alias
          ctx = this;
        }
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("synthesizes non-silent buffers", async () => {
    const audio = new AudioEngine();
    await audio.enable();
    const buffers = (audio as unknown as { buffers: Map<string, { getChannelData(): Float32Array }[]> }).buffers;
    for (const kind of ["impact", "bounce", "eliminate", "leader", "finish", "victory", "countdown", "go"]) {
      const data = buffers.get(kind)?.[0]?.getChannelData();
      expect(data && Math.max(...Array.from(data, Math.abs))).toBeGreaterThan(0.05);
    }
  });

  it("applies per-sound cooldowns", async () => {
    const audio = new AudioEngine();
    await audio.enable();
    for (let i = 0; i < 20; i++) audio.play("eliminate");
    expect(FakeContext.started).toBe(1);
    ctx.currentTime = 0.2;
    audio.play("eliminate");
    expect(FakeContext.started).toBe(2);
  });

  it("caps collision sounds per 100 ms window", async () => {
    const audio = new AudioEngine();
    await audio.enable();
    for (let i = 0; i < 40; i++) {
      ctx.currentTime = 0.5 + i * 0.002;
      audio.play(i % 2 ? "impact" : "bounce");
    }
    expect(FakeContext.started).toBeLessThanOrEqual(5);
    expect(FakeContext.started).toBeGreaterThan(1);
  });

  it("is silent when disabled", async () => {
    const audio = new AudioEngine();
    await audio.enable();
    audio.disable();
    audio.play("victory");
    expect(FakeContext.started).toBe(0);
  });
});
