import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@/engine/defaults";
import { TICK_RATE } from "@/engine/physicsWorld";
import { makeTestCountries } from "@/engine/testing";
import { createSimulation, modeDefaults } from "@/modes";
import { MIX_RATE, OfflineMix } from "./offlineMix";

const countries = makeTestCountries(12);

/** Mix the first `seconds` of a race, as `npm run generate -- --video` does. */
function soundtrack(seconds: number): Uint8Array {
  const sim = createSimulation({ ...DEFAULT_CONFIG, ...modeDefaults("race"), seed: "soundtrack", countries: countries.map((c) => c.cca3), maxParticipants: 12 }, countries);
  const mix = new OfflineMix();
  const cues = mix.attach(sim, () => 0);
  while (sim.tick < seconds * TICK_RATE) {
    mix.time = (sim.tick + 1) / TICK_RATE;
    sim.step();
    cues.afterStep();
  }
  sim.destroy();
  return mix.wav(seconds);
}

describe("OfflineMix", () => {
  it("writes a stereo 16-bit WAV with the countdown and collisions in it", () => {
    const wav = soundtrack(6);
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(MIX_RATE);
    expect(wav.length).toBe(44 + 6 * MIX_RATE * 4);
    // Loud somewhere in each second: beeps during the countdown, then the race.
    for (let s = 0; s < 6; s++) {
      let peak = 0;
      for (let i = s * MIX_RATE; i < (s + 1) * MIX_RATE; i++) peak = Math.max(peak, Math.abs(view.getInt16(44 + i * 4, true)));
      expect(peak, `second ${s}`).toBeGreaterThan(1000);
    }
  });

  it("is the same soundtrack every time", () => {
    expect(soundtrack(3)).toEqual(soundtrack(3));
  });

  it("keeps overlapping audio across parts and discards completed samples", () => {
    const mix = new OfflineMix();
    mix.time = 0.9;
    mix.play("victory");
    const full = mix.wav(3).slice(44);
    const first = mix.wav(1).slice(44);
    mix.discardBefore(1);
    const second = mix.wav(2, 1).slice(44);
    expect(new Uint8Array([...first, ...second])).toEqual(full);
    mix.time = 3;
    mix.play("countdown");
    expect(mix.wav(1, 3).slice(44).some(value => value !== 0)).toBe(true);
  });
});
