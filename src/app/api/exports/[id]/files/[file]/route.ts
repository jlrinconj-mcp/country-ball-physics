import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { exportDirectory, readExport } from "@/export/server/store";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string; file: string }> }) {
  try {
    const { id, file } = await context.params;
    const video = await readExport(id);
    const metadata = video.status === "complete" && (file === "metadata.json" || video.parts.some(part => part.metadata && file === part.file.replace(/\.mp4$/, ".json")));
    if (!metadata && !video.parts.some(part => part.file === file)) return new Response(null, { status: 404 });
    const path = join(exportDirectory(id), file);
    const { size } = await stat(path);
    let start = 0, end = size - 1;
    const range = request.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      if (!match[1] && !match[2]) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      if (!match[1]) start = Math.max(0, size - Number(match[2]));
      else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end; }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>;
    const seed = video.request.config.seed.replace(/[^a-z0-9_-]/gi, "_");
    return new Response(stream, {
      status: range ? 206 : 200,
      headers: {
        "Content-Type": metadata ? "application/json" : "video/mp4",
        "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes", "Cache-Control": "no-store",
        "Content-Disposition": `${!metadata && new URL(request.url).searchParams.get("preview") === "1" ? "inline" : "attachment"}; filename="bolworld-${seed}-${file}"`,
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
