import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { UncertainPublication, type Confirmation, type Platform, type PublishContext, type Publisher } from "./types";

interface ApiBody {
  id?: string;
  uri?: string;
  video_id?: string;
  upload_url?: string;
  success?: boolean;
  status_code?: string;
  permalink?: string;
  media_type?: string;
  status?: { video_status?: string; processing_phase?: { status?: string }; publishing_phase?: { status?: string } };
  data?: {
    publish_id?: string;
    upload_url?: string;
    status?: string;
    fail_reason?: string;
    publicaly_available_post_id?: string[];
    privacy_level_options?: string[];
    creator_username?: string;
    comment_disabled?: boolean;
    uploaded_bytes?: number;
    max_video_post_duration_sec?: number;
    user?: { open_id?: string };
  };
  error?: { code?: number | string; message?: string };
}

type Transport = typeof fetch;
type Env = Record<string, string | undefined>;
type StreamRequest = RequestInit & { duplex?: "half" };

export class PlatformApiError extends Error {
  constructor(platform: string, readonly status: number, readonly code: number | string | undefined) {
    super(`${platform}: API error HTTP ${status}, code ${code ?? "unknown"}`);
  }
}

function required(env: Env, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`Configure ${key} in .env.local`);
  return value;
}

export function accountFor(platform: Platform, env: Env = process.env): string {
  return env[platform === "tiktok" ? "TIKTOK_OPEN_ID" : platform === "instagram" ? "INSTAGRAM_ACCOUNT_ID" : "FACEBOOK_PAGE_ID"] ?? "unconfigured";
}

/** Native APIs only: no cookies, passwords, browser automation or public staging bucket. */
export class SocialPublisher implements Publisher {
  constructor(readonly platform: Platform, private readonly env: Env = process.env, private readonly transport: Transport = fetch) {}

  private async api(url: string, init: StreamRequest = {}): Promise<ApiBody> {
    const response = await this.transport(url, { ...init, redirect: "error", signal: AbortSignal.timeout(init.body && init.duplex ? 10 * 60_000 : 60_000) });
    let body: ApiBody;
    try { body = await response.json() as ApiBody; } catch { throw new Error(`${this.platform}: invalid API response (${response.status})`); }
    if (!response.ok || (body.error?.code && body.error.code !== "ok")) {
      // The response body can contain private fields. Log only the platform code.
      throw new PlatformApiError(this.platform, response.status, body.error?.code);
    }
    return body;
  }

  private graph(path: string, fields?: string): string {
    const version = required(this.env, "META_GRAPH_VERSION");
    if (!/^v\d+\.\d+$/.test(version)) throw new Error("Invalid META_GRAPH_VERSION");
    const url = new URL(`https://graph.facebook.com/${version}/${path}`);
    if (fields) url.searchParams.set("fields", fields);
    return url.toString();
  }

  private metaToken(): string { return required(this.env, this.platform === "instagram" ? "INSTAGRAM_ACCESS_TOKEN" : "FACEBOOK_PAGE_ACCESS_TOKEN"); }

  private async meta(path: string, params?: Record<string, string>, fields?: string): Promise<ApiBody> {
    return this.api(this.graph(path, fields), {
      method: params ? "POST" : "GET",
      headers: { Authorization: `Bearer ${this.metaToken()}` },
      ...(params ? { body: new URLSearchParams(params) } : {}),
    });
  }

  private uploadUrl(value: string, meta: boolean): string {
    const url = new URL(value);
    const trusted = meta ? url.hostname === "rupload.facebook.com" : (url.hostname === "tiktokapis.com" || url.hostname.endsWith(".tiktokapis.com"));
    if (url.protocol !== "https:" || url.username || url.password || !trusted) throw new Error("Unexpected upload URL from platform");
    return url.toString();
  }

