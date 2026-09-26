import type Matter from "matter-js";
import type { Country } from "@/countries/countryTypes";
import { CountryBall } from "@/entities/CountryBall";
import { Obstacle } from "@/entities/Obstacle";
import { Zone } from "@/entities/Zone";
import { withDeterministicMath } from "./deterministicMath";
import { EventBus } from "./events";
import { CATEGORY, PhysicsWorld, SUBSTEPS, TICK_DT, TICK_RATE } from "./physicsWorld";
import { createRandom, hashString, type Random } from "./random";
import { spawnPoints } from "./spawn";
import type { ModeId, ObstacleSpec, PhysicsSettings, SimulationConfig, Vec2, WorldLayout } from "./types";

export type CameraMode = "fixed" | "follow-leader" | "follow-action" | "follow-group" | "leader-last";

export interface ScenarioDefinition {
  id: string;
  label: string;
  description: string;
}

export interface ModeHud {
  headline: string;
  counterLabel: string;
  counterValue: number;
  /** Show leader flag/name in the HUD. */
  showLeader: boolean;
  /** Optional line such as "ROUND 2/5". */
  status?: string;
  /** Big centred text (countdowns, "GO!", "ROUND 2"). */
  banner?: string;
  /** Centred title card, e.g. "32 COUNTRIES" over "LAST PLACE IS ELIMINATED". */
  title?: { text: string; sub?: string; worldY?: number };
  /** One ball called out under the counter instead of the leader. */
  featured?: { label: string; ball: CountryBall; tone: "accent" | "danger" };
  /** Balls already out, most recent first (drawn as a strip of flags). */
  eliminated?: CountryBall[];
}

/** A game mode: builds a world and supplies the rules that run each tick. */
export interface ModeDefinition {
  id: ModeId;
  label: string;
  description: string;
  scenarios: ScenarioDefinition[];
  defaultCamera: CameraMode;
  /** Suggested participant count for this mode. */
  defaultParticipants: number;
  /** Physics tuned for this mode, applied over the global defaults. */
  recommendedPhysics?: Partial<PhysicsSettings>;
  /** Suggested time limit in seconds. */
  defaultDuration?: number;
  /** `map`: the config's map, when it names one. */
  autoBallRadius(count: number, scenario: string, map?: string): number;
  createLayout(ctx: LayoutContext): WorldLayout;
  createRules(sim: Simulation): ModeRules;
}

export interface LayoutContext {
  scenario: string;
  random: Random;
  count: number;
  ballRadius: number;
  /** Custom track, if the config has one (race modes). */
  track?: SimulationConfig["track"];
  /** Map from the registry, if the config names one. */
  map?: string;
}

export interface ModeRules {
  /** Runs before physics each tick (scripted changes such as a ring breaking). */
  beforeStep?(): void;
  /** Runs after physics each tick: eliminations, finishes, win conditions. */
  afterStep(): void;
  /** All balls, best first. */
  rank(): CountryBall[];
  /** Larger is further ahead. Enables leader tracking and follow cameras. */
  progress?(ball: CountryBall): number;
  /** Whether a leader makes sense yet (e.g. not before the start gate opens). */
  leaderActive?(): boolean;
  /**
   * Balls the follow cameras frame instead of their default subject (leader,
   * pack, group); the first one is always kept in shot. An empty list holds
   * the current shot.
   */
  cameraSubjects?(): CountryBall[];
  /** Frame the whole arena whatever the camera mode (e.g. ring arenas). */
  cameraFixed?(): boolean;
  /**
   * What the camera should be doing: "setup" frames the whole field (before
   * a start), "live" follows the race, "hold" keeps the shot (a result on
   * screen). Default: "live".
   */
  cameraMoment?(): "setup" | "live" | "hold";
  hud(): ModeHud;
  /** maxDuration reached: the mode must declare a winner. */
  onTimeout(): void;
}

