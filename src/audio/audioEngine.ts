import { createRandom } from "@/engine/random";
import type { Simulation } from "@/engine/simulation";
import { SoundGate, soundCues, synthesizeSounds, voiceOf, type PlayOptions, type SoundKind } from "./sounds";

export type { SoundKind } from "./sounds";

/**
 * Small Web Audio sound engine for the live view and browser recordings.
 * Sounds are synthesized once into buffers (see `sounds.ts`, shared with the
 * offline mixer used for CLI videos); playback is rate-limited.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<SoundKind, AudioBuffer[]>();
  private gate = new SoundGate();
  private readonly variants = createRandom("audio-variants");
  private streamDestination: MediaStreamAudioDestinationNode | null = null;
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
      this.gate = new SoundGate();
      for (const [kind, samples] of synthesizeSounds(this.ctx.sampleRate)) {
        this.buffers.set(
          kind,
          samples.map((data) => {
            const buffer = (this.ctx as AudioContext).createBuffer(1, data.length, (this.ctx as AudioContext).sampleRate);
            buffer.getChannelData(0).set(data);
            return buffer;
          }),
        );
      }
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
    if (!this.enabled || !ctx || !this.master) return;
    const variants = this.buffers.get(kind);
    if (!variants?.length) return;
    const buffer = variants[Math.floor(this.variants.next() * variants.length)] as AudioBuffer;
    const voice = voiceOf(kind, options);
    if (!this.gate.allow(kind, ctx.currentTime, buffer.length / ctx.sampleRate / voice.rate)) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = voice.rate;
    const gain = ctx.createGain();
    gain.gain.value = voice.gain;
    const panner = ctx.createStereoPanner();
    panner.pan.value = voice.pan;
    source.connect(gain).connect(panner).connect(this.master);
    source.onended = () => source.disconnect();
    source.start();
  }

  /**
   * Play a simulation's sounds. `panOf` converts a world x to stereo pan
   * (the camera knows what's on screen). Call `afterStep` after each step.
   */
  attach(sim: Simulation, panOf: (x: number) => number): { afterStep(): void; detach(): void } {
    return soundCues(sim, (kind, options) => this.play(kind, options), panOf);
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.buffers.clear();
  }
}