  private async metaUpload(context: PublishContext): Promise<void> {
    const ticket = context.delivery.ticket;
    ticket.phase = "uploading";
    await context.checkpoint();
    const stream = createReadStream(context.file);
    try {
      const result = await this.api(this.uploadUrl(ticket.uploadUrl!, true), {
        method: "POST", duplex: "half", body: stream as unknown as BodyInit,
        headers: { Authorization: `OAuth ${this.metaToken()}`, offset: "0", file_size: String(context.artifact.size), "Content-Length": String(context.artifact.size), "Content-Type": "application/octet-stream" },
      });
      if (result.success === false) throw new Error("Meta rejected the binary upload");
    } finally { stream.destroy(); }
    ticket.phase = "uploaded";
    // A successful binary upload is never a remote confirmation.
    await context.checkpoint();
  }

  async advance(context: PublishContext): Promise<Confirmation | null> {
    const account = accountFor(this.platform, this.env);
    if (account === "unconfigured") throw new Error(`Configure ${this.platform} account`);
    if (context.delivery.account !== account) throw new Error("Account changed; keep the original destination for this job");
    if (this.platform === "tiktok") return this.tiktok(context);
    this.metaToken();
    this.graph("me");
    return this.platform === "instagram" ? this.instagram(context) : this.facebook(context);
  }

  private async instagram(context: PublishContext): Promise<Confirmation | null> {
    const { delivery, variant } = context, ticket = delivery.ticket;
    if (ticket.mediaId) return this.instagramConfirmation(ticket.mediaId);
    if (!ticket.id) {
      if (ticket.phase === "creating") throw new UncertainPublication("Instagram container creation response was lost; review before retrying");
      ticket.phase = "creating";
      await context.checkpoint();
      const body = await this.definiteCreate(context, () => this.meta(`${delivery.account}/media`, { media_type: "REELS", upload_type: "resumable", caption: variant.spec.caption, share_to_feed: "true" }));
      if (!body.id || !body.uri) throw new Error("Instagram returned no upload container");
      ticket.id = body.id; ticket.uploadUrl = this.uploadUrl(body.uri, true); ticket.phase = "created";
      await context.checkpoint();
    }
    if (ticket.phase === "publishing") {
      const body = await this.meta(ticket.id, undefined, "status_code");
      if (body.status_code === "PUBLISHED") throw new UncertainPublication("Instagram published, but the media ID response was lost; reconcile its ID before cleanup");
      // Never repeat media_publish after an ambiguous timeout, even if still processing.
      throw new UncertainPublication("Instagram publication response is uncertain; review the existing container");
    }
    if (ticket.phase === "created" || ticket.phase === "uploading") {
      const existing = await this.meta(ticket.id, undefined, "status_code");
      if (["ERROR", "EXPIRED"].includes(existing.status_code ?? "")) throw new Error(`Instagram container ${existing.status_code}`);
      if (existing.status_code !== "FINISHED") await this.metaUpload(context);
    }
    const status = await this.meta(ticket.id, undefined, "status_code");
    if (["ERROR", "EXPIRED"].includes(status.status_code ?? "")) throw new Error(`Instagram container ${status.status_code}`);
    if (status.status_code !== "FINISHED") return null;
    ticket.phase = "publishing";
    await context.checkpoint();
    let published: ApiBody;
    try { published = await this.meta(`${delivery.account}/media_publish`, { creation_id: ticket.id }); }
    catch (error) {
      if (error instanceof PlatformApiError) { ticket.phase = "uploaded"; await context.checkpoint(); }
      throw error;
    }
    if (!published.id) throw new UncertainPublication("Instagram publication returned no media ID");
    ticket.mediaId = published.id; ticket.phase = "published";
    await context.checkpoint();
    return this.instagramConfirmation(published.id);
  }

  private async instagramConfirmation(id: string): Promise<Confirmation | null> {
    const media = await this.meta(id, undefined, "id,media_type,permalink");
    if (media.id !== id || media.media_type !== "VIDEO" || !media.permalink) return null;
    return { id, url: media.permalink };
  }

