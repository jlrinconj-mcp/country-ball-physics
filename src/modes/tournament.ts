import type { Country } from "@/countries/countryTypes";
import { createRandom, hashString } from "@/engine/random";
import type { SimulationResult } from "@/engine/simulation";
import type { ModeId, SimulationConfig } from "@/engine/types";
import { createSimulation } from "./index";

export const TOURNAMENT_SIZES = [8, 16, 32, 64] as const;
export type TournamentSize = (typeof TOURNAMENT_SIZES)[number];

export interface TournamentSettings {
  size: TournamentSize;
}

export interface HeatPlan {
  round: number;
  heat: number;
  seed: string;
  countries: string[];
}

export interface RoundPlan {
  index: number;
  name: string;
  heats: HeatPlan[];
  /** How many from each heat go through (0 for the final). */
  advance: number;
}

export interface HeatOutcome {
  heat: HeatPlan;
  result: SimulationResult;
  advanced: string[];
}

export interface TournamentSummary {
  size: TournamentSize;
  mode: ModeId;
  rounds: { name: string; advance: number; heats: { countries: string[]; winner: string | null; advanced: string[] }[] }[];
  current: { round: number; heat: number } | null;
  champion: string | null;
}

export interface TournamentResult {
  seed: string;
  size: TournamentSize;
  mode: ModeId;
  champion: string;
  outcomes: HeatOutcome[];
  fingerprint: string;
}

/** Round structure: heats of up to 8, always ending in a single final. */
function structure(size: TournamentSize): { name: string; heats: number; advance: number }[] {
  switch (size) {
    case 8:
      return [
        { name: "Semi-finals", heats: 2, advance: 2 },
        { name: "Final", heats: 1, advance: 0 },
      ];
    case 16:
      return [
        { name: "Semi-finals", heats: 2, advance: 4 },
        { name: "Final", heats: 1, advance: 0 },
      ];
    case 32:
      return [
        { name: "Quarter-finals", heats: 4, advance: 2 },
        { name: "Final", heats: 1, advance: 0 },
      ];
    case 64:
      return [
        { name: "Round of 64", heats: 8, advance: 1 },
        { name: "Final", heats: 1, advance: 0 },
      ];
  }
}

/**
 * A tournament is a sequence of ordinary simulations. Each heat has its own
 * derived seed, so the whole tournament replays exactly from one seed.
 */
export class Tournament {
  readonly rounds: RoundPlan[] = [];
  readonly outcomes: HeatOutcome[] = [];
  private cursor = { round: 0, heat: 0 };
  private readonly shape: { name: string; heats: number; advance: number }[];

  constructor(
    readonly base: SimulationConfig,
    readonly settings: TournamentSettings,
  ) {
    this.shape = structure(settings.size);
    const random = createRandom(base.seed).fork("tournament");
    const pool = [...new Set(base.countries.map((c) => c.toUpperCase()))].sort();
    if (pool.length < settings.size) {
      throw new Error(`A ${settings.size}-country tournament needs at least ${settings.size} countries (got ${pool.length})`);
    }
    const entrants = random.fork("draw").shuffle(random.fork("entrants").sample(pool, settings.size));
    this.rounds.push(this.planRound(0, entrants));
  }

  get finished(): boolean {
    return this.champion !== null;
  }

  get champion(): string | null {
    const final = this.rounds.find((r) => r.advance === 0);
    const outcome = final && this.outcomes.find((o) => o.heat.round === final.index);
    return outcome?.result.winner.cca3 ?? null;
  }

  /** The heat to run next, as a normal simulation config. */
  current(): { round: RoundPlan; heat: HeatPlan; config: SimulationConfig } | null {
    if (this.finished) return null;
    const round = this.rounds[this.cursor.round];
    const heat = round?.heats[this.cursor.heat];
    if (!round || !heat) return null;
    return {
      round,
      heat,
      config: {
        ...this.base,
        seed: heat.seed,
        countries: heat.countries,
        maxParticipants: heat.countries.length,
      },
    };
  }

  /** Record the result of the current heat and move on. */
  record(result: SimulationResult): void {
    const current = this.current();
    if (!current) return;
    const { round, heat } = current;
    const advanced = result.ranking.slice(0, round.advance).map((r) => r.cca3);
    this.outcomes.push({ heat, result, advanced });

    if (this.cursor.heat + 1 < round.heats.length) {
      this.cursor.heat++;
      return;
    }
    if (round.advance === 0) return;
    const qualified = this.outcomes.filter((o) => o.heat.round === round.index).flatMap((o) => o.advanced);
    this.rounds.push(this.planRound(round.index + 1, qualified));
    this.cursor = { round: round.index + 1, heat: 0 };
  }

  summary(): TournamentSummary {
    const current = this.current();
    return {
      size: this.settings.size,
      mode: this.base.mode,
      rounds: this.shape.map((shape, index) => {
        const planned = this.rounds[index];
        return {
          name: shape.name,
          advance: shape.advance,
          heats: (planned?.heats ?? []).map((heat) => {
            const outcome = this.outcomes.find((o) => o.heat.round === index && o.heat.heat === heat.heat);
            return {
              countries: heat.countries,
              winner: outcome?.result.winner.cca3 ?? null,
              advanced: outcome?.advanced ?? [],
            };
          }),
        };
      }),
      current: current ? { round: current.round.index, heat: current.heat.heat } : null,
      champion: this.champion,
    };
  }

  /** Human label for the HUD, e.g. "QUARTER-FINALS · HEAT 2/4". */
  label(): string {
    const current = this.current();
    if (!current) return "FINAL";
    const { round, heat } = current;
    return round.heats.length > 1
      ? `${round.name.toUpperCase()} · HEAT ${heat.heat + 1}/${round.heats.length}`
      : round.name.toUpperCase();
  }

  private planRound(index: number, entrants: string[]): RoundPlan {
    const shape = this.shape[index];
    if (!shape) throw new Error(`No round ${index}`);
    const heats: HeatPlan[] = Array.from({ length: shape.heats }, (_, heat) => ({
      round: index,
      heat,
      seed: `${this.base.seed}/r${index + 1}-h${heat + 1}`,
      countries: entrants.filter((_, i) => i % shape.heats === heat),
    }));
    return { index, name: shape.name, heats, advance: shape.advance };
  }
}

/** Run a whole tournament headless (tests, CLI, content pipeline). */
export function runTournament(base: SimulationConfig, settings: TournamentSettings, countries: Country[]): TournamentResult {
  const tournament = new Tournament(base, settings);
  for (let guard = 0; guard < 32 && !tournament.finished; guard++) {
    const next = tournament.current();
    if (!next) break;
    const sim = createSimulation(next.config, countries);
    const result = sim.runToEnd();
    sim.destroy();
    if (!result) throw new Error(`Heat ${next.heat.seed} did not finish`);
    tournament.record(result);
  }
  const champion = tournament.champion;
  if (!champion) throw new Error("Tournament did not produce a champion");
  return {
    seed: base.seed,
    size: settings.size,
    mode: base.mode,
    champion,
    outcomes: tournament.outcomes,
    fingerprint: hashString(tournament.outcomes.map((o) => o.result.fingerprint).join("|")).toString(16).padStart(8, "0"),
  };
}
