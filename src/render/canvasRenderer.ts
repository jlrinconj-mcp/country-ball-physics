import type { CountryBall } from "@/entities/CountryBall";
import type { Obstacle, RenderShape } from "@/entities/Obstacle";
import type { Zone } from "@/entities/Zone";
import type { Camera } from "@/engine/camera";
import { GHOST_LIFETIME, type Simulation } from "@/engine/simulation";
import type { Rect } from "@/engine/types";
import type { DisplayOptions } from "./displayOptions";
import type { FlagAtlas } from "./flagAtlas";
import { FORMATS, safeRect } from "./formats";
import { drawHud } from "./hudRenderer";
import type { HudTracker } from "./hudTracker";
import { drawText } from "./text";
import { THEMES, type RenderTheme } from "./theme";

export interface Frame {
  sim: Simulation;
  camera: Camera;
  /** Interpolation factor between the previous and current tick, 0..1. */
  alpha: number;
  display: DisplayOptions;
  hud: HudTracker;
  /** Context from outside the simulation (e.g. tournament round). */
  overlay?: HudOverlay;
}

export interface HudOverlay {
  /** Extra status line, e.g. "QUARTER-FINALS · HEAT 2/4". */
  status?: string;
  /** Label above the winner, e.g. "CHAMPION". Defaults to "WINNER". */
  winnerTitle?: string;
}

/**
 * Draws a simulation onto a 2D canvas. Everything is expressed in the output
 * format's virtual pixels (e.g. 1080×1920) and scaled to the backing store,
 * so the preview and a full-resolution export look identical.
 */
