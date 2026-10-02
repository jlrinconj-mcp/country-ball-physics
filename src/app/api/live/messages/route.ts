import { MessageBuffer, toMessages } from "@/live/bridge";

/**
 * Chat bridge for the live mode (see `src/live/bridge.ts`).
 *   POST /api/live/messages   {"user":"ana","text":"!join colombia"}  (or a list)
 *   GET  /api/live/messages?user=ana&text=!boost                       (tools that can only GET)
 *   GET  /api/live/messages?after=12                                   (the browser polls this)
 * Set LIVE_BRIDGE_TOKEN to require ?token=… (or an x-live-token header) when
 * the app is reachable from the internet.
 */

// One buffer per server process.
const buffer = new MessageBuffer();

function authorized(request: Request, url: URL): boolean {
  const token = process.env.LIVE_BRIDGE_TOKEN;
  return !token || url.searchParams.get("token") === token || request.headers.get("x-live-token") === token;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const user = url.searchParams.get("user");
  if (user !== null) {
    if (!authorized(request, url)) return Response.json({ error: "Bad token" }, { status: 401 });
    const added = buffer.push(toMessages({ user, text: url.searchParams.get("text") ?? "", kind: url.searchParams.get("kind") ?? undefined, platform: url.searchParams.get("platform") ?? undefined }));
    return Response.json({ added });
  }
  const after = Number(url.searchParams.get("after") ?? -1);
  return Response.json(buffer.since(Number.isFinite(after) ? after : -1), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  if (!authorized(request, url)) return Response.json({ error: "Bad token" }, { status: 401 });
  let body: unknown;
  const type = request.headers.get("content-type") ?? "";
  try {
    body = type.includes("application/json") ? await request.json() : Object.fromEntries(new URLSearchParams(await request.text()));
  } catch {
    return Response.json({ error: "Send JSON like {\"user\":\"ana\",\"text\":\"!join colombia\"}" }, { status: 400 });
  }
  return Response.json({ added: buffer.push(toMessages(body)) });
}
