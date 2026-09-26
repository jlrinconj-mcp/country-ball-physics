import type { CountryBall } from "@/entities/CountryBall";
import { TICK_DT } from "@/engine/physicsWorld";
import type { Frame } from "./canvasRenderer";
import type { FlagAtlas } from "./flagAtlas";
import { safeRect, type FormatSpec } from "./formats";
import { drawText, font } from "./text";
import type { RenderTheme } from "./theme";

const FEED_SECONDS = 3.2;
const DANGER = "#ff6b61";

/**
 * Minimal on-canvas HUD, laid out inside the format's safe area. It is drawn
 * on the same canvas as the simulation so a captured video includes it.
 * Animations are driven by simulation time, so every replay looks the same.
 */
export function drawHud(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  format: FormatSpec,
  theme: RenderTheme,
  atlas: FlagAtlas,
): void {
  const { sim, display } = frame;
  const safe = safeRect(format);
  const width = format.width;
  const now = Math.max(0, (sim.tick - 1 + frame.alpha) * TICK_DT);
  const info = sim.rules.hud();
  const textWidth = width - 2 * Math.max(format.safe.left, format.safe.right);
  const unit = Math.min(width, format.height) / 1080;
  const shadow = theme.textShadow;

  if (sim.status === "finished" && sim.winner && sim.finishedTick !== null) {
    // The winner card owns the screen; the live HUD would only clash with it.
    drawWinner(ctx, sim.winner, now - sim.finishedTick * TICK_DT, format, unit, theme, atlas, sim.decidedBy, frame.overlay?.winnerTitle ?? "WINNER", frame.overlay?.status);
    return;
  }

  let y = safe.y + 8 * unit;
  const status = [frame.overlay?.status, info.status].filter(Boolean).join(" · ");
  if (status) {
    y += 34 * unit;
    drawText(ctx, status, width / 2, y, {
      size: 30 * unit,
      color: theme.textMuted,
      letterSpacing: 4 * unit,
      maxWidth: textWidth,
    });
  }

  y += 70 * unit;
  drawText(ctx, (display.headline || info.headline).toUpperCase(), width / 2, y, {
    size: 66 * unit,
    weight: 900,
    color: theme.text,
    maxWidth: textWidth,
    shadow,
  });

  y += 58 * unit;
  drawCounter(ctx, `${info.counterLabel}: `, String(info.counterValue), width / 2, y, 40 * unit, theme, textWidth);

  // One line under the counter: the latest event, otherwise the leader (or
  // whoever the mode calls out, e.g. the country in last place).
  const slotY = y + 54 * unit;
  const showedFeed = display.feed && sim.status !== "finished" && drawFeed(ctx, frame, width / 2, slotY, unit, theme, atlas, now, textWidth);
  if (!showedFeed && info.featured && sim.status === "running") {
    const { label, ball, tone } = info.featured;
    drawLeader(ctx, ball, width / 2, slotY, unit, theme, atlas, 0, `${label}  `, tone === "danger" ? DANGER : theme.text);
  } else if (!showedFeed && info.showLeader && sim.leader && sim.status === "running") {
    const pulse = Math.max(0, 1 - (now - frame.hud.leaderTick * TICK_DT) / 0.6);
    drawLeader(ctx, sim.leader, width / 2, slotY, unit, theme, atlas, pulse);
  }
  if (info.eliminated?.length && sim.status === "running") {
    drawEliminated(ctx, info.eliminated, width / 2, slotY + 44 * unit, unit, atlas, textWidth);
  }

  // Title cards and countdowns sit below the start line wherever the camera
  // puts it, so a close-up of the start box never ends up under the text.
  const line = startLineY(frame, safe);
  const below = (y: number, gap: number) => (line === null ? y : Math.min(safe.y + safe.h - gap, Math.max(y, line + gap)));
  const titleY = !info.title
    ? null
    : info.title.worldY !== undefined
      ? frame.camera.worldToScreen(0, info.title.worldY).y
      : below(safe.y + safe.h * 0.68, 110 * unit);
  if (info.title && titleY !== null) drawTitle(ctx, info.title, titleY, format, unit, theme);
  if (info.banner) {
    // Under a title card the countdown moves down out of its way.
    const bannerY = titleY !== null ? Math.max(safe.y + safe.h * 0.86, titleY + 230 * unit) : below(safe.y + safe.h * 0.55, 250 * unit);
    drawBanner(ctx, info.banner, format, unit, theme, now, Math.min(bannerY, safe.y + safe.h - 90 * unit));
  }

  // Timer, top-left of the safe area.
  const clock = sim.finishedTick !== null ? sim.finishedTick * TICK_DT : now;
  drawText(ctx, formatTime(clock), safe.x + 6 * unit, safe.y - 14 * unit, {
    size: 30 * unit,
    weight: 700,
    color: theme.textMuted,
    align: "left",
  });

  if (display.ranking && sim.status !== "finished") {
    drawRanking(ctx, sim.rules.rank().slice(0, 5), safe.x + 8 * unit, y + 70 * unit, unit, theme, atlas);
  }


}

