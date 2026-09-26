import type { CountryBall } from "@/entities/CountryBall";
import { TICK_RATE } from "./physicsWorld";
import type { CameraMode, Simulation } from "./simulation";
import type { Rect } from "./types";

export interface Viewport {
  /** Output size in virtual pixels (e.g. 1080×1920). */
  width: number;
  height: number;
  /** Region clear of platform overlays; the camera frames action inside it. */
  content: Rect;
}

export interface CameraPose {
  /** World point shown at the centre of the content rect. */
  x: number;
  y: number;
  /** Virtual pixels per world unit. */
  zoom: number;
}

export interface CameraOptions {
  mode: CameraMode;
  /** Allow zooming in on the action; otherwise zoom stays at "fit width". */
  dynamicZoom: boolean;
}

const POSITION_STIFFNESS = 3.2;
const ZOOM_STIFFNESS = 1.6;
const MAX_ZOOM_FACTOR = 2.2;
/** Leader stays within this fraction of the content half-height from centre. */
const LEADER_FRAME = 0.85;
/** Side margin kept around the framed region, in output pixels. */
const FRAME_MARGIN = 28;
/** When the kept-in-shot ball changes, catch up at most this many frame heights per second. */
const HANDOVER_SPEED = 4;
/** Leader ↔ last: seconds on each subject, and how close the shot is. */
const SHOT_SECONDS = 3.2;
const CLOSE_UP = 1.7;
/** A switch that moves the shot further than this (fraction of the frame height) is a cut. */
const CUT_DISTANCE = 0.6;
/** Stiffness of the quick pan when switching subjects over a short distance. */
const WHIP_STIFFNESS = 7;

/** Who the leader ↔ last camera is on. */
export interface Spotlight {
  role: "leader" | "last";
  ball: CountryBall;
}

/**
 * Smooth camera. Targets come from the simulation state (leader, pack,
 * group), and the pose eases toward them with exponential damping measured in
 * real time, so framing is smooth at any frame rate and never affects physics.
 */
export class Camera {
  pose: CameraPose = { x: 0, y: 0, zoom: 1 };
  private viewport: Viewport = { width: 1080, height: 1920, content: { x: 0, y: 0, w: 1080, h: 1920 } };
  options: CameraOptions = { mode: "fixed", dynamicZoom: true };
  /** Last `sim.cameraCut` seen: a change means cut, don't pan. */
  private cut: { sim: Simulation | null; value: number } = { sim: null, value: 0 };
  /** Ball kept in shot last frame, and whether we're still catching up to it. */
  private kept: CountryBall | null = null;
  private handover = false;
  /** Leader ↔ last: who's on screen (read by the HUD), since when it's live. */
  spotlight: Spotlight | null = null;
  /** The last update cut to a new shot instead of moving (for tooling and tests). */
  cutThisFrame = false;
  private live: { sim: Simulation; tick: number } | null = null;
  private whip = 0;

  setViewport(viewport: Viewport): void {
    this.viewport = viewport;
  }

  getViewport(): Viewport {
    return this.viewport;
  }

  /** Jump straight to the target (new simulation, format change). */
  snap(sim: Simulation, alpha = 1): void {
    this.cut = { sim, value: sim.cameraCut };
    this.pose = this.target(sim, alpha);
  }

