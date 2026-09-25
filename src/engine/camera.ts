import type { CountryBall } from "@/entities/CountryBall";
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
/** Side margin kept around the framed region, in output pixels. */
const FRAME_MARGIN = 28;

/**
 * Smooth camera. Targets come from the simulation state (leader, pack,
 * group), and the pose eases toward them with exponential damping measured in
 * real time, so framing is smooth at any frame rate and never affects physics.
 */
export class Camera {
  pose: CameraPose = { x: 0, y: 0, zoom: 1 };
  private viewport: Viewport = { width: 1080, height: 1920, content: { x: 0, y: 0, w: 1080, h: 1920 } };
  options: CameraOptions = { mode: "fixed", dynamicZoom: true };

  setViewport(viewport: Viewport): void {
    this.viewport = viewport;
  }

  getViewport(): Viewport {
    return this.viewport;
  }

  /** Jump straight to the target (new simulation, format change). */
  snap(sim: Simulation, alpha = 1): void {
    this.pose = this.target(sim, alpha);
  }

  update(sim: Simulation, alpha: number, dt: number): void {
    const target = this.target(sim, alpha);
    const kp = 1 - Math.exp(-POSITION_STIFFNESS * dt);
    const kz = 1 - Math.exp(-ZOOM_STIFFNESS * dt);
    this.pose = {
      x: this.pose.x + (target.x - this.pose.x) * kp,
      y: this.pose.y + (target.y - this.pose.y) * kp,
      zoom: this.pose.zoom + (target.zoom - this.pose.zoom) * kz,
    };
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
    if (mode === "fixed") return centreOfFocus;

    const balls = sim.balls.filter((b) => b.alive);
    if (balls.length === 0) {
      const w = sim.winner;
      return w ? this.clamp({ x: focus.x + focus.w / 2, y: w.y, zoom: fitWidth }, bounds) : centreOfFocus;
    }

    let subject: CountryBall[];
    if (mode === "follow-leader") {
      const leader = sim.leader && sim.leader.alive ? sim.leader : (sim.rules.rank().find((b) => b.alive) ?? balls[0]);
      subject = leader ? [leader] : balls;
    } else if (mode === "follow-action") {
      const ranked = sim.rules.rank().filter((b) => b.alive);
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
    if (mode === "follow-action" && sim.rules.progress && lead) {
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
