import { createRandom } from "@/engine/random";
import type { Simulation } from "@/engine/simulation";

export type SoundKind =
  | "impact"
  | "bounce"
  | "bumper"
  | "eliminate"
  | "leader"
  | "finish"
  | "victory"
  | "countdown"
  | "go";

interface PlayOptions {
  /** 0..1, scales loudness (and pitch slightly for impacts). */
  intensity?: number;
  /** -1 (left) … 1 (right). */
  pan?: number;
}

/** Minimum seconds between two plays of the same sound. */
const COOLDOWN: Record<SoundKind, number> = {
  impact: 0.03,
  bounce: 0.045,
  bumper: 0.06,
  eliminate: 0.07,
  leader: 0.5,
  finish: 0.12,
  victory: 2,
  countdown: 0.4,
  go: 0.4,
};

const MAX_VOICES = 12;
/** Collision sounds allowed per 100 ms window, however many contacts happen. */
const IMPACT_BUDGET = 5;

/**
 * Small Web Audio sound engine. Sounds are synthesized once into buffers (no
 * assets to license); playback is rate-limited so hundreds of contacts per
 * second become a pleasant patter instead of noise.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<SoundKind, AudioBuffer[]>();
  private readonly lastPlayed = new Map<SoundKind, number>();
  private voices = 0;
  private streamDestination: MediaStreamAudioDestinationNode | null = null;
  private windowStart = 0;
  private windowCount = 0;
  private volume = 0.6;
  enabled = false;

  /** Must be called after a user gesture (browser autoplay rules). */
  async enable(): Promise<void> {
    if (typeof window === "undefined" || typeof AudioContext === "undefined") return;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.synthesizeAll();
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.enabled = true;
  }

  /** Audio as a MediaStream (for recording). Null until enabled. */
  stream(): MediaStream | null {
    if (!this.ctx || !this.master) return null;
    this.streamDestination ??= this.ctx.createMediaStreamDestination();
    this.master.connect(this.streamDestination);
    return this.streamDestination.stream;
  }

  disable(): void {
    this.enabled = false;
    void this.ctx?.suspend();
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.master) this.master.gain.value = volume;
  }

  play(kind: SoundKind, options: PlayOptions = {}): void {
    const ctx = this.ctx;
    if (!this.enabled || !ctx || !this.master || this.voices >= MAX_VOICES) return;
    const now = ctx.currentTime;
    if (now - (this.lastPlayed.get(kind) ?? -1) < COOLDOWN[kind]) return;
    if (kind === "impact" || kind === "bounce" || kind === "bumper") {
      if (now - this.windowStart > 0.1) {
        this.windowStart = now;
        this.windowCount = 0;
      }
      if (this.windowCount >= IMPACT_BUDGET) return;
      this.windowCount++;
    }
    const variants = this.buffers.get(kind);
    if (!variants?.length) return;
    this.lastPlayed.set(kind, now);

    const intensity = Math.min(1, Math.max(0.05, options.intensity ?? 1));
    const source = ctx.createBufferSource();
    source.buffer = variants[Math.floor(Math.random() * variants.length)] ?? null;
    if (kind === "impact") source.playbackRate.value = 0.85 + intensity * 0.4;
    const gain = ctx.createGain();
    gain.gain.value = kind === "impact" || kind === "bounce" ? intensity * 0.55 : intensity;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.min(1, Math.max(-1, options.pan ?? 0));
    source.connect(gain).connect(panner).connect(this.master);
    this.voices++;
    source.onended = () => {
      this.voices--;
      source.disconnect();
    };
    source.start();
  }

  /**
   * Map simulation events to sounds. `panOf` converts a world x to stereo pan
   * (the camera knows what's on screen). Returns an unsubscribe function.
   */
  attach(sim: Simulation, panOf: (x: number) => number): () => void {
    const offs = [
      sim.events.on("impact", ({ x, intensity, kind }) =>
        this.play(kind === "ball" ? "impact" : kind === "bumper" ? "bumper" : "bounce", { intensity, pan: panOf(x) }),
      ),
      sim.events.on("countryEliminated", ({ ball }) => this.play("eliminate", { pan: panOf(ball.x) })),
      sim.events.on("leaderChanged", () => this.play("leader", { intensity: 0.7 })),
      sim.events.on("countryFinished", ({ ball }) => this.play("finish", { pan: panOf(ball.x) })),
      sim.events.on("countryParked", ({ ball }) => this.play("finish", { intensity: 0.4, pan: panOf(ball.x) })),
      sim.events.on("winnerDeclared", () => this.play("victory")),
      sim.events.on("roundStarted", () => this.play("countdown")),
    ];
    return () => offs.forEach((off) => off());
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.buffers.clear();
  }

  private synthesizeAll(): void {
    const rate = this.ctx?.sampleRate ?? 48000;
    const noise = createRandom("audio-noise");
    const rnd = () => noise.next() * 2 - 1;
    const env = (t: number, attack: number, decay: number) => Math.min(1, t / attack) * Math.exp(-t / decay);
    /** Sine sweep f0 → f1 with an accumulating phase (one instance per buffer). */
    const sweep = (f0: number, f1: number, duration: number) => {
      let phase = 0;
      return (t: number) => {
        phase += (2 * Math.PI * (f0 + (f1 - f0) * Math.min(1, t / duration))) / rate;
        return Math.sin(phase);
      };
    };
    const sine = (f: number, t: number) => Math.sin(2 * Math.PI * f * t);

    // Ball–ball: short filtered noise clicks in three colours.
    this.buffers.set(
      "impact",
      [0.25, 0.4, 0.6].map((cutoff) => {
        let y = 0;
        return this.render(0.06, (t) => {
          y += cutoff * (rnd() - y);
          return y * env(t, 0.001, 0.012) * 2.2;
        });
      }),
    );
    // Ball–wall: soft low thump.
    const thump = sweep(180, 90, 0.12);
    this.buffers.set("bounce", [this.render(0.12, (t) => thump(t) * env(t, 0.002, 0.03))]);
    const ping = sweep(880, 1320, 0.2);
    this.buffers.set("bumper", [this.render(0.2, (t) => ping(t) * env(t, 0.002, 0.06) * 0.6)]);
    const fall = sweep(520, 170, 0.32);
    this.buffers.set("eliminate", [this.render(0.32, (t) => square(fall(t)) * env(t, 0.005, 0.12) * 0.35)]);
    this.buffers.set("leader", [
      this.render(0.24, (t) => (t < 0.1 ? sine(660, t) * env(t, 0.003, 0.05) : sine(990, t) * env(t - 0.1, 0.003, 0.06)) * 0.5),
    ]);
    this.buffers.set("finish", [this.render(0.45, (t) => chord([523, 659, 784], t) * env(t, 0.005, 0.18) * 0.4)]);
    this.buffers.set("countdown", [this.render(0.16, (t) => sine(660, t) * env(t, 0.004, 0.06) * 0.5)]);
    this.buffers.set("go", [this.render(0.35, (t) => sine(990, t) * env(t, 0.004, 0.14) * 0.5)]);
    this.buffers.set("victory", [
      this.render(1.6, (t) => {
        const notes = [523, 659, 784, 1047];
        const i = Math.min(3, Math.floor(t / 0.13));
        const f = notes[i] as number;
        const local = t - i * 0.13;
        const level = i === 3 ? env(local, 0.005, 0.6) : env(local, 0.005, 0.1);
        return (sine(f, t) * 0.6 + sine(f * 2, t) * 0.15) * level * 0.5;
      }),
    ]);
  }

  private render(duration: number, synth: (t: number) => number): AudioBuffer {
    const ctx = this.ctx as AudioContext;
    const rate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(duration * rate));
    const buffer = ctx.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.max(-1, Math.min(1, synth(i / rate)));
    // Short fade-out to avoid clicks.
    const fade = Math.min(length, Math.floor(rate * 0.005));
    for (let i = 0; i < fade; i++) data[length - 1 - i]! *= i / fade;
    return buffer;
  }
}

function square(x: number): number {
  return x >= 0 ? 0.8 : -0.8;
}

function chord(freqs: number[], t: number): number {
  return freqs.reduce((sum, f) => sum + Math.sin(2 * Math.PI * f * t), 0) / freqs.length;
}