  update(sim: Simulation, alpha: number, dt: number): void {
    if (this.cut.sim !== sim || this.cut.value !== sim.cameraCut) {
      this.snap(sim, alpha);
      return;
    }
    const previous = this.spotlight;
    this.spotlight = this.pickSpotlight(sim);
    const target = this.target(sim, alpha);
    this.cutThisFrame = false;
    if (this.spotlight && previous && this.spotlight.ball !== previous.ball) {
      // A new subject (leader ↔ last, or a new leader / last): cut if it's
      // far, else a quick whip-pan.
      const far = Math.hypot(target.x - this.pose.x, target.y - this.pose.y) * this.pose.zoom > this.viewport.height * CUT_DISTANCE;
      this.kept = this.spotlight.ball;
      // After a cut the subject is already in shot; on a pan, "keep in
      // frame" catches up at a bounded speed instead of snapping.
      this.handover = !far;
      if (far) {
        this.pose = target;
        this.cutThisFrame = true;
        return;
      }
      this.whip = 0.6;
    }
    this.whip = Math.max(0, this.whip - dt);
    const kp = 1 - Math.exp(-(this.whip > 0 ? WHIP_STIFFNESS : POSITION_STIFFNESS) * dt);
    const kz = 1 - Math.exp(-ZOOM_STIFFNESS * dt);
    this.pose = {
      x: this.pose.x + (target.x - this.pose.x) * kp,
      y: this.pose.y + (target.y - this.pose.y) * kp,
      zoom: this.pose.zoom + (target.zoom - this.pose.zoom) * kz,
    };
    this.keepLeaderInFrame(sim, alpha, dt);
  }

  /**
   * Smoothing lags behind a fast leader; in leader/action modes never let it
   * drift out of shot. The leader's speed is capped, so this can't whip; when
   * a different ball takes over (possibly across the screen), the camera
   * pans over at a bounded speed instead of jumping.
   */
  private keepLeaderInFrame(sim: Simulation, alpha: number, dt: number): void {
    const mode = this.options.mode;
    if (mode !== "follow-leader" && mode !== "follow-action" && mode !== "leader-last") return;
    if (sim.rules.cameraFixed?.()) return;
    // Leader ↔ last: nothing to keep before it goes live, and the whip-pan
    // to a new subject is already on its way.
    if (mode === "leader-last" && (!this.spotlight || this.whip > 0)) return;
    // Modes that pick their own subjects keep the first one in shot.
    const leader =
      mode === "leader-last"
        ? (this.spotlight?.ball ?? null)
        : sim.rules.cameraSubjects
          ? (sim.rules.cameraSubjects()[0] ?? null)
          : sim.leader?.active
            ? sim.leader
            : null;
    if (!leader?.active) return;
    const x = lerp(leader.prevX, leader.x, alpha);
    const y = lerp(leader.prevY, leader.y, alpha);
    const marginX = (this.viewport.width / 2 / this.pose.zoom) * LEADER_FRAME - leader.radius;
    const marginY = (this.viewport.content.h / 2 / this.pose.zoom) * LEADER_FRAME;
    let { x: px, y: py } = this.pose;
    if (x > px + marginX) px = x - marginX;
    else if (x < px - marginX) px = x + marginX;
    if (y > py + marginY) py = y - marginY;
    else if (y < py - marginY) py = y + marginY;
    if (leader !== this.kept) {
      this.kept = leader;
      this.handover = true;
    }
    if (this.handover) {
      const max = (HANDOVER_SPEED * this.viewport.height * dt) / this.pose.zoom;
      const dx = px - this.pose.x;
      const dy = py - this.pose.y;
      if (Math.abs(dx) <= max && Math.abs(dy) <= max) this.handover = false;
      px = this.pose.x + Math.max(-max, Math.min(max, dx));
      py = this.pose.y + Math.max(-max, Math.min(max, dy));
    }
    // Never past the world's edges (a subject inside the world stays in shot).
    if (px !== this.pose.x || py !== this.pose.y) this.pose = this.clamp({ ...this.pose, x: px, y: py }, sim.layout.bounds);
  }

