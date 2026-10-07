import type { ChatMessage } from "./commands";

/**
 * The chat bridge: other tools (TikFinity or Streamer.bot for TikTok Live, a
 * bot of your own…) send chat to `/api/live/messages`, and the browser polls
 * it. Kept in the server process's memory: one stream, short history.
 */

const KEEP = 500;

export class MessageBuffer {
  private messages: { id: number; message: ChatMessage }[] = [];
  private next = 0;

  push(messages: ChatMessage[]): number {
    for (const message of messages) this.messages.push({ id: this.next++, message });
    if (this.messages.length > KEEP) this.messages.splice(0, this.messages.length - KEEP);
    return messages.length;
  }

  /** Messages after `id`; -1 returns the retained history so a first event at id 0 is visible. */
  since(id: number): { last: number; messages: { id: number; message: ChatMessage }[] } {
    return { last: this.next - 1, messages: this.messages.filter((m) => m.id > id) };
  }
}

const PLATFORMS = new Set(["twitch", "youtube", "tiktok", "bridge", "test"]);

/**
 * Whatever a tool sends, as chat messages. Accepts one object or a list, with
 * the field names common tools use: user / username / nickname / uniqueId /
 * name, and text / message / comment / msg. `kind` "gift" or "like", or a
 * `giftName`, `gift` or `likeCount` field, counts as a gift (a free boost).
 */
export function toMessages(body: unknown): ChatMessage[] {
  const items = Array.isArray(body) ? body : [body];
  const out: ChatMessage[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const pick = (...keys: string[]) => keys.map((k) => o[k]).find((v) => typeof v === "string" && v.trim() !== "") as string | undefined;
    const user = pick("user", "username", "nickname", "uniqueId", "name", "displayName");
    const text = pick("text", "message", "comment", "msg", "content") ?? "";
    if (!user) continue;
    const kind = o.kind === "gift" || o.kind === "like" ? o.kind : o.giftName || o.gift || o.likeCount ? "gift" : "chat";
    if (kind === "chat" && !text) continue;
    const platform = typeof o.platform === "string" && PLATFORMS.has(o.platform) ? (o.platform as ChatMessage["platform"]) : "bridge";
    const userId = pick("userId", "uniqueId", "id");
    out.push({ platform, user: user.slice(0, 40), userId, text: text.slice(0, 200), kind });
  }
  return out.slice(0, 100);
}
