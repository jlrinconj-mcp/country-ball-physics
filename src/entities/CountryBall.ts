import type Matter from "matter-js";
import type { Country } from "@/countries/countryTypes";

export type BallStatus = "alive" | "eliminated" | "finished";

/** Post-elimination fall animation, integrated outside Matter (no collisions). */
export interface BallGhost {
  vx: number;
  vy: number;
  va: number;
  age: number;
}

/**
 * A country in the simulation: a real Matter.js circle body plus the state the
 * rules, HUD and renderer need. The renderer reads x/y/angle (and prev* for
 * interpolation) and never touches the body.
 */
export class CountryBall {
  status: BallStatus = "alive";
  x: number;
  y: number;
  angle = 0;
  prevX: number;
  prevY: number;
  prevAngle = 0;
  vx = 0;
  vy = 0;
  eliminatedTick: number | null = null;
  finishedTick: number | null = null;
  /** Final place (1 = winner) once decided. */
  place: number | null = null;
  ghost: BallGhost | null = null;
  /** Mode-specific scratch data (lap, checkpoint, round…). */
  progress = 0;
  /**
   * Still in the game but out of the world for now (e.g. crossed the line
   * this round and waits for the next one). Parked balls have no body.
   */
  parked = false;

  constructor(
    /** Spawn order; also the deterministic tie-breaker. */
    readonly id: number,
    readonly country: Country,
    readonly radius: number,
    public body: Matter.Body | null,
  ) {
    this.x = this.prevX = body?.position.x ?? 0;
    this.y = this.prevY = body?.position.y ?? 0;
  }

  get alive(): boolean {
    return this.status === "alive";
  }

  /** Alive and physically in the world (not parked). */
  get active(): boolean {
    return this.status === "alive" && !this.parked;
  }

  get code(): string {
    return this.country.cca3;
  }

  get name(): string {
    return this.country.name;
  }

  /** Snapshot current pose as the interpolation start for the next tick. */
  savePrevious(): void {
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevAngle = this.angle;
  }

  /** Copy the pose from the physics body after a tick. */
  syncFromBody(): void {
    const body = this.body;
    if (!body) return;
    this.x = body.position.x;
    this.y = body.position.y;
    this.angle = body.angle;
    this.vx = body.velocity.x;
    this.vy = body.velocity.y;
  }
}