export interface SimulationEvents {
  [key: string]: unknown;
  simulationStarted: { seed: string; mode: ModeId; participants: number };
  countryEliminated: { ball: CountryBall; remaining: number; place: number; tick: number };
  countryFinished: { ball: CountryBall; place: number; tick: number };
  countryTakesLead: { ball: CountryBall; tick: number };
  leaderChanged: { leader: CountryBall; previous: CountryBall | null; tick: number };
  raceFinished: { ranking: CountryBall[]; tick: number };
  winnerDeclared: { ball: CountryBall; tick: number; time: number; decidedBy: DecidedBy };
  simulationFinished: { result: SimulationResult };
  impact: { x: number; y: number; intensity: number; kind: "ball" | "wall" | "bumper" };
  obstacleChanged: { id: string; tick: number };
  roundStarted: { round: number; remaining: number; tick: number };
  /** A ball left the world without being decided (e.g. safe this round). */
  countryParked: { ball: CountryBall; tick: number };
}

export type DecidedBy = "physics" | "timeout";

export interface RankingEntry {
  place: number;
  cca3: string;
  cca2: string;
  name: string;
  status: CountryBall["status"];
  /** Tick of elimination/finish, if any. */
  tick: number | null;
}

export interface SimulationResult {
  seed: string;
  mode: ModeId;
  scenario: string;
  participants: number;
  winner: { cca3: string; cca2: string; name: string };
  decidedBy: DecidedBy;
  ranking: RankingEntry[];
  ticks: number;
  seconds: number;
  /** Hash of the outcome; equal fingerprints mean an identical run. */
  fingerprint: string;
  timeline: TimelineEntry[];
}

export interface TimelineEntry {
  tick: number;
  type: "eliminated" | "finished" | "leader" | "winner";
  cca3: string;
}

export type SimulationStatus = "ready" | "running" | "finished";

const LEADER_HOLD_TICKS = 12;
const LEADER_WARMUP_TICKS = 30;
/** Seconds an eliminated ball keeps falling (visual only). */
export const GHOST_LIFETIME = 2.5;

/**
 * One deterministic run: physics world + entities + mode rules. It has no
 * notion of wall-clock time or rendering — `step()` advances exactly one
 * fixed tick, so the same config and seed always produce the same result,
 * whether played back in a browser at any FPS or run headless in Node.
 */
export class Simulation {
  readonly events = new EventBus<SimulationEvents>();
  readonly random: Random;
  readonly physics: PhysicsWorld;
  readonly layout: WorldLayout;
  readonly balls: CountryBall[] = [];
  readonly obstacles: Obstacle[] = [];
  readonly zones: Zone[];
  readonly rules: ModeRules;
  readonly ballRadius: number;
  readonly scenario: string;

  tick = 0;
  status: SimulationStatus = "ready";
  finishedTick: number | null = null;
  winner: CountryBall | null = null;
  decidedBy: DecidedBy = "physics";
  leader: CountryBall | null = null;
  result: SimulationResult | null = null;
  /** Bumped by rules when the scene jumps (new round): cameras cut instead of panning. */
  cameraCut = 0;
  readonly timeline: TimelineEntry[] = [];

  private readonly bodyOwners = new Map<number, CountryBall | Obstacle>();
  private readonly pendingKicks: { ball: CountryBall; normal: Vec2; kick: number }[] = [];
  /** Balls passing through the scenery, with ticks left (see `phase`). */
  private readonly phasing = new Map<CountryBall, number>();
  private leaderCandidate: CountryBall | null = null;
  private leaderCandidateTicks = 0;
  private finishCount = 0;

  constructor(
    readonly config: SimulationConfig,
    countries: Country[],
    readonly definition: ModeDefinition,
  ) {
    this.random = createRandom(config.seed);
    this.scenario = definition.scenarios.some((s) => s.id === config.scenario)
      ? config.scenario
      : (definition.scenarios[0]?.id ?? "default");

    const participants = selectParticipants(config, countries);
    const count = participants.length;
    this.ballRadius = clamp(
      Math.round(definition.autoBallRadius(count, this.scenario, config.map) * config.physics.ballScale * 2) / 2,
      6,
      90,
    );

    this.physics = new PhysicsWorld(config.physics);
    this.layout = definition.createLayout({
      scenario: this.scenario,
      random: this.random.fork("layout"),
      count,
      ballRadius: this.ballRadius,
      track: config.track,
      map: config.map,
    });

    for (const spec of this.layout.obstacles) this.addObstacle(spec);
    this.zones = this.layout.zones.map((z) => new Zone(z));
    this.spawnBalls(participants);
    this.physics.onContact((contact) => this.handleContact(contact));
    this.rules = definition.createRules(this);
  }

