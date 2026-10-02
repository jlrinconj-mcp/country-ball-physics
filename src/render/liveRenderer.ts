import type { Country } from "@/countries/countryTypes";
import type { CountryBall } from "@/entities/CountryBall";
import type { LiveView } from "@/live/session";
import { findMap } from "@/tracks/maps";
import type { FlagAtlas } from "./flagAtlas";
import { safeRect, type FormatSpec } from "./formats";
import { countryName, gameLabel, liveText, type Language } from "./i18n";
import { drawText, font } from "./text";
import type { RenderTheme } from "./theme";

/**
 * What the live mode adds to the picture: the lobby between games, viewer
 * names over their country's ball, boost flashes, the chat feed and the
 * points at the end. Presentation only.
 */
export interface LiveFrame {
  view: LiveView;
  countries: Map<string, Country>;
  /** Viewer names playing with a country in the current game. */
  team(cca3: string): string[];
  /** Simulated time (s) of each country's latest boost. */
  boosts: Map<string, number>;
}

const DANGER = "#ff6b61";
const BOOST = "#5ee7ff";
const FLASH_SECONDS = 0.6;

/** The lobby: how to join, the countdown, the vote, the teams, the top players. */
export function drawLobby(ctx: CanvasRenderingContext2D, live: LiveFrame, format: FormatSpec, theme: RenderTheme, atlas: FlagAtlas, lang: Language, now: number): void {
  const t = liveText(lang);
  const { view } = live;
  const safe = safeRect(format);
  const unit = Math.min(format.width, format.height) / 1080;
  const landscape = format.width > format.height;
  // Portrait: one centred column clear of the side buttons. Landscape: two.
  const side = Math.max(format.safe.left, format.safe.right);
  const left = landscape ? { x: safe.x, w: safe.w * 0.48 } : { x: side, w: format.width - 2 * side };
  const right = landscape ? { x: safe.x + safe.w * 0.52, w: safe.w * 0.48 } : left;
  const cx = (col: { x: number; w: number }) => col.x + col.w / 2;

  let y = safe.y + 30 * unit;
  drawText(ctx, t.game(view.game + 1), cx(left), y, { size: 30 * unit, color: theme.textMuted, letterSpacing: 4 * unit });
  y += 72 * unit;
  drawText(ctx, t.join, cx(left), y, { size: 74 * unit, weight: 900, color: theme.text, maxWidth: left.w, shadow: theme.textShadow });

  // How to join, in a panel.
  y += 40 * unit;
  const pulse = 1 + 0.03 * Math.sin(now * 5);
  panel(ctx, left.x, y, left.w, 210 * unit, 28 * unit, theme.panel, theme.accent);
  drawText(ctx, t.type, cx(left), y + 48 * unit, { size: 28 * unit, color: theme.textMuted, letterSpacing: 4 * unit });
  drawText(ctx, t.command, cx(left), y + 130 * unit, { size: 82 * unit * pulse, weight: 900, color: theme.accent, maxWidth: left.w - 40 * unit, shadow: theme.textShadow });
  drawText(ctx, t.example, cx(left), y + 182 * unit, { size: 30 * unit, color: theme.textMuted, maxWidth: left.w - 40 * unit });
  y += 210 * unit;

  // Countdown.
  y += 74 * unit;
  const seconds = Math.ceil(view.countdown);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  ctx.font = font(34 * unit, 800);
  const labelW = ctx.measureText(`${t.starts}  `).width;
  ctx.font = font(66 * unit, 900);
  const clockW = ctx.measureText(clock).width;
  const start = cx(left) - (labelW + clockW) / 2;
  drawText(ctx, `${t.starts}  `, start, y, { size: 34 * unit, color: theme.textMuted, align: "left" });
  drawText(ctx, clock, start + labelW, y + 8 * unit, { size: 66 * unit, weight: 900, color: seconds <= 5 ? DANGER : theme.accent, align: "left" });

  // The vote.
  y += 70 * unit;
  drawText(ctx, `${t.vote} · ${t.voteHint}`, cx(left), y, { size: 28 * unit, color: theme.textMuted, letterSpacing: 2 * unit, maxWidth: left.w });
  const most = Math.max(1, ...view.choices.map((c) => c.votes));
  for (const [i, choice] of view.choices.entries()) {
    y += 66 * unit;
    const row = { x: left.x, y: y - 40 * unit, w: left.w, h: 56 * unit };
    panel(ctx, row.x, row.y, row.w, row.h, 14 * unit, theme.panel);
    ctx.fillStyle = withAlpha(theme.accent, 0.28);
    ctx.fillRect(row.x, row.y, (row.w * choice.votes) / most, row.h);
    drawText(ctx, String(i + 1), row.x + 34 * unit, y, { size: 36 * unit, weight: 900, color: theme.accent });
    const label = gameLabel(choice.mode, choice.map, findMap(choice.map)?.label ?? choice.map, lang);
    drawText(ctx, label, row.x + 70 * unit, y, { size: 32 * unit, weight: 800, color: theme.text, align: "left", maxWidth: row.w - 160 * unit });
    drawText(ctx, String(choice.votes), row.x + row.w - 24 * unit, y, { size: 34 * unit, weight: 900, color: theme.text, align: "right" });
  }

  // Teams: a flag per country, with how many viewers play it.
  y = landscape ? safe.y + 30 * unit : y + 90 * unit;
  const players = view.teams.reduce((n, team) => n + team.users.length, 0);
  drawText(ctx, t.teams(players), cx(right), y, { size: 28 * unit, color: theme.textMuted, letterSpacing: 2 * unit, maxWidth: right.w });
  const icon = 32 * unit;
  const step = icon * 2 + 22 * unit;
  const perRow = Math.max(1, Math.floor(right.w / step));
  // As many rows as fit above the top players and the three feed lines (short formats
  // drop the top players first).
  const bottom = safe.y + safe.h - 150 * unit;
  const board = view.leaderboard.length > 0 ? (60 + view.leaderboard.length * 42) * unit : 0;
  const fit = (room: number) => Math.floor((room - 64 * unit) / (step + 10 * unit));
  const showBoard = fit(bottom - y - board) >= 1;
  const rows = Math.max(1, Math.min(landscape ? 4 : 3, fit(bottom - y - (showBoard ? board : 0))));
  const shown = view.teams.slice(0, perRow * rows);
  if (shown.length === 0) {
    drawText(ctx, t.noTeams, cx(right), y + 70 * unit, { size: 30 * unit, color: theme.textMuted, maxWidth: right.w });
  }
  shown.forEach((team, i) => {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, shown.length - row * perRow);
    const x = cx(right) - (inRow * step) / 2 + (i % perRow) * step + step / 2;
    const iy = y + 64 * unit + row * (step + 10 * unit);
    const country = live.countries.get(team.cca3);
    if (country) ctx.drawImage(atlas.get(country), x - icon, iy - icon, icon * 2, icon * 2);
    badge(ctx, String(team.users.length), x + icon * 0.8, iy + icon * 0.8, 15 * unit, theme);
  });
  y += 64 * unit + Math.min(rows, Math.ceil(shown.length / perRow) || 1) * (step + 10 * unit);

  // Top players.
  if (showBoard && view.leaderboard.length > 0) {
    drawText(ctx, t.top, cx(right), y, { size: 28 * unit, color: theme.textMuted, letterSpacing: 2 * unit });
    view.leaderboard.forEach((row, i) => {
      const ry = y + (48 + i * 42) * unit;
      drawText(ctx, `${i + 1}. ${row.name}`, right.x + 40 * unit, ry, { size: 30 * unit, weight: i === 0 ? 900 : 700, color: i === 0 ? theme.accent : theme.text, align: "left", maxWidth: right.w * 0.65 });
      drawText(ctx, `${row.points} ${t.pts}`, right.x + right.w - 40 * unit, ry, { size: 30 * unit, weight: 800, color: theme.text, align: "right" });
    });
  }

  drawFeed(ctx, live, safe.x + safe.w / 2, safe.y + safe.h - 20 * unit, unit, theme, lang, landscape ? safe.w : left.w);
}