  /**
   * Leader ↔ last: the leader first, then whoever is last, taking turns every
   * few seconds while the race is live (restarting with the leader each time
   * it goes live, e.g. every round). On simulation time, so recordings match.
   */
  private pickSpotlight(sim: Simulation): Spotlight | null {
    if (this.options.mode !== "leader-last" || sim.status !== "running" || sim.rules.cameraFixed?.()) return null;
    if ((sim.rules.cameraMoment?.() ?? "live") !== "live") {
      this.live = null;
      return null;
    }
    if (!this.live || this.live.sim !== sim) this.live = { sim, tick: sim.tick };
    const order = sim.rules.rank().filter((b) => b.active);
    const first = order[0];
    const last = order[order.length - 1];
    if (!first || !last) return null;
    if (first === last) return { role: "leader", ball: first };
    const shot = Math.floor((sim.tick - this.live.tick) / (SHOT_SECONDS * TICK_RATE));
    return shot % 2 === 0 ? { role: "leader", ball: first } : { role: "last", ball: last };
  }

  /**
   * Screen point the camera's pose maps to: horizontally the frame centre
   * (safe areas are asymmetric, framing shouldn't be), vertically the centre
   * of the content area (below the HUD, above captions).
   */
  anchor(): { x: number; y: number } {
    const { width, content } = this.viewport;
    return { x: width / 2, y: content.y + content.h / 2 };
  }

  /** Transform a world point into virtual screen pixels. */
  worldToScreen(x: number, y: number): { x: number; y: number } {
    const a = this.anchor();
    return { x: a.x + (x - this.pose.x) * this.pose.zoom, y: a.y + (y - this.pose.y) * this.pose.zoom };
  }

  /** Visible world rectangle (whole output, not just the content area). */
  visibleWorld(): Rect {
    const { width, height } = this.viewport;
    const { x, y, zoom } = this.pose;
    const a = this.anchor();
    return { x: x - a.x / zoom, y: y - a.y / zoom, w: width / zoom, h: height / zoom };
  }