  get time(): number {
    return this.tick * TICK_DT;
  }

  get aliveBalls(): CountryBall[] {
    return this.balls.filter((b) => b.alive);
  }

  get aliveCount(): number {
    let n = 0;
    for (const b of this.balls) if (b.alive) n++;
    return n;
  }

  /** Alive balls that are in the world (not parked). */
  get activeBalls(): CountryBall[] {
    return this.balls.filter((b) => b.active);
  }

  get maxTicks(): number {
    return Math.round(this.config.maxDuration * TICK_RATE);
  }

  start(): void {
    if (this.status !== "ready") return;
    this.status = "running";
    this.events.emit("simulationStarted", {
      seed: this.config.seed,
      mode: this.config.mode,
      participants: this.balls.length,
    });
  }

  /** Advance exactly one fixed tick. Keeps animating after the result. */
  step(): void {
    withDeterministicMath(() => this.advance());
  }

  private advance(): void {
    if (this.status === "ready") this.start();

    for (const ball of this.balls) ball.savePrevious();
    for (const obstacle of this.obstacles) obstacle.savePrevious();

    if (this.status === "running") this.rules.beforeStep?.();

    const maxSpeed = this.config.physics.maxSpeed;
    for (let s = 1; s <= SUBSTEPS; s++) {
      const t = (this.tick + s / SUBSTEPS) * TICK_DT;
      for (const obstacle of this.obstacles) {
        if (!obstacle.kinematic) continue;
        const pose = obstacle.poseAt(t);
        this.physics.setKinematicTransform(obstacle.body, pose, pose.angle);
      }
      this.physics.substep();
      this.applyKicks();
      // Cap after every sub-step (kicks and moving obstacles act mid-tick), so
      // the cap truly bounds how far a ball moves: no visible jumps.
      for (const ball of this.balls) if (ball.body) PhysicsWorld.clampSpeed(ball.body, maxSpeed);
    }

    for (const ball of this.balls) {
      if (ball.body) {
        ball.syncFromBody();
      } else if (ball.ghost) {
        this.updateGhost(ball);
      }
    }
    for (const obstacle of this.obstacles) obstacle.syncFromBody();

    this.tick++;
    this.updatePhasing();

    if (this.status === "running") {
      this.rules.afterStep();
      if (this.status === "running") this.trackLeader();
      if (this.status === "running" && this.tick >= this.maxTicks) {
        this.rules.onTimeout();
        if (this.status === "running") this.declareWinner(this.rules.rank()[0], "timeout");
      }
    }
  }

  /** Run without rendering until finished (or a hard cap). */
  runToEnd(extraTicks = 0): SimulationResult | null {
    return withDeterministicMath(() => {
      const cap = this.maxTicks + TICK_RATE * 5;
      while (this.status !== "finished" && this.tick < cap) this.advance();
      for (let i = 0; i < extraTicks; i++) this.advance();
      return this.result;
    });
  }

  // ── Rules API (used by modes) ──────────────────────────────────────────

  eliminate(ball: CountryBall, options: { fall?: boolean } = {}): void {
    if (!ball.alive) return;
    const place = this.aliveCount;
    ball.status = "eliminated";
    ball.eliminatedTick = this.tick;
    ball.place = place;
    this.detachBody(ball, options.fall ?? true);
    this.timeline.push({ tick: this.tick, type: "eliminated", cca3: ball.code });
    this.events.emit("countryEliminated", {
      ball,
      remaining: this.aliveCount,
      place,
      tick: this.tick,
    });
  }

  finish(ball: CountryBall): void {
    if (!ball.alive) return;
    this.finishCount++;
    ball.status = "finished";
    ball.finishedTick = this.tick;
    ball.place = this.finishCount;
    this.detachBody(ball, false);
    this.timeline.push({ tick: this.tick, type: "finished", cca3: ball.code });
    this.events.emit("countryFinished", { ball, place: ball.place, tick: this.tick });
  }

