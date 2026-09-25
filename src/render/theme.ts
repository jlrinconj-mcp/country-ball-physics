import type { ObstacleStyle } from "@/engine/types";

export type ThemeId = "midnight" | "paper";

export interface RenderTheme {
  id: ThemeId;
  label: string;
  background: string;
  backgroundGlow: string;
  grid: string;
  text: string;
  textMuted: string;
  textShadow: string;
  panel: string;
  ballBorder: string;
  eliminateZone: string;
  eliminateEdge: string;
  safeZone: string;
  safeEdge: string;
  accent: string;
  obstacles: Record<ObstacleStyle, string>;
}

export const THEMES: Record<ThemeId, RenderTheme> = {
  midnight: {
    id: "midnight",
    label: "Midnight",
    background: "#0d1220",
    backgroundGlow: "#1a2440",
    grid: "rgba(255,255,255,0.035)",
    text: "#ffffff",
    textMuted: "rgba(255,255,255,0.72)",
    textShadow: "rgba(0,0,0,0.55)",
    panel: "rgba(8,11,20,0.72)",
    ballBorder: "#070a12",
    eliminateZone: "rgba(255,84,84,0.2)",
    eliminateEdge: "#ff5a5a",
    safeZone: "rgba(64,214,132,0.24)",
    safeEdge: "#40d684",
    accent: "#ffd23f",
    obstacles: {
      wall: "#dfe6f3",
      ring: "#f4f6fb",
      platform: "#dfe6f3",
      ramp: "#dfe6f3",
      peg: "#9fb4d9",
      bumper: "#ff6b6b",
      spinner: "#ffd23f",
      wheel: "#5cc8ff",
      funnel: "#dfe6f3",
      tunnel: "#7f8db0",
      gate: "#ff9f43",
    },
  },
  paper: {
    id: "paper",
    label: "Paper",
    background: "#f3efe6",
    backgroundGlow: "#fffaf0",
    grid: "rgba(20,24,35,0.05)",
    text: "#10131a",
    textMuted: "rgba(16,19,26,0.7)",
    textShadow: "rgba(255,255,255,0.6)",
    panel: "rgba(255,255,255,0.8)",
    ballBorder: "#10131a",
    eliminateZone: "rgba(220,50,50,0.12)",
    eliminateEdge: "#d93b3b",
    safeZone: "rgba(30,160,90,0.14)",
    safeEdge: "#1ea05a",
    accent: "#e03e2f",
    obstacles: {
      wall: "#1d2433",
      ring: "#1d2433",
      platform: "#1d2433",
      ramp: "#1d2433",
      peg: "#56607a",
      bumper: "#e03e2f",
      spinner: "#f0a202",
      wheel: "#1f7ae0",
      funnel: "#1d2433",
      tunnel: "#8a93a8",
      gate: "#f07b20",
    },
  },
};