function drawCounter(
  ctx: CanvasRenderingContext2D,
  label: string,
  value: string,
  cx: number,
  y: number,
  size: number,
  theme: RenderTheme,
  maxWidth: number,
): void {
  ctx.font = font(size, 800);
  const labelW = ctx.measureText(label).width;
  const valueW = ctx.measureText(value).width;
  const scale = Math.min(1, maxWidth / (labelW + valueW));
  const s = size * scale;
  const total = (labelW + valueW) * scale;
  const left = cx - total / 2;
  drawText(ctx, label, left, y, { size: s, color: theme.textMuted, align: "left" });
  drawText(ctx, value, left + labelW * scale, y, { size: s, weight: 900, color: theme.accent, align: "left" });
}

function drawBallIcon(
  ctx: CanvasRenderingContext2D,
  atlas: FlagAtlas,
  ball: CountryBall,
  x: number,
  y: number,
  radius: number,
): void {
  ctx.drawImage(atlas.get(ball.country), x - radius, y - radius, radius * 2, radius * 2);
}

function drawLeader(
  ctx: CanvasRenderingContext2D,
  leader: CountryBall,
  cx: number,
  y: number,
  unit: number,
  theme: RenderTheme,
  atlas: FlagAtlas,
  pulse: number,
  label = "LEADER  ",
  color = theme.text,
): void {
  const size = 36 * unit;
  const text = leader.name.toUpperCase();
  ctx.font = font(size, 900);
  const labelW = ctx.measureText(label).width;
  const textW = Math.min(ctx.measureText(text).width, 560 * unit);
  const icon = 26 * unit * (1 + pulse * 0.25);
  const total = labelW + icon * 2 + 14 * unit + textW;
  let x = cx - total / 2;
  drawText(ctx, label, x, y, { size, weight: 700, color: theme.textMuted, align: "left" });
  x += labelW;
  drawBallIcon(ctx, atlas, leader, x + icon, y - size * 0.34, icon);
  x += icon * 2 + 14 * unit;
  drawText(ctx, text, x, y, { size, weight: 900, color, align: "left", maxWidth: 560 * unit });
}

/** "OUT" and a row of the latest eliminated flags, most recent first. */
function drawEliminated(
  ctx: CanvasRenderingContext2D,
  balls: CountryBall[],
  cx: number,
  y: number,
  unit: number,
  atlas: FlagAtlas,
  maxWidth: number,
): void {
  const icon = 15 * unit;
  const step = icon * 2 + 8 * unit;
  const label = `OUT ${balls.length}`;
  const size = 24 * unit;
  ctx.font = font(size, 800);
  const labelW = ctx.measureText(label).width + 14 * unit;
  const shown = balls.slice(0, Math.max(1, Math.min(10, Math.floor((maxWidth - labelW) / step))));
  const total = labelW + shown.length * step;
  let x = cx - total / 2;
  drawText(ctx, label, x, y + size * 0.36, { size, color: DANGER, align: "left", letterSpacing: 2 * unit });
  x += labelW;
  shown.forEach((ball, i) => {
    ctx.globalAlpha = Math.max(0.35, 1 - i * 0.07);
    drawBallIcon(ctx, atlas, ball, x + icon, y, icon);
    // Strike-through: out of the game.
    ctx.strokeStyle = DANGER;
    ctx.lineWidth = 3 * unit;
    ctx.beginPath();
    ctx.moveTo(x + icon * 0.35, y + icon * 0.65);
    ctx.lineTo(x + icon * 1.65, y - icon * 0.65);
    ctx.stroke();
    x += step;
  });
  ctx.globalAlpha = 1;
}

/** Title card ("32 COUNTRIES" / "LAST PLACE IS ELIMINATED", "FINAL 3"). */
/** Screen y of the start line (track modes) when it's inside the safe area. */
function startLineY(frame: Frame, safe: { y: number; h: number }): number | null {
  const startY = frame.sim.layout.startY;
  if (startY === undefined) return null;
  // The gate (22 px thick) sits just below the spawn box; measure under it.
  const y = frame.camera.worldToScreen(0, startY + 40).y;
  return y >= safe.y && y <= safe.y + safe.h ? y : null;
}

function drawTitle(ctx: CanvasRenderingContext2D, title: { text: string; sub?: string }, y: number, format: FormatSpec, unit: number, theme: RenderTheme): void {
  const safe = safeRect(format);
  drawText(ctx, title.text, format.width / 2, y, {
    size: 120 * unit,
    weight: 900,
    color: theme.text,
    maxWidth: safe.w - 40 * unit,
    shadow: theme.textShadow,
    stroke: theme.id === "midnight" ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.75)",
    strokeWidth: 10 * unit,
  });
  if (title.sub) {
    drawText(ctx, title.sub, format.width / 2, y + 78 * unit, {
      size: 46 * unit,
      weight: 900,
      color: DANGER,
      maxWidth: safe.w - 40 * unit,
      letterSpacing: 3 * unit,
      stroke: theme.id === "midnight" ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.8)",
      strokeWidth: 8 * unit,
    });
  }
}