  private async facebook(context: PublishContext): Promise<Confirmation | null> {
    const { delivery, variant } = context, ticket = delivery.ticket;
    if (!ticket.id) {
      if (ticket.phase === "creating") throw new UncertainPublication("Facebook container creation response was lost; review before retrying");
      ticket.phase = "creating";
      await context.checkpoint();
      const body = await this.definiteCreate(context, () => this.meta(`${delivery.account}/video_reels`, { upload_phase: "start" }));
      if (!body.video_id || !body.upload_url) throw new Error("Facebook returned no upload container");
      ticket.id = body.video_id; ticket.uploadUrl = this.uploadUrl(body.upload_url, true); ticket.phase = "created";
      await context.checkpoint();
    }
    if (ticket.phase === "created" || ticket.phase === "uploading") {
      const existing = await this.meta(ticket.id, undefined, "status");
      if (existing.status?.video_status === "error") throw new Error("Facebook upload/processing failed");
      if (existing.status?.processing_phase?.status === "complete") {
        ticket.phase = "uploaded";
        await context.checkpoint();
      } else await this.metaUpload(context);
    }
    const status = await this.meta(ticket.id, undefined, "status");
    if (status.status?.video_status === "error") throw new Error("Facebook processing/publishing failed");
    if (status.status?.processing_phase?.status === "complete" && status.status?.publishing_phase?.status === "complete" && status.status?.video_status === "ready") {
      return { id: ticket.id, url: `https://www.facebook.com/reel/${ticket.id}` };
    }
    if (ticket.phase === "publishing" || ticket.phase === "published") return null;
    // Reels may not expose a ready transition before upload_phase=finish.
    if (ticket.phase === "uploaded" || (ticket.phase === "uploading" && status.status?.processing_phase?.status === "complete")) {
      ticket.phase = "publishing";
      await context.checkpoint();
      try {
        const body = await this.meta(`${delivery.account}/video_reels`, { upload_phase: "finish", video_id: ticket.id, video_state: "PUBLISHED", description: variant.spec.caption });
        if (!body.success) throw new Error("Facebook did not accept the publish request");
        ticket.phase = "published";
        await context.checkpoint();
      } catch (error) {
        if (error instanceof PlatformApiError) {
          // A definite API rejection is safe to retry with the same video ID.
          ticket.phase = "uploaded";
          await context.checkpoint();
        }
        // The stable video ID is polled on the next cycle; do not create another video.
        throw error;
      }
    }
    return null;
  }

