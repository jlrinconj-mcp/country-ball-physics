import type { GenerateRequest } from "../../src/content/plan";
import type { VideoFormat } from "../../src/render/formats";

export const RETENTION_MS = 24 * 60 * 60 * 1000;
export const OWNER = "bolworld-video-pipeline-v1";
export type Platform = "tiktok" | "instagram" | "facebook";

export interface VariantSpec {
  id: string;
  hook: string;
  caption: string;
  playbackRate?: number;
  format?: VideoFormat;
  audio?: "original" | "muted";
  /** Optional ISO date; publishing starts only after this time. */
  publishAt?: string;
  destinations: Platform[];
}

export interface JobSpec {
  source: GenerateRequest & { headline?: string };
  variants: VariantSpec[];
  /** Lower resolution for a local smoke test, not a production preset. */
  renderScale?: number;
}

export interface Artifact {
  path: string;
  kind: "video" | "scratch" | "overlay";
  dev: number;
  ino: number;
  birthtimeMs: number;
  size?: number;
  sha256?: string;
  generatedAt?: string;
  deletedAt?: string;
  deletionPendingAt?: string;
}

export interface Delivery {
  platform: Platform;
  account: string;
  state: "pending" | "working" | "confirming" | "confirmed" | "failed" | "uncertain";
  /** Save each stage before/after a network side effect. Never save access tokens. */
  ticket: Record<string, string>;
  attempts: number;
  nextAttemptAt?: string;
  error?: string;
  remoteId?: string;
  remoteUrl?: string;
  confirmedAt?: string;
  confirmedSha256?: string;
}

export interface Variant {
  spec: VariantSpec;
  file: string;
  generatedAt?: string;
  validatedAt?: string;
  duration?: number;
  deliveries: Delivery[];
}

export interface Job {
  owner: typeof OWNER;
  version: 1;
  id: string;
  createdAt: string;
  state: "queued" | "generating" | "delivering" | "retained" | "deleted" | "generation_failed";
  spec: JobSpec;
  artifacts: Artifact[];
  variants: Variant[];
  generationCompleteAt?: string;
  deleteAfter?: string;
  error?: string;
}

export interface PublishContext {
  file: string;
  artifact: Artifact;
  variant: Variant;
  delivery: Delivery;
  checkpoint: () => Promise<void>;
}

export interface Confirmation { id: string; url?: string }
export interface Publisher {
  /** Return null while processing. Throw on failure; preserve the ticket for recovery. */
  advance(context: PublishContext): Promise<Confirmation | null>;
}

export class UncertainPublication extends Error {}

export function validateSpec(input: unknown): JobSpec {
  const spec = input as JobSpec;
  if (!spec?.source || !["race", "marble-race", "last-country-standing", "last-place-elimination", "elimination-drop", "tournament", "random"].includes(spec.source.mode)) {
    throw new Error("Source must use an existing simulation mode");
  }
  if (spec.source.seed !== undefined && (typeof spec.source.seed !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(spec.source.seed))) throw new Error("Unsafe source seed");
  if (spec.source.format && spec.source.format !== "9:16") throw new Error("Render the source in 9:16; choose other formats per variant");
  if (spec.source.maxDuration !== undefined && (!Number.isFinite(spec.source.maxDuration) || spec.source.maxDuration <= 0 || spec.source.maxDuration > 1800)) throw new Error("Invalid maxDuration");
  if (spec.renderScale !== undefined && (!Number.isFinite(spec.renderScale) || spec.renderScale < 0.1 || spec.renderScale > 1)) throw new Error("Invalid renderScale");
  if (spec.renderScale !== undefined && (Math.round(1080 * spec.renderScale) % 2 || Math.round(1920 * spec.renderScale) % 2)) throw new Error("renderScale must produce even source dimensions for H.264");
  if (!Array.isArray(spec.variants) || spec.variants.length < 2 || spec.variants.length > 12) throw new Error("Choose 2–12 variants");
  const ids = new Set<string>();
  for (const variant of spec.variants) {
    if (!/^[a-z0-9-]{1,60}$/.test(variant.id) || ids.has(variant.id)) throw new Error("Variant IDs must be unique and safe");
    ids.add(variant.id);
    if (typeof variant.hook !== "string" || variant.hook.length > 120 || typeof variant.caption !== "string" || variant.caption.length > 2000) throw new Error("Invalid hook/caption");
    if (variant.playbackRate !== undefined && (!Number.isFinite(variant.playbackRate) || variant.playbackRate < 0.5 || variant.playbackRate > 2)) throw new Error("playbackRate must be 0.5–2");
    if (variant.format && !["9:16", "4:5", "1:1", "16:9"].includes(variant.format)) throw new Error("Invalid format");
    if (variant.audio && !["original", "muted"].includes(variant.audio)) throw new Error("Invalid audio setting");
    if (variant.publishAt && !Number.isFinite(Date.parse(variant.publishAt))) throw new Error("Invalid publishAt");
    if (!Array.isArray(variant.destinations) || !variant.destinations.length || new Set(variant.destinations).size !== variant.destinations.length || variant.destinations.some(p => !["tiktok", "instagram", "facebook"].includes(p))) throw new Error("Invalid destinations");
  }
  return structuredClone(spec);
}
