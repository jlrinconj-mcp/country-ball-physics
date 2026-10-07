import type { ContentMetadata } from "@/content/metadata";
import type { SimulationConfig } from "@/engine/types";
import type { DisplayOptions } from "@/render/displayOptions";
import type { TournamentSummary } from "@/modes/tournament";
import type { SimulationResult } from "@/engine/simulation";

export const VIDEO_FPS = 30;
export const MAX_VIDEO_SECONDS = 120;
// Leave room for AAC packet/container rounding; never expose a file above 120 s.
export const PART_SECONDS = MAX_VIDEO_SECONDS - 1;

export interface ExportRequest {
  config: SimulationConfig;
  display: DisplayOptions;
}

export interface RecordingPosition {
  tick: number;
  heatSeed: string;
  heatTick: number;
}

export interface VideoPart {
  number: number;
  file: string;
  frames: number;
  duration: number;
  start: RecordingPosition;
  end: RecordingPosition;
  metadata?: ContentMetadata;
}

export interface VideoExport {
  id: string;
  createdAt: string;
  status: "queued" | "recording" | "paused" | "complete" | "failed";
  request: ExportRequest;
  frames: number;
  parts: VideoPart[];
  metadata: ContentMetadata | null;
  results: SimulationResult[];
  tournament: TournamentSummary | null;
  fingerprint: string | null;
  error: string | null;
  /** Local encoder PID, used only to detect an interrupted server/worker. */
  workerPid?: number;
}

/** The UI depends on an export contract, not on platform credentials. */
export interface VideoExportAdapter {
  create(request: ExportRequest): Promise<VideoExport>;
  get(id: string, signal?: AbortSignal): Promise<VideoExport>;
  setPaused(id: string, paused: boolean): Promise<VideoExport>;
  delete(id: string): Promise<void>;
}

/** Extension points only. The manual workflow never calls a publisher. */
export interface UploadAdapter {
  upload(video: VideoExport, part: VideoPart): Promise<{ url: string }>;
}

export interface BroadcastAdapter {
  start(stream: MediaStream): Promise<void>;
  stop(): Promise<void>;
}
