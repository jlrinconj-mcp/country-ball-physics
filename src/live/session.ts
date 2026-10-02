import type { Country } from "@/countries/countryTypes";
import { createRandom } from "@/engine/random";
import type { SimulationResult } from "@/engine/simulation";
import type { ModeId, SimulationConfig } from "@/engine/types";
import { modeDefaults } from "@/modes";
import { parseCommand, type ChatMessage } from "./commands";
import { CountryMatcher } from "./countryMatch";

/**
 * A live stream as a game: a lobby where viewers pick a country (teams when
 * several pick the same one) and vote for the next game, the game itself
 * (viewers boost their country), then the result and points. Runs on the
 * clock the controller advances; the simulation stays deterministic because
 * every boost goes through `Simulation.input` and is recorded.
 */

export type LivePhase = "lobby" | "playing" | "results";

/** A game viewers can vote for. */
export interface GameOption {
  mode: ModeId;
  map: string;
}

/** Games that play well live: quick, readable, lots of lead changes. */
export const LIVE_GAMES: readonly GameOption[] = [
  { mode: "last-place-elimination", map: "plinko" },
  { mode: "last-place-elimination", map: "ring" },
  { mode: "last-place-elimination", map: "hammers" },
  { mode: "last-place-elimination", map: "obstacle-mix" },
  { mode: "last-place-elimination", map: "crushers" },
  { mode: "last-place-elimination", map: "vortex" },
  { mode: "race", map: "double-ring" },
  { mode: "race", map: "pinball" },
  { mode: "marble-race", map: "marble" },
  { mode: "last-country-standing", map: "triple-ring" },
  { mode: "last-country-standing", map: "zigzag" },
  { mode: "elimination-drop", map: "tumbler" },
];

export interface LiveOptions {
  /** Every game's seed derives from it. */
  seed: string;
  /** Seconds viewers have to join and vote between games. */
  lobbySeconds: number;
  /** Seconds the result stays up before the next lobby. */
  resultsSeconds: number;
  /** Countries per game: viewers' picks, topped up from `fill`. */
  players: number;
  /** Seconds between two boosts from the same viewer. */
  boostCooldown: number;
  /** Countries that top up the field when too few were picked (ISO alpha-3). */
  fill: string[];
  /** How many games to offer in each vote. */
  choices: number;
}

export const DEFAULT_LIVE_OPTIONS: Omit<LiveOptions, "seed" | "fill"> = {
  lobbySeconds: 30,
  resultsSeconds: 7,
  players: 24,
  boostCooldown: 6,
  choices: 3,
};

export interface Viewer {
  key: string;
  name: string;
  platform: ChatMessage["platform"];
  /** Picked for the coming game (and the current one, unless they switched). */
  country: string | null;
  points: number;
  wins: number;
  games: number;
  lastBoost: number;
}

export type FeedEvent =
  | { kind: "join"; user: string; cca3: string; time: number }
  | { kind: "boost"; user: string; cca3: string; time: number; gift: boolean }
  | { kind: "vote"; user: string; option: number; time: number }
  | { kind: "unknown"; user: string; query: string; time: number };

export interface LiveAction {
  type: "boost";
  cca3: string;
  user: string;
}

export interface LastGame {
  winner: string;
  /** Viewers on the winning country's team. */
  winners: string[];
  points: number;
}

/** Everything the screen and the panel show. */
export interface LiveView {
  phase: LivePhase;
  /** Seconds left in the lobby (or results). */
  countdown: number;
  game: number;
  choices: (GameOption & { votes: number })[];
  /** Teams for the coming game (lobby) or the current one, biggest first. */
  teams: { cca3: string; users: string[] }[];
  viewers: number;
  feed: FeedEvent[];
  leaderboard: { name: string; points: number; wins: number }[];
  current: GameOption | null;
  lastGame: LastGame | null;
}

const POINTS = [100, 50, 25];
const PLAY_POINTS = 5;

export class LiveSession {
  phase: LivePhase = "lobby";
  /** Seconds since the session started. */
  clock = 0;
  game = 0;
  readonly viewers = new Map<string, Viewer>();
  private phaseEnds: number;
  private choices: GameOption[] = [];
  private readonly votes = new Map<string, number>();
  private readonly feed: FeedEvent[] = [];
  private readonly matcher: CountryMatcher;
  private readonly byCode: Map<string, Country>;
  /** Teams of the game being played (picks are locked at its start). */
  private playing = new Map<string, string[]>();
  private current: GameOption | null = null;
  private lastGame: LastGame | null = null;

