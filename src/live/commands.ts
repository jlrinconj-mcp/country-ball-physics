import { flagToCca2 } from "./countryMatch";

/** A message from a live chat (any platform), or a platform event. */
export interface ChatMessage {
  platform: "twitch" | "youtube" | "tiktok" | "bridge" | "test";
  /** Stable per viewer on that platform (falls back to the name). */
  userId?: string;
  user: string;
  text: string;
  /**
   * "gift" (TikTok gifts, YouTube Super Chats, Twitch bits) and "like" boost
   * the viewer's country without waiting for the cooldown.
   */
  kind?: "chat" | "gift" | "like";
}

export type Command =
  | { kind: "join"; query: string }
  | { kind: "boost" }
  | { kind: "vote"; option: number }
  | { kind: "points" };

const JOIN = ["join", "unirme", "unir", "pais", "país", "country", "play", "jugar", "j"];
const BOOST = ["boost", "b", "go", "impulso", "impulsar", "empuje", "empujar", "vamos", "dale", "push"];
const VOTE = ["vote", "votar", "voto", "v"];
const POINTS = ["points", "puntos", "score", "rank"];

/**
 * What a chat message asks for. Commands start with "!" (English and
 * Spanish); a bare flag emoji joins with that country, and a bare 1–3 votes.
 */
export function parseCommand(text: string): Command | null {
  const trimmed = text.trim();
  if (flagToCca2(trimmed)) return { kind: "join", query: trimmed };
  if (/^[1-9]$/.test(trimmed)) return { kind: "vote", option: Number(trimmed) };
  const match = /^[!/]\s*(\S+)\s*(.*)$/u.exec(trimmed);
  if (!match) return null;
  const word = (match[1] as string).toLowerCase();
  const rest = (match[2] as string).trim();
  if (JOIN.includes(word)) return rest ? { kind: "join", query: rest } : null;
  if (BOOST.includes(word)) return { kind: "boost" };
  if (VOTE.includes(word)) {
    const option = Number.parseInt(rest, 10);
    return Number.isFinite(option) && option > 0 ? { kind: "vote", option } : null;
  }
  if (POINTS.includes(word)) return { kind: "points" };
  return null;
}