  private async tt(path: string, body?: Record<string, unknown>): Promise<ApiBody> {
    return this.api(`https://open.tiktokapis.com/v2/${path}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${required(this.env, "TIKTOK_ACCESS_TOKEN")}`, "Content-Type": "application/json; charset=UTF-8" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  private async tiktok(context: PublishContext): Promise<Confirmation | null> {
    const { delivery, variant, artifact } = context, ticket = delivery.ticket;
    if (!ticket.id) {
      if (ticket.phase === "creating") throw new UncertainPublication("TikTok initialization response was lost; review before retrying");
      const user = await this.tt("user/info/?fields=open_id");
      if (user.data?.user?.open_id !== delivery.account) throw new Error("TikTok token belongs to a different account");
      const creator = await this.tt("post/publish/creator_info/query/", {});
      const privacy = required(this.env, "TIKTOK_PRIVACY_LEVEL");
      if (!creator.data?.privacy_level_options?.includes(privacy)) throw new Error("TikTok privacy level is not available for this account/app");
      if (!variant.duration || !creator.data.max_video_post_duration_sec || variant.duration > creator.data.max_video_post_duration_sec) throw new Error("Video exceeds this TikTok account's duration limit");
      const size = artifact.size!;
      const chunkSize = Math.min(10 * 1024 ** 2, size);
      const chunks = Math.max(1, Math.floor(size / chunkSize));
      ticket.phase = "creating";
      await context.checkpoint();
      const body = await this.definiteCreate(context, () => this.tt("post/publish/video/init/", {
        post_info: { title: variant.spec.caption, privacy_level: privacy, disable_duet: true, disable_stitch: true, disable_comment: creator.data?.comment_disabled ?? false, video_cover_timestamp_ms: 1000 },
        source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: chunkSize, total_chunk_count: chunks },
      }));
      if (!body.data?.publish_id || !body.data.upload_url) throw new Error("TikTok returned no upload session");
      ticket.id = body.data.publish_id; ticket.uploadUrl = this.uploadUrl(body.data.upload_url, false);
      if (creator.data.creator_username) ticket.username = creator.data.creator_username;
      ticket.chunkSize = String(chunkSize); ticket.chunks = String(chunks); ticket.nextChunk = "0"; ticket.phase = "uploading";
      await context.checkpoint();
    }
    const result = await this.tt("post/publish/status/fetch/", { publish_id: ticket.id });
    if (result.data?.status === "FAILED") throw new Error(`TikTok rejected the video: ${result.data.fail_reason ?? "unknown"}`);
    if (result.data?.status === "PUBLISH_COMPLETE") {
      const id = result.data.publicaly_available_post_id?.[0];
      // A completed private publication may not have a public post ID. The publish ID
      // still identifies the successful remote job, without inventing a public URL.
      return { id: id ?? ticket.id, url: id && ticket.username ? `https://www.tiktok.com/@${encodeURIComponent(ticket.username)}/video/${id}` : undefined };
    }
    if (ticket.phase === "uploading" && result.data?.status === "PROCESSING_UPLOAD") {
      const received = result.data.uploaded_bytes;
      const chunkSize = Number(ticket.chunkSize);
      // The status endpoint recovers an acknowledgement lost after a complete chunk.
      if (received !== undefined) {
        if (!Number.isSafeInteger(received) || received < 0 || received > artifact.size!) throw new Error("Invalid TikTok upload progress");
        if (received === artifact.size) {
          ticket.phase = "uploaded";
          await context.checkpoint();
          return null;
        }
        if (received % chunkSize !== 0) throw new Error("TikTok reports an incomplete chunk; preserve the file for review");
        ticket.nextChunk = String(received / chunkSize);
        await context.checkpoint();
      }
      const file = await open(context.file, "r");
      try {
        const chunks = Number(ticket.chunks), chunkSize = Number(ticket.chunkSize);
        for (let index = Number(ticket.nextChunk); index < chunks; index++) {
          const start = index * chunkSize;
          const size = index === chunks - 1 ? artifact.size! - start : chunkSize;
          const buffer = Buffer.allocUnsafe(size);
          const { bytesRead } = await file.read(buffer, 0, size, start);
          if (bytesRead !== size) throw new Error("Local video changed during TikTok upload");
          const response = await this.transport(this.uploadUrl(ticket.uploadUrl!, false), {
            method: "PUT", redirect: "error", signal: AbortSignal.timeout(10 * 60_000),
            headers: { "Content-Type": "video/mp4", "Content-Length": String(size), "Content-Range": `bytes ${start}-${start + size - 1}/${artifact.size}` }, body: buffer,
          });
          if (!response.ok) throw new Error(`TikTok chunk upload failed HTTP ${response.status}`);
          ticket.nextChunk = String(index + 1);
          await context.checkpoint();
        }
      } finally { await file.close(); }
      ticket.phase = "uploaded";
      await context.checkpoint();
    }
    return null;
  }

  private async definiteCreate(context: PublishContext, create: () => Promise<ApiBody>): Promise<ApiBody> {
    try { return await create(); }
    catch (error) {
      if (error instanceof PlatformApiError) {
        context.delivery.ticket.phase = "";
        await context.checkpoint();
      }
      throw error;
    }
  }
}

export function publishers(): Record<Platform, Publisher> {
  return { tiktok: new SocialPublisher("tiktok"), instagram: new SocialPublisher("instagram"), facebook: new SocialPublisher("facebook") };
}