  private target(sim: Simulation, alpha: number): CameraPose {
    const { focus, bounds } = sim.layout;
    const { content, width } = this.viewport;
    // Frame the focus region fully (fixed) or its width (following modes).
    const fitAll = Math.min((width - FRAME_MARGIN * 2) / focus.w, content.h / focus.h);
    const fitWidth = (width - FRAME_MARGIN * 2) / focus.w;
    const mode = this.options.mode;

    const centreOfFocus = { x: focus.x + focus.w / 2, y: focus.y + focus.h / 2, zoom: fitAll };
    const balls = sim.balls.filter((b) => b.active);
    if (mode === "leader-last" && !sim.rules.cameraFixed?.()) {
      const moment = sim.rules.cameraMoment?.() ?? "live";
      // Hold the shot for a result (the winner card covers the end).
      if ((moment === "hold" && sim.status === "running") || sim.status === "finished") return this.pose;
      const spot = this.spotlight;
      if (spot) {
        // A close-up on one ball, a little look-ahead down the course.
        const zoom = fitWidth * CLOSE_UP;
        const x = lerp(spot.ball.prevX, spot.ball.x, alpha);
        const y = lerp(spot.ball.prevY, spot.ball.y, alpha) + (sim.rules.progress ? (0.1 * content.h) / zoom : 0);
        return this.clamp({ x, y, zoom }, bounds);
      }
      // Setup (start box) or no race yet: the whole field, as a group.
      const group = boundsOf(balls.length ? balls : sim.balls, alpha);
      const pad = sim.ballRadius * 6;
      const fit = Math.min(width / (group.w + pad), content.h / (group.h + pad));
      const zoom = Math.min(fitWidth * MAX_ZOOM_FACTOR, Math.max(fitWidth, fit));
      return this.clamp({ x: group.x + group.w / 2, y: group.y + group.h / 2, zoom }, bounds);
    }
    if (mode === "fixed" || sim.rules.cameraFixed?.()) {
      // Whole map. When it fits the frame at full width, show all of it;
      // a tall track would shrink to a sliver with empty space either side,
      // so instead fill the width and scroll with the main group.
      if (focus.h * fitWidth <= content.h * 1.08) return centreOfFocus;
      const group = trimmed(balls, 0.15);
      const y = group.length ? boundsOf(group, alpha) : null;
      const cy = y ? y.y + y.h / 2 : sim.winner ? sim.winner.y : focus.y + focus.h / 2;
      return this.clamp({ x: focus.x + focus.w / 2, y: cy, zoom: fitWidth }, bounds);
    }

    const chosen = sim.rules.cameraSubjects?.();
    if (chosen && chosen.length === 0 && sim.status === "running") return this.pose;
    if (balls.length === 0) {
      const w = sim.winner;
      return w ? this.clamp({ x: focus.x + focus.w / 2, y: w.y, zoom: fitWidth }, bounds) : centreOfFocus;
    }

    let subject: CountryBall[];
    if (chosen?.length) {
      subject = mode === "follow-leader" ? chosen.slice(0, 1) : chosen;
    } else if (mode === "follow-leader") {
      const leader = sim.leader && sim.leader.active ? sim.leader : (sim.rules.rank().find((b) => b.active) ?? balls[0]);
      subject = leader ? [leader] : balls;
    } else if (mode === "follow-action") {
      const ranked = sim.rules.rank().filter((b) => b.active);
      subject = ranked.slice(0, Math.max(3, Math.ceil(ranked.length * (sim.rules.progress ? 0.1 : 0.2))));
    } else {
      subject = trimmed(balls, 0.1);
    }

    const box = boundsOf(subject, alpha);
    const cx = focus.x + focus.w / 2;
    let zoom = fitWidth;
    if (this.options.dynamicZoom && mode !== "follow-leader") {
      const pad = sim.ballRadius * 6;
      const fit = Math.min(width / (box.w + pad), content.h / (box.h + pad));
      zoom = Math.min(fitWidth * MAX_ZOOM_FACTOR, Math.max(fitWidth, fit));
    }
    // Races run downward. Following the leader, keep it a little below centre
    // so the chasers behind it are in shot; packs get a little look-ahead.
    const lookAhead = !sim.rules.progress ? 0 : ((mode === "follow-leader" ? -0.12 : 0.08) * content.h) / zoom;
    const x = zoom > fitWidth * 1.01 ? box.x + box.w / 2 : cx;
    let y = box.y + box.h / 2 + lookAhead;
    // Racing pack shots always keep the leader in frame, a little below centre.
    const lead = subject[0];
    if (mode === "follow-action" && sim.rules.progress && lead && !chosen?.length) {
      const halfH = content.h / 2 / zoom;
      const leadY = lerp(lead.prevY, lead.y, alpha);
      y = Math.min(leadY + halfH * 0.2, Math.max(leadY - halfH * 0.7, y));
    }
    return this.clamp({ x, y, zoom }, bounds);
  }

  /** Keep the world's edges inside the content area (no empty space inside it). */
  private clamp(pose: CameraPose, bounds: Rect): CameraPose {
    const halfW = this.viewport.width / 2 / pose.zoom;
    const halfH = this.viewport.content.h / 2 / pose.zoom;
    const x = clampRange(pose.x, bounds.x + halfW, bounds.x + bounds.w - halfW);
    const y = clampRange(pose.y, bounds.y + halfH, bounds.y + bounds.h - halfH);
    return { x, y, zoom: pose.zoom };
  }
}

function clampRange(value: number, min: number, max: number): number {
  if (min > max) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function boundsOf(balls: CountryBall[], alpha: number): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of balls) {
    const x = lerp(b.prevX, b.x, alpha);
    const y = lerp(b.prevY, b.y, alpha);
    minX = Math.min(minX, x - b.radius);
    minY = Math.min(minY, y - b.radius);
    maxX = Math.max(maxX, x + b.radius);
    maxY = Math.max(maxY, y + b.radius);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Drop the outer `fraction` on each side (by y) so stragglers don't widen the shot. */
function trimmed(balls: CountryBall[], fraction: number): CountryBall[] {
  if (balls.length < 6) return balls;
  const sorted = [...balls].sort((a, b) => a.y - b.y);
  const cut = Math.floor(sorted.length * fraction);
  return sorted.slice(cut, sorted.length - cut);
}