export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly atlas: FlagAtlas,
  ) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D is not supported");
    this.ctx = ctx;
  }

  render(frame: Frame): void {
    const { display, camera } = frame;
    const format = FORMATS[display.format];
    const theme = THEMES[display.theme];
    const ctx = this.ctx;
    const scale = this.canvas.width / format.width;

    this.atlas.setStyle({ border: theme.ballBorder, borderRatio: 0.045, shading: true });
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = true;
    this.drawBackground(format.width, format.height, theme);

    const view = camera.visibleWorld();
    const anchor = camera.anchor();
    const { x, y, zoom } = camera.pose;
    ctx.save();
    ctx.translate(anchor.x, anchor.y);
    ctx.scale(zoom, zoom);
    ctx.translate(-x, -y);

    this.drawGrid(view, theme);
    for (const zone of frame.sim.zones) this.drawZone(zone, theme);
    for (const obstacle of frame.sim.obstacles) this.drawObstacle(obstacle, frame.alpha, theme);
    this.drawBalls(frame, view, theme);

    ctx.restore();

    if (display.hud) {
      this.drawScrim(format.width, camera.getViewport().content.y + 40, theme);
      drawHud(ctx, frame, format, theme, this.atlas);
    }
    if (display.safeArea) this.drawSafeArea(format.width, format.height, safeRect(format));
  }

  private drawBackground(width: number, height: number, theme: RenderTheme): void {
    const ctx = this.ctx;
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, width, height);
    const glow = ctx.createRadialGradient(width / 2, height * 0.42, 0, width / 2, height * 0.42, Math.max(width, height) * 0.7);
    glow.addColorStop(0, theme.backgroundGlow);
    glow.addColorStop(1, theme.background);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
  }

  /** Soft fade behind the HUD so text stays readable over moving scenery. */
  private drawScrim(width: number, height: number, theme: RenderTheme): void {
    const ctx = this.ctx;
    const scrim = ctx.createLinearGradient(0, 0, 0, height);
    scrim.addColorStop(0, withAlpha(theme.background, 0.92));
    scrim.addColorStop(0.7, withAlpha(theme.background, 0.7));
    scrim.addColorStop(1, withAlpha(theme.background, 0));
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, width, height);
  }

  private drawGrid(view: Rect, theme: RenderTheme): void {
    const ctx = this.ctx;
    const step = 120;
    ctx.beginPath();
    for (let gx = Math.floor(view.x / step) * step; gx <= view.x + view.w; gx += step) {
      ctx.moveTo(gx, view.y);
      ctx.lineTo(gx, view.y + view.h);
    }
    for (let gy = Math.floor(view.y / step) * step; gy <= view.y + view.h; gy += step) {
      ctx.moveTo(view.x, gy);
      ctx.lineTo(view.x + view.w, gy);
    }
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  private drawZone(zone: Zone, theme: RenderTheme): void {
    const { shape, visible, kind } = zone.spec;
    if (!visible || shape.kind !== "rect") return;
    const ctx = this.ctx;
    if (kind === "eliminate" || kind === "safe") {
      const edge = kind === "safe" ? theme.safeEdge : theme.eliminateEdge;
      ctx.fillStyle = kind === "safe" ? theme.safeZone : theme.eliminateZone;
      ctx.fillRect(shape.x, shape.y, shape.w, shape.h);
      ctx.fillStyle = edge;
      ctx.fillRect(shape.x, shape.y + shape.h - 12, shape.w, 12);
      drawMark(ctx, kind === "safe", shape.x + shape.w / 2, shape.y + shape.h - 44, Math.min(22, shape.w * 0.16), edge);
      return;
    }
    // Finish: checkered band.
    const cell = 24;
    const rows = Math.max(1, Math.round(Math.min(shape.h, cell * 2) / cell));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c * cell < shape.w; c++) {
        ctx.fillStyle = (r + c) % 2 ? "#111111" : "#ffffff";
        ctx.fillRect(shape.x + c * cell, shape.y + r * cell, Math.min(cell, shape.w - c * cell), cell);
      }
    }
  }

  private drawObstacle(obstacle: Obstacle, alpha: number, theme: RenderTheme): void {
    const ctx = this.ctx;
    const x = lerp(obstacle.prevX, obstacle.x, alpha);
    const y = lerp(obstacle.prevY, obstacle.y, alpha);
    const angle = lerp(obstacle.prevAngle, obstacle.angle, alpha) - obstacle.baseAngle;
    const color = theme.obstacles[obstacle.style];
    ctx.save();
    ctx.translate(x, y);
    if (angle !== 0) ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    for (const shape of obstacle.renderShapes) this.drawShape(shape);
    if (obstacle.style === "wheel" || obstacle.style === "spinner" || obstacle.style === "bumper") {
      this.drawHub(obstacle, theme);
    }
    ctx.restore();
  }

  private drawShape(shape: RenderShape): void {
    const ctx = this.ctx;
    switch (shape.kind) {
      case "poly": {
        ctx.beginPath();
        shape.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "circle":
        ctx.beginPath();
        ctx.arc(shape.x, shape.y, shape.r, 0, Math.PI * 2);
        ctx.fill();
        break;
      case "arc":
        ctx.beginPath();
        ctx.arc(shape.x, shape.y, shape.radius + shape.thickness / 2, shape.start, shape.end);
        ctx.lineWidth = shape.thickness;
        ctx.lineCap = "round";
        ctx.stroke();
        break;
    }
  }

  /** Small marks that make rotation visible on round obstacles. */
  private drawHub(obstacle: Obstacle, theme: RenderTheme): void {
    const ctx = this.ctx;
    ctx.fillStyle = theme.background;
    for (const shape of obstacle.renderShapes) {
      if (shape.kind !== "circle") continue;
      ctx.beginPath();
      ctx.arc(shape.x, shape.y, shape.r * 0.28, 0, Math.PI * 2);
      ctx.fill();
      if (obstacle.style === "wheel") {
        ctx.fillRect(shape.x - shape.r * 0.08, shape.y - shape.r * 0.9, shape.r * 0.16, shape.r * 0.5);
      }
    }
  }

  private drawBalls(frame: Frame, view: Rect, theme: RenderTheme): void {
    const ctx = this.ctx;
    const { alpha, display, camera } = frame;
    const onScreenRadius = frame.sim.ballRadius * camera.pose.zoom;
    const showLabels = display.labels !== "none" && onScreenRadius >= 18;

    for (const ball of frame.sim.balls) {
      const ghost = ball.ghost;
      if (!ball.alive && !ghost) continue;
      const x = lerp(ball.prevX, ball.x, alpha);
      const y = lerp(ball.prevY, ball.y, alpha);
      const r = ball.radius;
      if (x + r < view.x || x - r > view.x + view.w || y + r < view.y || y - r > view.y + view.h) continue;

      const fade = ghost ? Math.max(0, 1 - ghost.age / GHOST_LIFETIME) : 1;
      if (fade <= 0) continue;
      ctx.globalAlpha = fade;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(lerp(ball.prevAngle, ball.angle, alpha));
      ctx.drawImage(this.atlas.get(ball.country), -r, -r, r * 2, r * 2);
      ctx.restore();
      if (display.eyes) this.drawEyes(ball, x, y);
      ctx.globalAlpha = 1;
    }

    // Labels in a second pass so neighbouring balls never cover them.
    if (!showLabels) return;
    for (const ball of frame.sim.balls) {
      if (!ball.alive) continue;
      const x = lerp(ball.prevX, ball.x, alpha);
      const y = lerp(ball.prevY, ball.y, alpha);
      if (x < view.x || x > view.x + view.w || y < view.y || y > view.y + view.h) continue;
      this.drawLabel(ball, x, y, display.labels === "name", theme);
    }
  }

  private drawEyes(ball: CountryBall, x: number, y: number): void {
    const ctx = this.ctx;
    const r = ball.radius;
    const vx = ball.ghost ? ball.ghost.vx : ball.vx;
    const vy = ball.ghost ? ball.ghost.vy : ball.vy;
    const speed = Math.hypot(vx, vy);
    const lx = speed > 0.3 ? vx / speed : 0;
    const ly = speed > 0.3 ? vy / speed : 0;
    for (const side of [-1, 1]) {
      const ex = x + side * r * 0.32 + lx * r * 0.1;
      const ey = y - r * 0.15 + ly * r * 0.08;
      ctx.beginPath();
      ctx.ellipse(ex, ey, r * 0.2, r * 0.26, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = r * 0.05;
      ctx.strokeStyle = "#0b0f19";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ex + lx * r * 0.08, ey + ly * r * 0.1, r * 0.09, 0, Math.PI * 2);
      ctx.fillStyle = "#0b0f19";
      ctx.fill();
    }
  }

  private drawLabel(ball: CountryBall, x: number, y: number, fullName: boolean, theme: RenderTheme): void {
    const size = Math.min(30, Math.max(12, ball.radius * 0.55));
    const text = fullName ? ball.name.toUpperCase() : ball.country.cca3;
    drawText(this.ctx, text, x, y + ball.radius + size * 0.95, {
      size,
      weight: 800,
      color: theme.text,
      stroke: theme.id === "midnight" ? "rgba(0,0,0,0.75)" : "rgba(255,255,255,0.85)",
      strokeWidth: size * 0.22,
      maxWidth: fullName ? ball.radius * 4 : undefined,
    });
  }

  private drawSafeArea(width: number, height: number, safe: Rect): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = "rgba(255,40,90,0.14)";
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.rect(safe.x, safe.y, safe.w, safe.h);
    ctx.fill("evenodd");
    ctx.setLineDash([14, 10]);
    ctx.strokeStyle = "rgba(255,40,90,0.8)";
    ctx.lineWidth = 3;
    ctx.strokeRect(safe.x, safe.y, safe.w, safe.h);
    ctx.restore();
  }
}

/** Vector ✓ / ✕ (font-independent). */
function drawMark(ctx: CanvasRenderingContext2D, check: boolean, x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.38;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (check) {
    ctx.moveTo(x - size, y);
    ctx.lineTo(x - size * 0.25, y + size * 0.75);
    ctx.lineTo(x + size, y - size * 0.7);
  } else {
    ctx.moveTo(x - size * 0.75, y - size * 0.75);
    ctx.lineTo(x + size * 0.75, y + size * 0.75);
    ctx.moveTo(x + size * 0.75, y - size * 0.75);
    ctx.lineTo(x - size * 0.75, y + size * 0.75);
  }
  ctx.stroke();
  ctx.restore();
}

/** "#rrggbb" + alpha → rgba(). */
function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
