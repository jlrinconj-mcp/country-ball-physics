import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@/engine/defaults";
import { makeTestCountries } from "@/engine/testing";
import { createSimulation, modeDefaults } from "@/modes";
import { RecordingTimeline } from "./timeline";

const countries = makeTestCountries(3);
const config = { ...DEFAULT_CONFIG, ...modeDefaults("race"), seed: "continuous-recording", countries: countries.map(c => c.cca3), scenario: "sprint", maxParticipants: 3 };

describe("continuous recording timeline", () => {
  it("keeps one world across continuous-race maps and records the same champion as a replay", () => {
    const entrants = makeTestCountries(5);
    const continuous = { ...DEFAULT_CONFIG, ...modeDefaults("last-place-elimination"), seed: "continuous-export", countries: entrants.map(c => c.cca3), continuous: true };
    const timeline = new RecordingTimeline(continuous, entrants);
    const sim = timeline.sim;
    const firstLayout = JSON.stringify(sim.layout);
    let changedMap = false;
    while (!timeline.done) {
      timeline.advance(120);
      expect(timeline.sim).toBe(sim);
      changedMap ||= JSON.stringify(sim.layout) !== firstLayout;
    }
    expect(changedMap).toBe(true);
    expect(timeline.results).toHaveLength(1);
    const result = timeline.results[0];
    expect(result?.ranking).toHaveLength(5);
    timeline.dispose();
    const replay = createSimulation(continuous, entrants);
    expect(replay.runToEnd()).toEqual(result);
    replay.destroy();
  });

  it("preserves the actual world and tick when a video is cut mid-race", () => {
    const timeline = new RecordingTimeline(config, countries);
    timeline.advance(600);
    const world = timeline.sim;
    const boundary = timeline.position;
    const bodies = world.balls.map(ball => ball.body);
    // Closing/opening an encoder does not invoke any timeline reset.
    expect(timeline.position).toEqual(boundary);
    timeline.advance(2);
    expect(timeline.sim).toBe(world);
    expect(timeline.sim.balls.map(ball => ball.body)).toEqual(bodies);
    expect(timeline.position.heatTick).toBe(boundary.heatTick + 2);
    while (!timeline.done) timeline.advance(2);
    const recorded = timeline.results[0];
    timeline.dispose();
    const baseline = createSimulation(config, countries);
    expect(recorded).toEqual(baseline.runToEnd());
    baseline.destroy();
  });
});
