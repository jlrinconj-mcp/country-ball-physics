"use client";

import { useState } from "react";
import type { Country } from "@/countries/countryTypes";
import { generateSeed } from "@/engine/random";
import type { SimulationConfig } from "@/engine/types";
import { DEFAULT_LIVE_OPTIONS } from "@/live/session";
import type { SourceConfig } from "@/live/sources";
import { countryName, type Language } from "@/render/i18n";
import type { LiveSnapshot, SimulationController } from "@/runtime/SimulationController";
import { Button, Field, Section, Segmented, Slider } from "./ui";

type SourceKind = "none" | SourceConfig["kind"];

const STORAGE_KEY = "cbp-live-settings";

interface Settings {
  lobbySeconds: number;
  players: number;
  boostCooldown: number;
  source: SourceKind;
  channel: string;
  apiKey: string;
  videoId: string;
}

const DEFAULTS: Settings = {
  lobbySeconds: DEFAULT_LIVE_OPTIONS.lobbySeconds,
  players: DEFAULT_LIVE_OPTIONS.players,
  boostCooldown: DEFAULT_LIVE_OPTIONS.boostCooldown,
  source: "none",
  channel: "",
  apiKey: "",
  videoId: "",
};

function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    return { ...DEFAULTS, ...JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

/**
 * Live mode: viewers play from the stream chat. Start it, connect a chat
 * source, and try it with the test chat before going live.
 */
export function LiveControls({
  controller,
  live,
  config,
  countries,
  selected,
  language,
}: {
  controller: SimulationController;
  live: LiveSnapshot | null;
  config: SimulationConfig;
  countries: Country[];
  selected: string[];
  language: Language;
}) {
  // Only rendered once country data has loaded in the browser: storage is there.
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [user, setUser] = useState("viewer1");
  const [text, setText] = useState("!join colombia");
  const set = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Not saved; still applied.
    }
  };

  const start = () => {
    controller.startLive(
      { seed: generateSeed("live"), lobbySeconds: settings.lobbySeconds, resultsSeconds: DEFAULT_LIVE_OPTIONS.resultsSeconds, players: settings.players, boostCooldown: settings.boostCooldown, choices: DEFAULT_LIVE_OPTIONS.choices, fill: selected },
      config,
      countries,
    );
    connect();
  };

  const connect = () => {
    if (settings.source === "twitch" && settings.channel) controller.connectChat({ kind: "twitch", channel: settings.channel });
    else if (settings.source === "youtube" && settings.apiKey && settings.videoId) controller.connectChat({ kind: "youtube", apiKey: settings.apiKey, videoId: settings.videoId });
    else if (settings.source === "bridge") controller.connectChat({ kind: "bridge" });
    else controller.disconnectChat();
  };

  const send = (from: string, message: string) => controller.chat({ platform: "test", user: from, text: message });

  /** A burst of fake viewers: joins and votes in the lobby, boosts in a game. */
  const bots = () => {
    const pool = selected.length ? selected : countries.map((c) => c.cca3);
    const byCode = new Map(countries.map((c) => [c.cca3, c]));
    for (let i = 0; i < 10; i++) {
      const name = `bot${Math.floor(Math.random() * 900 + 100)}`;
      const country = byCode.get(pool[Math.floor(Math.random() * pool.length)] as string);
      if (!country) continue;
      if (live?.view.phase === "playing") send(name, "!boost");
      else {
        send(name, `!join ${countryName(country, language)}`);
        send(name, String(1 + Math.floor(Math.random() * 3)));
      }
    }
  };
  const boostAll = () => {
    for (const team of live?.view.teams ?? []) for (const name of team.users) send(name, "!boost");
  };

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const view = live?.view;

  return (
    <Section title="🔴 Live (viewers play)" aside={live ? <span className="text-[11px] font-semibold text-red-400">ON AIR</span> : undefined}>
      {!live ? (
        <>
          <p className="text-xs leading-relaxed text-zinc-500">
            Viewers type <b className="text-zinc-300">!join colombia</b> (or 🇨🇴) to play with a country, vote the next game with <b className="text-zinc-300">1/2/3</b>, and push their country with <b className="text-zinc-300">!boost</b>. Points carry over between games. Empty places are filled from the country selection. Stream this canvas with OBS (window capture).
          </p>
          <Slider label="Lobby" value={settings.lobbySeconds} min={10} max={120} step={5} onChange={(lobbySeconds) => set({ lobbySeconds })} format={(v) => `${v}s`} />
          <Slider label="Countries per game" value={settings.players} min={6} max={64} step={1} onChange={(players) => set({ players })} format={(v) => `${v}`} />
          <Slider label="Boost cooldown" value={settings.boostCooldown} min={1} max={30} step={1} onChange={(boostCooldown) => set({ boostCooldown })} format={(v) => `${v}s`} />
        </>
      ) : (
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Phase" value={view?.phase === "lobby" ? `Lobby ${Math.ceil(view.countdown)}s` : view?.phase === "playing" ? "Playing" : "Results"} />
          <Stat label="Players" value={String(view?.teams.reduce((n, t) => n + t.users.length, 0) ?? 0)} />
          <Stat label="Game" value={`#${view?.game ?? 0}`} />
        </div>
      )}

      <Segmented
        label="Chat"
        value={settings.source}
        options={[
          { value: "none", label: "Test" },
          { value: "twitch", label: "Twitch" },
          { value: "youtube", label: "YouTube" },
          { value: "bridge", label: "Bridge" },
        ]}
        onChange={(source) => set({ source })}
      />
      {settings.source === "twitch" && (
        <Field label="Twitch channel">
          <input className="input" value={settings.channel} placeholder="your_channel" onChange={(e) => set({ channel: e.target.value })} />
        </Field>
      )}
      {settings.source === "youtube" && (
        <>
          <Field label="YouTube Data API key" hint={<a className="underline" href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noreferrer">get one</a>}>
            <input className="input font-mono" type="password" value={settings.apiKey} placeholder="AIza…" onChange={(e) => set({ apiKey: e.target.value })} />
          </Field>
          <Field label="Live video URL or id">
            <input className="input" value={settings.videoId} placeholder="https://youtube.com/live/…" onChange={(e) => set({ videoId: e.target.value })} />
          </Field>
          <p className="text-[11px] text-zinc-500">Reads chat every 6 s (YouTube API quota). Super Chats count as gift boosts.</p>
        </>
      )}
      {settings.source === "bridge" && (
        <div className="space-y-1 text-[11px] leading-relaxed text-zinc-500">
          <p>For TikTok Live and other tools (TikFinity, Streamer.bot…): send each chat message or gift to</p>
          <code className="block break-all rounded bg-zinc-900 p-2 text-zinc-300">POST {origin}/api/live/messages{"\n"}{`{"user":"{nickname}","text":"{comment}"}`}</code>
          <p>
            or <code className="text-zinc-300">GET …/api/live/messages?user=ana&amp;text=!boost</code>. Gifts: add <code className="text-zinc-300">&quot;kind&quot;:&quot;gift&quot;</code>.
          </p>
        </div>
      )}
      {live && (
        <p className="text-[11px] text-zinc-500">
          Chat:{" "}
          <span className={live.chat.state === "connected" ? "text-emerald-400" : live.chat.state === "error" ? "text-red-400" : "text-zinc-400"}>
            {live.chat.state === "closed" ? "test only" : `${live.chat.state}${live.chat.detail ? ` · ${live.chat.detail}` : ""}`}
          </span>
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {!live ? (
          <Button variant="primary" onClick={start} disabled={countries.length < 2}>
            Start live
          </Button>
        ) : (
          <>
            <Button onClick={connect}>{settings.source === "none" ? "Test chat only" : "Reconnect chat"}</Button>
            {view?.phase === "lobby" && <Button onClick={() => controller.startLiveGameNow()}>Start game now</Button>}
            <Button variant="ghost" onClick={() => controller.stopLive()}>
              Stop live
            </Button>
          </>
        )}
      </div>

      {live && (
        <div className="space-y-2 rounded-lg bg-zinc-900/60 p-2 ring-1 ring-white/[0.04]">
          <p className="text-[11px] font-medium text-zinc-400">Test chat</p>
          <div className="flex gap-1.5">
            <input className="input w-24" value={user} onChange={(e) => setUser(e.target.value)} aria-label="Viewer name" />
            <input
              className="input min-w-0 flex-1"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && text.trim()) send(user, text);
              }}
              aria-label="Message"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button onClick={() => text.trim() && send(user, text)}>Send</Button>
            <Button onClick={bots} title="Ten fake viewers join and vote (or boost during a game)">
              +10 bots
            </Button>
            <Button onClick={boostAll} disabled={view?.phase !== "playing"}>
              Everyone !boost
            </Button>
          </div>
          <ul className="max-h-32 space-y-0.5 overflow-y-auto text-[11px] text-zinc-400">
            {live.messages
              .slice(-8)
              .reverse()
              .map((m, i) => (
                <li key={i} className="truncate">
                  <span className="text-zinc-500">{m.platform} · </span>
                  <b className="text-zinc-300">{m.user}</b> {m.kind === "gift" ? "🎁" : m.text}
                </li>
              ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-900 px-2 py-1.5 ring-1 ring-white/[0.04]">
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="text-sm font-semibold text-zinc-100">{value}</p>
    </div>
  );
}