  constructor(
    countries: Country[],
    readonly options: LiveOptions,
  ) {
    this.matcher = new CountryMatcher(countries);
    this.byCode = new Map(countries.map((c) => [c.cca3, c]));
    this.phaseEnds = options.lobbySeconds;
    this.pickChoices();
  }

  /** Handle a chat message; returns what to do to the running game. */
  handle(message: ChatMessage): LiveAction[] {
    const key = `${message.platform}:${message.userId ?? message.user.toLowerCase()}`;
    const viewer = this.viewers.get(key) ?? { key, name: message.user, platform: message.platform, country: null, points: 0, wins: 0, games: 0, lastBoost: -Infinity };
    viewer.name = message.user;
    const gift = message.kind === "gift" || message.kind === "like";
    const command = gift ? ({ kind: "boost" } as const) : parseCommand(message.text);
    if (!command) return [];
    this.viewers.set(key, viewer);

    switch (command.kind) {
      case "join": {
        const country = this.matcher.find(command.query);
        if (!country) {
          this.push({ kind: "unknown", user: viewer.name, query: command.query, time: this.clock });
          return [];
        }
        if (viewer.country === country.cca3) return [];
        viewer.country = country.cca3;
        this.push({ kind: "join", user: viewer.name, cca3: country.cca3, time: this.clock });
        return [];
      }
      case "vote": {
        if (this.phase !== "lobby" || command.option > this.choices.length) return [];
        this.votes.set(key, command.option - 1);
        this.push({ kind: "vote", user: viewer.name, option: command.option, time: this.clock });
        return [];
      }
      case "boost": {
        if (this.phase !== "playing" || !viewer.country) return [];
        // Only for the country you're playing with in this game.
        if (!this.playing.get(viewer.country)?.includes(key)) return [];
        if (!gift && this.clock - viewer.lastBoost < this.options.boostCooldown) return [];
        if (!gift) viewer.lastBoost = this.clock;
        this.push({ kind: "boost", user: viewer.name, cca3: viewer.country, time: this.clock, gift });
        return [{ type: "boost", cca3: viewer.country, user: viewer.name }];
      }
      case "points":
        return [];
    }
  }

  /**
   * Advance the session clock. Returns "start" when the lobby is over (start
   * `startConfig`) and "lobby" when the results are over.
   */
  advance(seconds: number): "start" | "lobby" | null {
    this.clock += seconds;
    if (this.clock < this.phaseEnds) return null;
    if (this.phase === "lobby") {
      this.phase = "playing";
      this.phaseEnds = Infinity;
      return "start";
    }
    if (this.phase === "results") {
      this.phase = "lobby";
      this.phaseEnds = this.clock + this.options.lobbySeconds;
      this.votes.clear();
      this.pickChoices();
      return "lobby";
    }
    return null;
  }

  /** Skip the rest of the lobby (host button). */
  startNow(): void {
    if (this.phase === "lobby") this.phaseEnds = this.clock;
  }

  /** The game that won the vote, as a config on top of `base` (physics, display…). */
  startConfig(base: SimulationConfig): SimulationConfig {
    this.game++;
    const tally = this.tally();
    const best = Math.max(...tally);
    // Ties (and no votes) go to the first offered.
    const choice = this.choices[tally.indexOf(best)] ?? (LIVE_GAMES[0] as GameOption);
    this.current = choice;

    this.playing = this.teams();
    const picked = [...this.playing.keys()];
    const seed = `${this.options.seed}-g${this.game}`;
    const random = createRandom(seed).fork("live-fill");
    const size = Math.min(120, Math.max(this.options.players, picked.length));
    const others = this.options.fill.filter((c) => !this.playing.has(c) && this.byCode.has(c));
    const countries = [...picked, ...random.sample(others, Math.min(others.length, size - picked.length))];
    for (const users of this.playing.values()) for (const key of users) (this.viewers.get(key) as Viewer).games++;

    const defaults = modeDefaults(choice.mode);
    return {
      ...base,
      ...defaults,
      physics: defaults.physics,
      seed,
      countries,
      maxParticipants: countries.length,
      ...(choice.mode === "last-place-elimination" ? { scenario: choice.map, map: undefined } : { map: choice.map }),
      tournament: undefined,
      track: undefined,
      inputs: undefined,
    };
  }

