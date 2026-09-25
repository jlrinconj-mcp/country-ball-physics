import type { Rect } from "@/engine/types";

export type VideoFormat = "9:16" | "16:9" | "1:1" | "4:5";

export interface FormatSpec {
  id: VideoFormat;
  label: string;
  /** Target output resolution; also the renderer's virtual coordinate space. */
  width: number;
  height: number;
  /**
   * Margins where platform UI (buttons, captions, profile, progress bar) sits
   * on top of the video, in output pixels. Important information stays out.
   */
  safe: { top: number; right: number; bottom: number; left: number };
}

export const FORMATS: Record<VideoFormat, FormatSpec> = {
  // Union of TikTok, Reels and Shorts overlays at 1080×1920.
  "9:16": {
    id: "9:16",
    label: "9:16 · Shorts / Reels / TikTok",
    width: 1080,
    height: 1920,
    safe: { top: 220, right: 170, bottom: 440, left: 60 },
  },
  "4:5": {
    id: "4:5",
    label: "4:5 · Instagram feed",
    width: 1080,
    height: 1350,
    safe: { top: 70, right: 70, bottom: 110, left: 70 },
  },
  "1:1": {
    id: "1:1",
    label: "1:1 · Square",
    width: 1080,
    height: 1080,
    safe: { top: 60, right: 60, bottom: 60, left: 60 },
  },
  "16:9": {
    id: "16:9",
    label: "16:9 · YouTube",
    width: 1920,
    height: 1080,
    safe: { top: 60, right: 100, bottom: 90, left: 100 },
  },
};

export function safeRect(format: FormatSpec): Rect {
  const { safe, width, height } = format;
  return {
    x: safe.left,
    y: safe.top,
    w: width - safe.left - safe.right,
    h: height - safe.top - safe.bottom,
  };
}
