import { createRandom } from "@/engine/random";
import type { Simulation } from "@/engine/simulation";

/**
 * The sound design, shared by the live Web Audio engine and the offline
 * mixer that puts a soundtrack on CLI videos: what the sounds are (all
 * synthesized, no assets to license), when they play, and how often.
 */

export type SoundKind = "impact" | "bounce" | "bumper" | "eliminate" | "leader" | "finish" | "victory" | "countdown" | "go";

export interface PlayOptions {
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
 * Rate limiting on any clock (the audio context's, or simulated time): so
 * hundreds of contacts per second become a pleasant patter instead of noise.
 */
export class SoundGate {
  private readonly lastPlayed = new Map<SoundKind, number>();
  /** End times of the voices still sounding. */
  private voices: number[] = [];
  private windowStart = -1;
  private windowCount = 0;

  /** May `kind` start at `now`? Records it if so; `duration` holds a voice. */
  allow(kind: SoundKind, now: number, duration: number): boolean {
    this.voices = this.voices.filter((end) => end > now);
    if (this.voices.length >= MAX_VOICES) return false;
    if (now - (this.lastPlayed.get(kind) ?? -Infinity) < COOLDOWN[kind]) return false;
    if (kind === "impact" || kind === "bounce" || kind === "bumper") {
      if (now - this.windowStart > 0.1) {
        this.windowStart = now;
        this.windowCount = 0;
      }
      if (this.windowCount >= IMPACT_BUDGET) return false;
      this.windowCount++;
    }
    this.lastPlayed.set(kind, now);
    this.voices.push(now + duration);
    return true;
  }
}

/** Gain and playback rate for a play. */
export function voiceOf(kind: SoundKind, options: PlayOptions): { gain: number; rate: number; pan: number } {
  const intensity = Math.min(1, Math.max(0.05, options.intensity ?? 1));
  return {
    gain: kind === "impact" || kind === "bounce" ? intensity * 0.55 : intensity,
    rate: kind === "impact" ? 0.85 + intensity * 0.4 : 1,
    pan: Math.min(1, Math.max(-1, options.pan ?? 0)),
  };
}

/**
 * Map simulation events to sounds. `panOf` converts a world x to stereo pan
 * (the camera knows what's on screen). Call `afterStep` after every step for
 * the countdown beeps; `detach` unsubscribes.
 */
export function soundCues(
  sim: Simulation,
  play: (kind: SoundKind, options?: PlayOptions) => void,
  panOf: (x: number) => number,
): { afterStep(): void; detach(): void } {
  const offs = [
    sim.events.on("impact", ({ x, intensity, kind }) => play(kind === "ball" ? "impact" : kind === "bumper" ? "bumper" : "bounce", { intensity, pan: panOf(x) })),
    sim.events.on("countryEliminated", ({ ball }) => play("eliminate", { pan: panOf(ball.x) })),
    sim.events.on("leaderChanged", () => play("leader", { intensity: 0.7 })),
    sim.events.on("countryFinished", ({ ball }) => play("finish", { pan: panOf(ball.x) })),
    sim.events.on("countryParked", ({ ball }) => play("finish", { intensity: 0.4, pan: panOf(ball.x) })),
    sim.events.on("winnerDeclared", () => play("victory")),
    sim.events.on("roundStarted", () => play("countdown")),
  ];
  let lastBanner: string | undefined;
  return {
    afterStep() {
      if (sim.status !== "running") return;
      // Countdown beeps follow the HUD banner ("3", "2", "1", "GO!").
      const banner = sim.rules.hud().banner;
      if (banner !== lastBanner && banner && !banner.startsWith("ROUND")) play(banner === "GO!" ? "go" : "countdown");
      lastBanner = banner;
    },
    detach: () => offs.forEach((off) => off()),
  };
}

/** Every sound, as mono samples at `rate` Hz (some have several variants). */
export function synthesizeSounds(rate: number): Map<SoundKind, Float32Array[]> {
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
  const render = (duration: number, synth: (t: number) => number) => renderSamples(rate, duration, synth);

  const sounds = new Map<SoundKind, Float32Array[]>();
  // Ball–ball: short filtered noise clicks in three colours.
  sounds.set(
    "impact",
    [0.25, 0.4, 0.6].map((cutoff) => {
      let y = 0;
      return render(0.06, (t) => {
        y += cutoff * (rnd() - y);
        return y * env(t, 0.001, 0.012) * 2.2;
      });
    }),
  );
  // Ball–wall: soft low thump.
  const thump = sweep(180, 90, 0.12);
  sounds.set("bounce", [render(0.12, (t) => thump(t) * env(t, 0.002, 0.03))]);
  const ping = sweep(880, 1320, 0.2);
  sounds.set("bumper", [render(0.2, (t) => ping(t) * env(t, 0.002, 0.06) * 0.6)]);
  const fall = sweep(520, 170, 0.32);
  sounds.set("eliminate", [render(0.32, (t) => square(fall(t)) * env(t, 0.005, 0.12) * 0.35)]);
  sounds.set("leader", [render(0.24, (t) => (t < 0.1 ? sine(660, t) * env(t, 0.003, 0.05) : sine(990, t) * env(t - 0.1, 0.003, 0.06)) * 0.5)]);
  sounds.set("finish", [render(0.45, (t) => chord([523, 659, 784], t) * env(t, 0.005, 0.18) * 0.4)]);
  sounds.set("countdown", [render(0.16, (t) => sine(660, t) * env(t, 0.004, 0.06) * 0.5)]);
  sounds.set("go", [render(0.35, (t) => sine(990, t) * env(t, 0.004, 0.14) * 0.5)]);
  sounds.set("victory", [
    render(1.6, (t) => {
      const notes = [523, 659, 784, 1047];
      const i = Math.min(3, Math.floor(t / 0.13));
      const f = notes[i] as number;
      const local = t - i * 0.13;
      const level = i === 3 ? env(local, 0.005, 0.6) : env(local, 0.005, 0.1);
      return (sine(f, t) * 0.6 + sine(f * 2, t) * 0.15) * level * 0.5;
    }),
  ]);
  return sounds;
}

function renderSamples(rate: number, duration: number, synth: (t: number) => number): Float32Array {
  const length = Math.max(1, Math.floor(duration * rate));
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) data[i] = Math.max(-1, Math.min(1, synth(i / rate)));
  // Short fade-out to avoid clicks.
  const fade = Math.min(length, Math.floor(rate * 0.005));
  for (let i = 0; i < fade; i++) data[length - 1 - i]! *= i / fade;
  return data;
}

function square(x: number): number {
  return x >= 0 ? 0.8 : -0.8;
}

function chord(freqs: number[], t: number): number {
  return freqs.reduce((sum, f) => sum + Math.sin(2 * Math.PI * f * t), 0) / freqs.length;
}
