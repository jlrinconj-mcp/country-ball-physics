import type { CameraMode } from "@/engine/simulation";
import type { VideoFormat } from "./formats";
import type { ThemeId } from "./theme";

export type LabelMode = "none" | "code" | "name";

/** Presentation-only settings. Changing these never changes a result. */
export interface DisplayOptions {
  format: VideoFormat;
  theme: ThemeId;
  camera: CameraMode;
  dynamicZoom: boolean;
  labels: LabelMode;
  /** Classic countryball eyes that look where the ball is going. */
  eyes: boolean;
  hud: boolean;
  ranking: boolean;
  feed: boolean;
  safeArea: boolean;
  /** Custom headline; empty uses the mode's default. */
  headline: string;
  /** Playback speed multiplier (simulation ticks stay fixed). */
  speed: number;
  audio: boolean;
  volume: number;
}

export const DEFAULT_DISPLAY: DisplayOptions = {
  format: "9:16",
  theme: "midnight",
  camera: "fixed",
  dynamicZoom: true,
  labels: "code",
  eyes: false,
  hud: true,
  ranking: false,
  feed: true,
  safeArea: false,
  headline: "",
  speed: 1,
  audio: false,
  volume: 0.6,
};
