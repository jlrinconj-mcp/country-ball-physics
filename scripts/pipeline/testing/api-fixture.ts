/** Test-only HTTP server. Production endpoints cannot be redirected via environment variables. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { SocialPublisher } from "../publishers";
import type { Platform, Publisher } from "../types";

export const TEST_ENV = {
  META_GRAPH_VERSION: "v25.0",
  INSTAGRAM_ACCOUNT_ID: "ig-account",
  INSTAGRAM_ACCESS_TOKEN: "test-ig-token",
  FACEBOOK_PAGE_ID: "fb-page",
  FACEBOOK_PAGE_ACCESS_TOKEN: "test-fb-token",
  TIKTOK_OPEN_ID: "tt-account",
  TIKTOK_ACCESS_TOKEN: "test-tt-token",
  TIKTOK_PRIVACY_LEVEL: "SELF_ONLY",
};

export async function apiFixture() {
  const files: Partial<Record<Platform, Buffer>> = {};
  const calls: string[] = [];
  const control = { confirmed: false, loseInstagramPublishResponse: false, rejectCreateOnce: false, rejectInstagramUploadOnce: false, loseTikTokChunkResponseOnce: false };
  let igPublished = false, fbPublished = false, ttSize = 0, ttBytes = Buffer.alloc(0);
  const json = (res: ServerResponse, value: unknown, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const chunks: Buffer[] = []; for await (const part of req) chunks.push(part);
      const binary = Buffer.concat(chunks);
      const url = new URL(req.url!, "http://localhost"), path = url.pathname;
      calls.push(`${req.method} ${path}`);
      if (path.includes("/user/info/")) return json(res, { data: { user: { open_id: TEST_ENV.TIKTOK_OPEN_ID } }, error: { code: "ok" } });
      if (path.includes("creator_info")) return json(res, { data: { creator_username: "test-account", privacy_level_options: ["SELF_ONLY"], max_video_post_duration_sec: 600 }, error: { code: "ok" } });
      if (path.includes("/video/init/")) {
        ttSize = JSON.parse(binary.toString()).source_info.video_size;
        return json(res, { data: { publish_id: "tt-job", upload_url: "https://upload.us.tiktokapis.com/video" }, error: { code: "ok" } });
      }
      if (path.includes("/status/fetch/")) return json(res, { data: { status: ttBytes.length < ttSize ? "PROCESSING_UPLOAD" : control.confirmed ? "PUBLISH_COMPLETE" : "PROCESSING_DOWNLOAD", uploaded_bytes: ttBytes.length, ...(control.confirmed ? { publicaly_available_post_id: ["tt-post"] } : {}) }, error: { code: "ok" } });
      if (path.includes("upload.us.tiktokapis.com")) {
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(req.headers["content-range"]));
        if (!range || Number(range[1]) !== ttBytes.length || Number(range[2]) - Number(range[1]) + 1 !== binary.length || Number(range[3]) !== ttSize) return json(res, { error: { code: "bad_range" } }, 400);
        ttBytes = Buffer.concat([ttBytes, binary]); files.tiktok = ttBytes;
        if (control.loseTikTokChunkResponseOnce) { control.loseTikTokChunkResponseOnce = false; return req.socket.destroy(); }
        res.writeHead(ttBytes.length === ttSize ? 201 : 206); return res.end();
      }
      if (path.endsWith("/ig-account/media")) {
        if (control.rejectCreateOnce) { control.rejectCreateOnce = false; return json(res, { error: { code: 190 } }, 400); }
        const params = new URLSearchParams(binary.toString());
        if (params.get("upload_type") !== "resumable" || params.get("media_type") !== "REELS") return json(res, { error: { code: "bad_container" } }, 400);
        return json(res, { id: "ig-container", uri: "https://rupload.facebook.com/ig-api-upload/v25.0/ig-container" });
      }
      if (path.includes("/ig-api-upload/")) {
        if (control.rejectInstagramUploadOnce) { control.rejectInstagramUploadOnce = false; return json(res, { error: { code: 1 } }, 503); }
        if (Number(req.headers.file_size) !== binary.length) return json(res, { error: { code: "bad_size" } }, 400);
        files.instagram = binary; return json(res, { success: true });
      }
      if (path.endsWith("/ig-container")) return json(res, { status_code: igPublished ? "PUBLISHED" : files.instagram && control.confirmed ? "FINISHED" : "IN_PROGRESS" });
      if (path.endsWith("/ig-account/media_publish")) {
        igPublished = true;
        if (control.loseInstagramPublishResponse) { control.loseInstagramPublishResponse = false; return req.socket.destroy(); }
        return json(res, { id: "ig-post" });
      }
      if (path.endsWith("/ig-post")) return json(res, { id: "ig-post", media_type: "VIDEO", permalink: "https://www.instagram.com/reel/test-id/" });
      if (path.endsWith("/fb-page/video_reels")) {
        const params = new URLSearchParams(binary.toString());
        if (params.get("upload_phase") === "start") return json(res, { video_id: "fb-video", upload_url: "https://rupload.facebook.com/video-upload/v25.0/fb-video" });
        fbPublished = true; return json(res, { success: true });
      }
      if (path.includes("/video-upload/")) {
        if (Number(req.headers.file_size) !== binary.length) return json(res, { error: { code: "bad_size" } }, 400);
        files.facebook = binary; return json(res, { success: true });
      }
      if (path.endsWith("/fb-video")) return json(res, { status: { video_status: fbPublished && control.confirmed ? "ready" : "processing", processing_phase: { status: files.facebook ? "complete" : "in_progress" }, publishing_phase: { status: fbPublished && control.confirmed ? "complete" : "in_progress" } } });
      json(res, { error: { code: "unknown_fixture_endpoint" } }, 404);
    })().catch(() => json(res, { error: { code: "fixture_error" } }, 500));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fixture port");
  const transport: typeof fetch = async (input, init) => {
    const original = new URL(String(input));
    return fetch(`http://127.0.0.1:${address.port}/${original.hostname}${original.pathname}${original.search}`, init);
  };
  const publishers: Record<Platform, Publisher> = {
    tiktok: new SocialPublisher("tiktok", TEST_ENV, transport),
    instagram: new SocialPublisher("instagram", TEST_ENV, transport),
    facebook: new SocialPublisher("facebook", TEST_ENV, transport),
  };
  return { files, calls, control, publishers, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