/** In-game extras: the boost hint and the chat feed, at the bottom of the safe area. */
export function drawLiveHud(ctx: CanvasRenderingContext2D, live: LiveFrame, format: FormatSpec, theme: RenderTheme, lang: Language): void {
  const t = liveText(lang);
  const safe = safeRect(format);
  const unit = Math.min(format.width, format.height) / 1080;
  const side = Math.max(format.safe.left, format.safe.right);
  const width = format.width - 2 * side;
  const bottom = safe.y + safe.h - 16 * unit;
  if (live.view.phase === "playing") {
    drawText(ctx, t.boostHint, format.width / 2, bottom, { size: 30 * unit, weight: 800, color: BOOST, maxWidth: width, stroke: "rgba(0,0,0,0.6)", strokeWidth: 6 * unit });
    drawFeed(ctx, live, format.width / 2, bottom - 50 * unit, unit, theme, lang, width);
    return;
  }
  // Results: who won points, under the winner card.
  const last = live.view.lastGame;
  if (live.view.phase === "results" && last && last.winners.length > 0) {
    const names = last.winners.slice(0, 6).join("  ");
    const more = last.winners.length > 6 ? `  +${last.winners.length - 6}` : "";
    drawText(ctx, `🏆 ${names}${more}`, format.width / 2, bottom - 60 * unit, { size: 40 * unit, weight: 900, color: theme.accent, maxWidth: width });
    drawText(ctx, t.winners(last.points), format.width / 2, bottom, { size: 34 * unit, weight: 800, color: theme.text });
  }
}