  get finishedCount(): number {
    return this.finishCount;
  }

  declareWinner(ball: CountryBall | undefined, decidedBy: DecidedBy = "physics"): void {
    if (this.status === "finished" || !ball) return;
    this.status = "finished";
    this.finishedTick = this.tick;
    this.winner = ball;
    this.decidedBy = decidedBy;

    // The winner is 1st; everyone still undecided is placed by the mode's ranking.
    ball.place ??= 1;
    const taken = new Set(this.balls.map((b) => b.place).filter((p): p is number => p !== null));
    let next = 1;
    for (const b of this.rules.rank()) {
      if (b.place !== null) continue;
      while (taken.has(next)) next++;
      b.place = next;
      taken.add(next);
    }

    this.timeline.push({ tick: this.tick, type: "winner", cca3: ball.code });
    this.result = this.buildResult();
    this.events.emit("winnerDeclared", { ball, tick: this.tick, time: this.time, decidedBy });
    if (this.rules.progress) {
      this.events.emit("raceFinished", { ranking: this.sortedByPlace(), tick: this.tick });
    }
    this.events.emit("simulationFinished", { result: this.result });
  }

  /** Replace an obstacle's geometry mid-run (keeps its motion script). */
  replaceObstacle(obstacle: Obstacle, spec: ObstacleSpec): void {
    this.bodyOwners.delete(obstacle.body.id);
    this.physics.remove(obstacle.body);
    const body = this.physics.createSolid(spec.shapes, {
      restitution: spec.restitution,
      friction: spec.friction,
      label: spec.style,
    });
    obstacle.rebuild(spec, body);
    this.bodyOwners.set(body.id, obstacle);
    const pose = obstacle.poseAt(this.time);
    this.physics.placeStatic(body, pose, pose.angle);
    obstacle.syncFromBody();
    obstacle.savePrevious();
    this.events.emit("obstacleChanged", { id: obstacle.id, tick: this.tick });
  }

  /**
   * Take a live ball out of the world without deciding it: it keeps its
   * status and place in the game, but has no body until `unpark`.
   */
  park(ball: CountryBall): void {
    if (!ball.active) return;
    ball.parked = true;
    this.detachBody(ball, false);
    this.events.emit("countryParked", { ball, tick: this.tick });
  }

  /** Put a parked ball back into the world at (x, y). */
  unpark(ball: CountryBall, x: number, y: number, vx = 0, vy = 0): void {
    if (!ball.alive || !ball.parked) return;
    const settings = this.config.physics;
    const body = this.physics.createBall(x, y, ball.radius, {
      restitution: settings.restitution,
      friction: settings.friction,
      frictionAir: settings.frictionAir,
    });
    PhysicsWorld.setVelocity(body, { x: vx, y: vy });
    ball.body = body;
    ball.parked = false;
    ball.ghost = null;
    this.bodyOwners.set(body.id, ball);
    ball.syncFromBody();
    ball.savePrevious();
  }

  /**
   * Last-resort unsticking: the ball ignores the scenery (it still hits
   * other balls) for `seconds`, dropping straight out of whatever trapped
   * it, then collides normally again.
   */
  phase(ball: CountryBall, seconds: number): void {
    const body = ball.body;
    if (!body || this.phasing.has(ball)) return;
    body.collisionFilter.mask = CATEGORY.ball;
    // Straight down: it must not drift through a side wall meanwhile.
    PhysicsWorld.setVelocity(body, { x: 0, y: Math.max(3, body.velocity.y) });
    this.phasing.set(ball, Math.round(seconds * TICK_RATE));
  }

  isPhasing(ball: CountryBall): boolean {
    return this.phasing.has(ball);
  }

  private updatePhasing(): void {
    for (const [ball, ticks] of this.phasing) {
      if (ticks > 1 && ball.body) {
        this.phasing.set(ball, ticks - 1);
        continue;
      }
      this.phasing.delete(ball);
      if (ball.body) ball.body.collisionFilter.mask = CATEGORY.ball | CATEGORY.solid;
    }
  }

