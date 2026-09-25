import type { CountryService } from "@/countries/countryService";
import type { Country } from "@/countries/countryTypes";
import type { SimulationResult } from "@/engine/simulation";
import { createSimulation } from "@/modes";
import { runTournament, type TournamentResult } from "@/modes/tournament";
import { buildMetadata, type ContentMetadata, type Language } from "./metadata";
import { planSimulation, type GenerateRequest, type SimulationPlan } from "./plan";

export interface GeneratedSimulation {
  plan: SimulationPlan;
  /** Single-simulation result (for tournaments: the final). */
  result: SimulationResult;
  tournament: TournamentResult | null;
  metadata: ContentMetadata;
  /** Wall-clock milliseconds spent simulating. */
  elapsedMs: number;
}

/** Run a plan headless and produce its result and metadata. */
export function runPlan(plan: SimulationPlan, countries: Country[], language: Language = "en"): GeneratedSimulation {
  const started = performance.now();
  let result: SimulationResult;
  let tournament: TournamentResult | null = null;
  if (plan.config.tournament) {
    tournament = runTournament(plan.config, plan.config.tournament, countries);
    const final = tournament.outcomes[tournament.outcomes.length - 1];
    if (!final) throw new Error("Tournament produced no heats");
    result = final.result;
  } else {
    const sim = createSimulation(plan.config, countries);
    const finished = sim.runToEnd();
    sim.destroy();
    if (!finished) throw new Error(`Simulation ${plan.seed} did not finish`);
    result = finished;
  }
  const winner = countries.find((c) => c.cca3 === result.winner.cca3);
  const seconds = tournament
    ? tournament.outcomes.reduce((sum, o) => sum + o.result.seconds, 0)
    : result.seconds;
  const metadata = buildMetadata(
    plan,
    { winnerName: result.winner.name, winnerEmoji: winner?.flag.emoji ?? "", seconds },
    language,
  );
  return { plan, result, tournament, metadata, elapsedMs: performance.now() - started };
}

/**
 * The content-factory entry point:
 *
 *   await generateSimulation({ mode: "race", countries: "all", track: "random", seed: "12345", format: "9:16" }, service)
 *
 * Same request + same seed → the same simulation, result and metadata.
 */
export async function generateSimulation(
  request: GenerateRequest,
  service: CountryService,
  language: Language = "en",
): Promise<GeneratedSimulation> {
  const countries = await service.getAllCountries({ includeTerritories: true });
  return runPlan(planSimulation(request, countries), countries, language);
}
