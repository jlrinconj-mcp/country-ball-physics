import { createRandom } from "@/engine/random";
import type { Simulation } from "@/engine/simulation";
import { SoundGate, soundCues, synthesizeSounds, voiceOf, type PlayOptions, type SoundKind } from "./sounds";

export const MIX_RATE = 48_000;

/**
 * Soundtrack for a video rendered without a browser: the same sounds, cues
 * and rate limits as the live engine, on simulated time, mixed into stereo
 * samples. Same simulation → same soundtrack.
 */
export class OfflineMix {
  private readonly sounds = synthesizeSounds(MIX_RATE);
  private readonly gate = new SoundGate();
  private readonly variants = createRandom("audio-variants");
  private left = new Float32Array(MIX_RATE * 10);
  private right = new Float32Array(MIX_RATE * 10);
  private length = 0;
  private baseFrame = 0;
  /** Seconds into the video "now" (set by whoever drives the simulation). */
  time = 0;

  /** Louder than the live default: platforms turn loud videos down, never quiet ones up. */
  constructor(private readonly volume = 1.2) {}

  play(kind: SoundKind, options: PlayOptions = {}): void {
    const variants = this.sounds.get(kind);
    if (!variants?.length) return;
    const samples = variants[Math.floor(this.variants.next() * variants.length)] as Float32Array;
    const voice = voiceOf(kind, options);
    const frames = Math.floor(samples.length / voice.rate);
    if (!this.gate.allow(kind, this.time, frames / MIX_RATE)) return;
    // Equal-power pan, as a StereoPannerNode does for a mono source.
    const angle = ((voice.pan + 1) * Math.PI) / 4;
    const gl = Math.cos(angle) * voice.gain * this.volume;
    const gr = Math.sin(angle) * voice.gain * this.volume;
    const start = Math.round(this.time * MIX_RATE) - this.baseFrame;
    this.reserve(start + frames);
    for (let i = 0; i < frames; i++) {
      // Linear resampling for the pitched-up impacts.
      const at = i * voice.rate;
      const j = Math.floor(at);
      const s = (samples[j] ?? 0) + ((samples[j + 1] ?? 0) - (samples[j] ?? 0)) * (at - j);
      this.left[start + i]! += s * gl;
      this.right[start + i]! += s * gr;
    }
  }

  /** Play a simulation's sounds; `panOf` maps a world x to stereo pan. */
  attach(sim: Simulation, panOf: (x: number) => number): { afterStep(): void; detach(): void } {
    return soundCues(sim, (kind, options) => this.play(kind, options), panOf);
  }

  /** 16-bit stereo WAV, `seconds` long (silence-padded or cut). */
  wav(seconds: number, startSeconds = 0): Uint8Array {
    const frames = Math.round(seconds * MIX_RATE);
    const bytes = new Uint8Array(44 + frames * 4);
    const view = new DataView(bytes.buffer);
    const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    text(0, "RIFF");
    view.setUint32(4, 36 + frames * 4, true);
    text(8, "WAVE");
    text(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, MIX_RATE, true);
    view.setUint32(28, MIX_RATE * 4, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    text(36, "data");
    view.setUint32(40, frames * 4, true);
    const offset = Math.round(startSeconds * MIX_RATE) - this.baseFrame;
    for (let i = 0; i < frames; i++) {
      const at = offset + i;
      const l = at < this.length ? (this.left[at] as number) : 0;
      const r = at < this.length ? (this.right[at] as number) : 0;
      // Soft limiter: dense moments never clip.
      view.setInt16(44 + i * 4, Math.round(Math.tanh(l) * 32767), true);
      view.setInt16(46 + i * 4, Math.round(Math.tanh(r) * 32767), true);
    }
    return bytes;
  }

  /** Release completed parts while preserving sounds that overlap the cut. */
  discardBefore(seconds: number): void {
    const frame = Math.round(seconds * MIX_RATE);
    const count = Math.max(0, frame - this.baseFrame);
    if (!count) return;
    this.left.copyWithin(0, count);
    this.right.copyWithin(0, count);
    this.length = Math.max(0, this.length - count);
    this.left.fill(0, this.length);
    this.right.fill(0, this.length);
    this.baseFrame = frame;
  }

  private reserve(frames: number): void {
    this.length = Math.max(this.length, frames);
    if (frames <= this.left.length) return;
    const size = Math.max(frames, this.left.length * 2);
    const grow = (old: Float32Array) => {
      const next = new Float32Array(size);
      next.set(old);
      return next;
    };
    this.left = grow(this.left);
    this.right = grow(this.right);
  }
}
