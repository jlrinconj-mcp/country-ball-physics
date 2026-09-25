import type { CountryBall } from "@/entities/CountryBall";
import type { Simulation } from "@/engine/simulation";

export interface FeedItem {
  ball: CountryBall;
  kind: "eliminated" | "finished" | "leader";
  /** Simulation tick it happened on (animations run on sim time). */
  tick: number;
}

/**
 * Keeps the little bit of state the HUD needs between frames (recent events,
 * when the leader last changed), derived purely from simulation events.
 */
export class HudTracker {
  feed: FeedItem[] = [];
  leaderTick = 0;
  private readonly unsubscribe: (() => void)[] = [];

  constructor(sim: Simulation) {
    const push = (item: FeedItem) => {
      this.feed.push(item);
      if (this.feed.length > 12) this.feed.shift();
    };
    this.unsubscribe.push(
      sim.events.on("countryEliminated", ({ ball, tick }) => push({ ball, kind: "eliminated", tick })),
      sim.events.on("countryFinished", ({ ball, tick }) => push({ ball, kind: "finished", tick })),
      sim.events.on("leaderChanged", ({ leader, tick }) => {
        this.leaderTick = tick;
        push({ ball: leader, kind: "leader", tick });
      }),
    );
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
  }
}
