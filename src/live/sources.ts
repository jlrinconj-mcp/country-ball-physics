import type { ChatMessage } from "./commands";

/**
 * Where live chat comes from. Every source turns its platform's messages into
 * `ChatMessage`s; the session doesn't care which platform they came from.
 */
export interface ChatSource {
  readonly label: string;
  connect(onMessage: (message: ChatMessage) => void, onStatus: (status: SourceStatus) => void): void;
  disconnect(): void;
}

export interface SourceStatus {
  state: "connecting" | "connected" | "error" | "closed";
  detail?: string;
}

export type SourceConfig =
  | { kind: "twitch"; channel: string }
  | { kind: "youtube"; apiKey: string; videoId: string }
  | { kind: "bridge" };

export function createSource(config: SourceConfig): ChatSource {
  switch (config.kind) {
    case "twitch":
      return new TwitchSource(config.channel);
    case "youtube":
      return new YouTubeSource(config.apiKey, config.videoId);
    case "bridge":
      return new BridgeSource();
  }
}

/**
 * Twitch chat, read anonymously over Twitch's IRC WebSocket: no account or
 * key, just the channel name.
 */
export class TwitchSource implements ChatSource {
  readonly label: string;
  private socket: WebSocket | null = null;
  private closed = false;

  constructor(private readonly channel: string) {
    this.channel = channel.trim().replace(/^#/, "").toLowerCase();
    this.label = `Twitch #${this.channel}`;
  }

  connect(onMessage: (message: ChatMessage) => void, onStatus: (status: SourceStatus) => void): void {
    this.closed = false;
    onStatus({ state: "connecting" });
    const socket = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
    this.socket = socket;
    socket.onopen = () => {
      socket.send("CAP REQ :twitch.tv/tags");
      socket.send("PASS SCHMOOPIIE");
      socket.send(`NICK justinfan${10000 + Math.floor(Math.random() * 80000)}`);
      socket.send(`JOIN #${this.channel}`);
    };
    socket.onmessage = (event) => {
      for (const line of String(event.data).split("\r\n")) {
        if (!line) continue;
        if (line.startsWith("PING")) {
          socket.send(line.replace("PING", "PONG"));
          continue;
        }
        if (/ 366 /.test(line)) onStatus({ state: "connected", detail: this.label });
        const message = parseTwitchLine(line);
        if (message) onMessage(message);
      }
    };
    socket.onerror = () => onStatus({ state: "error", detail: "Twitch connection failed" });
    socket.onclose = () => {
      if (this.closed) return onStatus({ state: "closed" });
      // Dropped: reconnect after a moment.
      onStatus({ state: "connecting", detail: "Reconnecting…" });
      setTimeout(() => !this.closed && this.connect(onMessage, onStatus), 3000);
    };
  }

  disconnect(): void {
    this.closed = true;
    this.socket?.close();
    this.socket = null;
  }
}

/** One IRC line → a chat message (PRIVMSG only). Bits count as a gift. */
export function parseTwitchLine(line: string): ChatMessage | null {
  const match = /^(?:@(\S+) )?:(\w+)!\S+ PRIVMSG #\S+ :(.*)$/.exec(line);
  if (!match) return null;
  const tags = new Map((match[1] ?? "").split(";").map((kv) => kv.split("=") as [string, string]));
  const user = tags.get("display-name") || (match[2] as string);
  return {
    platform: "twitch",
    userId: tags.get("user-id") || (match[2] as string),
    user,
    text: match[3] as string,
    kind: tags.has("bits") ? "gift" : "chat",
  };
}

/**
 * YouTube Live chat through the YouTube Data API v3 (an API key and the live
 * video's id). Each poll costs quota (5 units of 10,000 a day by default), so
 * it polls no faster than every 6 s, or slower if YouTube asks.
 */
export class YouTubeSource implements ChatSource {
  readonly label = "YouTube Live";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly apiKey: string,
    private readonly videoId: string,
  ) {}

  connect(onMessage: (message: ChatMessage) => void, onStatus: (status: SourceStatus) => void): void {
    this.closed = false;
    onStatus({ state: "connecting" });
    const api = "https://www.googleapis.com/youtube/v3";
    const key = encodeURIComponent(this.apiKey.trim());
    void (async () => {
      try {
        const video = await fetchJson(`${api}/videos?part=liveStreamingDetails&id=${encodeURIComponent(youTubeId(this.videoId))}&key=${key}`);
        const chatId = video?.items?.[0]?.liveStreamingDetails?.activeLiveChatId as string | undefined;
        if (!chatId) throw new Error("No active live chat for that video");
        let pageToken = "";
        let first = true;
        const poll = async () => {
          if (this.closed) return;
          try {
            const page = await fetchJson(`${api}/liveChat/messages?liveChatId=${chatId}&part=snippet,authorDetails&maxResults=200${pageToken ? `&pageToken=${pageToken}` : ""}&key=${key}`);
            pageToken = page.nextPageToken ?? pageToken;
            // The first page is history: start from now.
            if (!first) for (const item of page.items ?? []) onMessage(youTubeMessage(item));
            first = false;
            onStatus({ state: "connected", detail: this.label });
            this.timer = setTimeout(poll, Math.max(6000, Number(page.pollingIntervalMillis) || 0));
          } catch (error) {
            onStatus({ state: "error", detail: error instanceof Error ? error.message : String(error) });
            this.timer = setTimeout(poll, 15000);
          }
        };
        await poll();
      } catch (error) {
        onStatus({ state: "error", detail: error instanceof Error ? error.message : String(error) });
      }
    })();
  }

  disconnect(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
  }
}

/** A watch URL, youtu.be link or bare id → the id. */
export function youTubeId(input: string): string {
  const text = input.trim();
  const match = /(?:v=|youtu\.be\/|\/live\/|\/shorts\/)([\w-]{11})/.exec(text);
  return match ? (match[1] as string) : text;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function youTubeMessage(item: any): ChatMessage {
  const type = item?.snippet?.type as string | undefined;
  return {
    platform: "youtube",
    userId: item?.authorDetails?.channelId,
    user: item?.authorDetails?.displayName ?? "viewer",
    text: item?.snippet?.displayMessage ?? "",
    kind: type === "superChatEvent" || type === "superStickerEvent" || type === "newSponsorEvent" ? "gift" : "chat",
  };
}

/**
 * Anything else (TikTok Live through TikFinity, Streamer.bot, a bot of your
 * own…): POST messages to this app's `/api/live/messages`, and the browser
 * picks them up from there.
 */
export class BridgeSource implements ChatSource {
  readonly label = "Bridge /api/live/messages";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  connect(onMessage: (message: ChatMessage) => void, onStatus: (status: SourceStatus) => void): void {
    this.closed = false;
    onStatus({ state: "connecting" });
    let after = -1;
    const poll = async () => {
      if (this.closed) return;
      try {
        const page = (await fetchJson(`/api/live/messages?after=${after}`)) as { last: number; messages: { id: number; message: ChatMessage }[] };
        // The first poll only finds where "now" is.
        if (after >= 0) for (const m of page.messages) onMessage(m.message);
        after = page.last;
        onStatus({ state: "connected", detail: this.label });
      } catch (error) {
        onStatus({ state: "error", detail: error instanceof Error ? error.message : String(error) });
      }
      this.timer = setTimeout(poll, 700);
    };
    void poll();
  }

  disconnect(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? body?.error ?? `HTTP ${response.status}`);
  return body;
}