  /** Apply an instantaneous velocity change to a live ball. */
  nudge(ball: CountryBall, dvx: number, dvy: number): void {
    if (!ball.body) return;
    PhysicsWorld.setVelocity(ball.body, {
      x: ball.body.velocity.x + dvx,
      y: ball.body.velocity.y + dvy,
    });
  }

  /** Move a live ball instantly (new round, respawn), zeroing its motion. */
  teleport(ball: CountryBall, x: number, y: number, vx = 0, vy = 0): void {
    const body = ball.body;
    if (!body) return;
    this.physics.placeStatic(body, { x, y }, body.angle);
    PhysicsWorld.setVelocity(body, { x: vx, y: vy });
    PhysicsWorld.setAngularVelocity(body, 0);
    ball.syncFromBody();
    ball.savePrevious();
  }

  sortedByPlace(): CountryBall[] {
    return [...this.balls].sort((a, b) => (a.place ?? 1e9) - (b.place ?? 1e9) || a.id - b.id);
  }

  destroy(): void {
    this.events.clear();
    this.physics.destroy();
    this.bodyOwners.clear();
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private spawnBalls(participants: Country[]): void {
    const { physics: settings } = this.config;
    const points = spawnPoints(
      this.layout.spawn,
      participants.length,
      this.ballRadius,
      this.random.fork("spawn"),
    );
    const velocity = this.random.fork("velocity");
    const speed = this.layout.spawn.speed;
    participants.forEach((country, i) => {
      const p = points[i] as Vec2;
      const body = this.physics.createBall(p.x, p.y, this.ballRadius, {
        restitution: settings.restitution,
        friction: settings.friction,
        frictionAir: settings.frictionAir,
      });
      const angle = velocity.float(0, Math.PI * 2);
      const magnitude = speed * velocity.float(0.4, 1);
      PhysicsWorld.setVelocity(body, { x: Math.cos(angle) * magnitude, y: Math.sin(angle) * magnitude });
      PhysicsWorld.setAngularVelocity(body, velocity.float(-0.05, 0.05));
      const ball = new CountryBall(i, country, this.ballRadius, body);
      this.balls.push(ball);
      this.bodyOwners.set(body.id, ball);
    });
  }

  private addObstacle(spec: ObstacleSpec): Obstacle {
    const body = this.physics.createSolid(spec.shapes, {
      restitution: spec.restitution,
      friction: spec.friction,
      label: spec.style,
    });
    const obstacle = new Obstacle(spec, body);
    if (obstacle.kinematic) {
      const pose = obstacle.poseAt(0);
      this.physics.placeStatic(body, pose, pose.angle);
      obstacle.syncFromBody();
      obstacle.savePrevious();
    }
    this.obstacles.push(obstacle);
    this.bodyOwners.set(body.id, obstacle);
    return obstacle;
  }

  private detachBody(ball: CountryBall, fall: boolean): void {
    const body = ball.body;
    if (!body) return;
    ball.ghost = fall
      ? { vx: body.velocity.x, vy: body.velocity.y, va: body.angularVelocity, age: 0 }
      : { vx: 0, vy: 0, va: 0, age: GHOST_LIFETIME - 0.6 };
    this.bodyOwners.delete(body.id);
    this.physics.remove(body);
    ball.body = null;
  }

  private updateGhost(ball: CountryBall): void {
    const ghost = ball.ghost;
    if (!ghost) return;
    ghost.vy += 0.28 * this.config.physics.gravity;
    ball.x += ghost.vx;
    ball.y += ghost.vy;
    ball.angle += ghost.va;
    ghost.age += TICK_DT;
    if (ghost.age >= GHOST_LIFETIME) ball.ghost = null;
  }

  private handleContact(contact: {
    a: Matter.Body;
    b: Matter.Body;
    speed: number;
    normal: Vec2;
    point: Vec2;
  }): void {
    const ownerA = this.bodyOwners.get(contact.a.id);
    const ownerB = this.bodyOwners.get(contact.b.id);
    const ball = ownerA instanceof CountryBall ? ownerA : ownerB instanceof CountryBall ? ownerB : null;
    const obstacle = ownerA instanceof Obstacle ? ownerA : ownerB instanceof Obstacle ? ownerB : null;

    if (ball && obstacle && obstacle.kick > 0) {
      // Normal points from A to B; make it point from the obstacle to the ball.
      const sign = ownerA === obstacle ? 1 : -1;
      this.pendingKicks.push({
        ball,
        normal: { x: contact.normal.x * sign, y: contact.normal.y * sign },
        kick: obstacle.kick,
      });
    }

    if (contact.speed > 1.2 && this.events.hasListeners("impact")) {
      this.events.emit("impact", {
        x: contact.point.x,
        y: contact.point.y,
        intensity: Math.min(1, contact.speed / 14),
        kind: obstacle ? (obstacle.kick > 0 ? "bumper" : "wall") : "ball",
      });
    }
  }

  private applyKicks(): void {
    for (const { ball, normal, kick } of this.pendingKicks) this.nudge(ball, normal.x * kick, normal.y * kick);
    this.pendingKicks.length = 0;
  }

  private trackLeader(): void {
    const progress = this.rules.progress;
    if (!progress || this.tick < LEADER_WARMUP_TICKS || this.rules.leaderActive?.() === false) return;
    const top = this.rules.rank()[0];
    if (!top || top === this.leader) {
      this.leaderCandidate = null;
      this.leaderCandidateTicks = 0;
      return;
    }
    if (top === this.leaderCandidate) {
      this.leaderCandidateTicks++;
    } else {
      this.leaderCandidate = top;
      this.leaderCandidateTicks = 1;
    }
    if (this.leader === null || this.leaderCandidateTicks >= LEADER_HOLD_TICKS) {
      const previous = this.leader;
      this.leader = top;
      this.leaderCandidate = null;
      this.leaderCandidateTicks = 0;
      this.timeline.push({ tick: this.tick, type: "leader", cca3: top.code });
      this.events.emit("countryTakesLead", { ball: top, tick: this.tick });
      this.events.emit("leaderChanged", { leader: top, previous, tick: this.tick });
    }
  }

  private buildResult(): SimulationResult {
    const winner = this.winner as CountryBall;
    const ranking: RankingEntry[] = this.sortedByPlace().map((b) => ({
      place: b.place ?? 0,
      cca3: b.code,
      cca2: b.country.cca2,
      name: b.name,
      status: b.status,
      tick: b.eliminatedTick ?? b.finishedTick,
    }));
    const signature = JSON.stringify({
      r: ranking.map((r) => [r.cca3, r.tick]),
      t: this.tick,
      w: [winner.x.toFixed(4), winner.y.toFixed(4)],
    });
    return {
      seed: this.config.seed,
      mode: this.config.mode,
      scenario: this.scenario,
      participants: this.balls.length,
      winner: { cca3: winner.code, cca2: winner.country.cca2, name: winner.name },
      decidedBy: this.decidedBy,
      ranking,
      ticks: this.tick,
      seconds: this.time,
      fingerprint: hashString(signature).toString(16).padStart(8, "0"),
      timeline: [...this.timeline],
    };
  }
}

/**
 * The countries that take part, in spawn order. Pure: sorts by ISO code, takes
 * a seeded sample if over the limit, then a seeded shuffle.
 */
export function selectParticipants(config: SimulationConfig, countries: Country[]): Country[] {
  const random = createRandom(config.seed);
  const wanted = new Set(config.countries.map((c) => c.toUpperCase()));
  const unique = new Map<string, Country>();
  for (const c of countries) if (wanted.has(c.cca3)) unique.set(c.cca3, c);
  let pool = [...unique.values()].sort((a, b) => a.cca3.localeCompare(b.cca3));
  const max = Math.max(1, config.maxParticipants);
  if (pool.length > max) {
    pool = random
      .fork("participants")
      .sample(pool, max)
      .sort((a, b) => a.cca3.localeCompare(b.cca3));
  }
  return random.fork("order").shuffle(pool);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