  /** The game is over: points for the winning teams, then the results. */
  finish(result: SimulationResult): void {
    if (this.phase !== "playing") return;
    const winners: string[] = [];
    result.ranking.slice(0, POINTS.length).forEach((row, i) => {
      for (const key of this.playing.get(row.cca3) ?? []) {
        const viewer = this.viewers.get(key) as Viewer;
        viewer.points += POINTS[i] as number;
        if (i === 0) {
          viewer.wins++;
          winners.push(viewer.name);
        }
      }
    });
    for (const users of this.playing.values()) for (const key of users) (this.viewers.get(key) as Viewer).points += PLAY_POINTS;
    this.lastGame = { winner: result.winner.cca3, winners, points: POINTS[0] as number };
    this.phase = "results";
    this.phaseEnds = this.clock + this.options.resultsSeconds;
  }

  /** The game was abandoned (host started another one). */
  cancel(): void {
    if (this.phase === "lobby") return;
    this.phase = "results";
    this.phaseEnds = this.clock;
  }

  /** The viewer team for a country in the game being played. */
  team(cca3: string): string[] {
    return (this.playing.get(cca3) ?? []).map((key) => this.viewers.get(key)?.name ?? key);
  }

  view(): LiveView {
    const tally = this.tally();
    const teams = this.phase === "lobby" ? this.teams() : this.playing;
    return {
      phase: this.phase,
      countdown: Math.max(0, this.phaseEnds - this.clock),
      game: this.game,
      choices: this.choices.map((c, i) => ({ ...c, votes: tally[i] ?? 0 })),
      teams: [...teams]
        .map(([cca3, keys]) => ({ cca3, users: keys.map((k) => this.viewers.get(k)?.name ?? k) }))
        .sort((a, b) => b.users.length - a.users.length || a.cca3.localeCompare(b.cca3)),
      viewers: this.viewers.size,
      feed: this.feed.filter((f) => this.clock - f.time < 6).slice(-6),
      leaderboard: [...this.viewers.values()]
        .filter((v) => v.points > 0)
        .sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name))
        .slice(0, 5)
        .map(({ name, points, wins }) => ({ name, points, wins })),
      current: this.current,
      lastGame: this.lastGame,
    };
  }

  /** Points to keep between streams. */
  exportScores(): Record<string, { name: string; points: number; wins: number; games: number }> {
    return Object.fromEntries([...this.viewers.values()].filter((v) => v.games > 0).map((v) => [v.key, { name: v.name, points: v.points, wins: v.wins, games: v.games }]));
  }

  importScores(scores: Record<string, { name: string; points: number; wins: number; games: number }>): void {
    for (const [key, s] of Object.entries(scores)) {
      const platform = key.split(":")[0] as ChatMessage["platform"];
      const viewer = this.viewers.get(key) ?? { key, name: s.name, platform, country: null, points: 0, wins: 0, games: 0, lastBoost: -Infinity };
      Object.assign(viewer, { points: s.points, wins: s.wins, games: s.games });
      this.viewers.set(key, viewer);
    }
  }

  private teams(): Map<string, string[]> {
    const teams = new Map<string, string[]>();
    for (const viewer of this.viewers.values()) {
      if (!viewer.country) continue;
      teams.set(viewer.country, [...(teams.get(viewer.country) ?? []), viewer.key]);
    }
    return teams;
  }

  private tally(): number[] {
    const tally = this.choices.map(() => 0);
    for (const option of this.votes.values()) tally[option] = (tally[option] ?? 0) + 1;
    return tally;
  }

  private pickChoices(): void {
    const random = createRandom(`${this.options.seed}-lobby-${this.game}`);
    const pool = this.current ? LIVE_GAMES.filter((g) => g.mode !== this.current?.mode || g.map !== this.current?.map) : [...LIVE_GAMES];
    this.choices = random.sample(pool, Math.min(this.options.choices, pool.length));
  }

  private push(event: FeedEvent): void {
    this.feed.push(event);
    if (this.feed.length > 40) this.feed.splice(0, this.feed.length - 40);
  }
}