function drawRanking(
  ctx: CanvasRenderingContext2D,
  balls: CountryBall[],
  x: number,
  y: number,
  unit: number,
  theme: RenderTheme,
  atlas: FlagAtlas,
): void {
  const row = 50 * unit;
  balls.forEach((ball, i) => {
    const cy = y + i * row;
    drawText(ctx, `${i + 1}`, x + 14 * unit, cy + 11 * unit, { size: 28 * unit, color: theme.textMuted });
    drawBallIcon(ctx, atlas, ball, x + 52 * unit, cy, 19 * unit);
    drawText(ctx, ball.name.toUpperCase(), x + 82 * unit, cy + 11 * unit, {
      size: 28 * unit,
      color: theme.text,
      align: "left",
      maxWidth: 300 * unit,
      stroke: theme.textShadow,
      strokeWidth: 6 * unit,
    });
  });
}

/** Latest event as one short line under the counter, fading out. */
function drawFeed(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  cx: number,
  y: number,
  unit: number,
  theme: RenderTheme,
  atlas: FlagAtlas,
  now: number,
  maxWidth: number,
): boolean {
  const item = frame.hud.feed.findLast((f) => f.kind !== "leader");
  if (!item) return false;
  const age = now - item.tick * TICK_DT;
  if (age < 0 || age > FEED_SECONDS) return false;
  const size = 32 * unit;
  const text = `${item.ball.name.toUpperCase()} ${item.kind === "finished" ? `FINISHED #${item.ball.place}` : "IS OUT"}`;
  ctx.font = font(size, 800);
  const textW = Math.min(ctx.measureText(text).width, maxWidth - 60 * unit);
  const icon = 18 * unit;
  const left = cx - (textW + icon * 2 + 12 * unit) / 2;
  ctx.globalAlpha = Math.max(0, Math.min(1, age / 0.12, (FEED_SECONDS - age) / 0.5));
  drawBallIcon(ctx, atlas, item.ball, left + icon, y - size * 0.34, icon);
  drawText(ctx, text, left + icon * 2 + 12 * unit, y, {
    size,
    color: item.kind === "finished" ? theme.accent : "#ff8a80",
    align: "left",
    maxWidth: maxWidth - 60 * unit,
  });
  ctx.globalAlpha = 1;
  return true;
}

/** Big centred text (countdown, "GO!"): pops in at the start of each second. */
function drawBanner(ctx: CanvasRenderingContext2D, text: string, format: FormatSpec, unit: number, theme: RenderTheme, now: number, y: number): void {
  const safe = safeRect(format);
  const phase = now % 1;
  const scale = 1 + Math.max(0, 0.25 - phase) * 1.6;
  ctx.globalAlpha = Math.min(1, 0.35 + (1 - phase));
  drawText(ctx, text, format.width / 2, y, {
    maxWidth: safe.w,
    size: 220 * unit * scale,
    weight: 900,
    color: theme.accent,
    shadow: theme.textShadow,
    stroke: theme.id === "midnight" ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.7)",
    strokeWidth: 14 * unit,
  });
  ctx.globalAlpha = 1;
}

function drawWinner(
  ctx: CanvasRenderingContext2D,
  winner: CountryBall,
  since: number,
  format: FormatSpec,
  unit: number,
  theme: RenderTheme,
  atlas: FlagAtlas,
  decidedBy: string,
  title: string,
  context?: string,
): void {
  const { width, height } = format;
  const safe = safeRect(format);
  const t = Math.max(0, since);
  ctx.fillStyle = theme.id === "midnight" ? "rgba(5,8,15,1)" : "rgba(243,239,230,1)";
  ctx.globalAlpha = Math.min(0.72, t * 1.8);
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = Math.min(1, t * 3);

  const cy = safe.y + safe.h * 0.45;
  const size = Math.min(safe.w, safe.h) * (format.width > format.height ? 0.2 : 0.24);
  const radius = size * easeOutBack(Math.min(1, t / 0.7));
  if (radius > 1) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 40 * unit;
    drawBallIcon(ctx, atlas, winner, width / 2, cy, radius);
    ctx.restore();
  }
  const full = size;
  if (context) {
    drawText(ctx, context, width / 2, cy - full - 110 * unit, { size: 30 * unit, color: theme.textMuted, letterSpacing: 4 * unit });
  }
  drawText(ctx, title, width / 2, cy - full - 44 * unit, {
    size: 54 * unit,
    weight: 900,
    color: theme.accent,
    letterSpacing: 10 * unit,
  });
  drawText(ctx, `${winner.name.toUpperCase()} WINS`, width / 2, cy + full + 110 * unit, {
    size: 92 * unit,
    weight: 900,
    color: theme.text,
    maxWidth: safe.w,
    shadow: theme.textShadow,
  });
  if (decidedBy === "timeout") {
    drawText(ctx, "DECIDED AT THE TIME LIMIT", width / 2, cy + full + 170 * unit, {
      size: 28 * unit,
      color: theme.textMuted,
      letterSpacing: 3 * unit,
    });
  }
  ctx.globalAlpha = 1;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