/** A viewer tag over a ball ("ana", "ana +3") and a ring when it's boosted. */
export function drawBallExtras(ctx: CanvasRenderingContext2D, live: LiveFrame, ball: CountryBall, x: number, y: number, zoom: number, time: number, theme: RenderTheme): void {
  const boosted = live.boosts.get(ball.code);
  const age = boosted === undefined ? Infinity : time - boosted;
  if (age >= 0 && age < FLASH_SECONDS) {
    const k = age / FLASH_SECONDS;
    ctx.strokeStyle = withAlpha(BOOST, 1 - k);
    ctx.lineWidth = (5 * (1 - k) + 1) / zoom;
    ctx.beginPath();
    ctx.arc(x, y, ball.radius * (1.1 + k * 1.2), 0, Math.PI * 2);
    ctx.stroke();
  }
  const team = live.team(ball.code);
  if (team.length === 0) return;
  const size = Math.max(ball.radius * 0.6, 20 / zoom);
  const text = team.length > 1 ? `${team[0]} +${team.length - 1}` : (team[0] as string);
  drawText(ctx, text, x, y - ball.radius - size * 0.5, {
    size,
    weight: 900,
    color: theme.accent,
    stroke: "rgba(0,0,0,0.75)",
    strokeWidth: size * 0.22,
    maxWidth: Math.max(ball.radius * 5, 160 / zoom),
  });
}

function drawFeed(ctx: CanvasRenderingContext2D, live: LiveFrame, cx: number, bottom: number, unit: number, theme: RenderTheme, lang: Language, maxWidth: number): void {
  const t = liveText(lang);
  const name = (cca3: string) => {
    const country = live.countries.get(cca3);
    return country ? countryName(country, lang).toUpperCase() : cca3;
  };
  const lines = live.view.feed
    .filter((f) => f.kind !== "vote")
    .slice(-3)
    .map((f) => (f.kind === "boost" ? { text: `⚡ ${t.boosted(f.user, name(f.cca3))}`, color: BOOST } : f.kind === "join" ? { text: t.joined(f.user, name(f.cca3)), color: theme.text } : f.kind === "unknown" ? { text: t.unknown(f.user, f.query), color: theme.textMuted } : null))
    .filter((l): l is { text: string; color: string } => !!l);
  lines.reverse().forEach((line, i) => {
    drawText(ctx, line.text, cx, bottom - i * 40 * unit, { size: 28 * unit, weight: 800, color: line.color, maxWidth, stroke: "rgba(0,0,0,0.6)", strokeWidth: 5 * unit });
  });
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, edge?: string): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (edge) {
    ctx.strokeStyle = withAlpha(edge, 0.6);
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

function badge(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, r: number, theme: RenderTheme): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = theme.accent;
  ctx.fill();
  drawText(ctx, text, x, y + r * 0.38, { size: r * 1.15, weight: 900, color: "#111" });
}

function withAlpha(hex: string, alpha: number): string {
  if (!hex.startsWith("#") || hex.length !== 7) return hex;
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
