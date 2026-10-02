import { describe, expect, it } from "vitest";
import type { Country } from "@/countries/countryTypes";
import { DEFAULT_CONFIG } from "@/engine/defaults";
import { TICK_DT } from "@/engine/physicsWorld";
import type { SimulationResult } from "@/engine/simulation";
import { makeTestCountries } from "@/engine/testing";
import { createSimulation } from "@/modes";
import { parseCommand, type ChatMessage } from "./commands";
import { CountryMatcher, flagToCca2 } from "./countryMatch";
import { DEFAULT_LIVE_OPTIONS, LiveSession } from "./session";

const REAL: [string, string, string, string?][] = [
  ["Colombia", "CO", "COL"],
  ["Argentina", "AR", "ARG"],
  ["Germany", "DE", "DEU"],
  ["United States", "US", "USA"],
  ["United Kingdom", "GB", "GBR"],
  ["Netherlands", "NL", "NLD"],
  ["Peru", "PE", "PER"],
  ["Spain", "ES", "ESP"],
  ["Brazil", "BR", "BRA"],
  ["Ivory Coast", "CI", "CIV"],
  ["Australia", "AU", "AUS"],
  ["Austria", "AT", "AUT"],
];
// Real countries, then fillers with codes no real country uses (X-, not XK).
const countries: Country[] = makeTestCountries(REAL.length + 20).map((c, i) => {
  const real = REAL[i];
  if (real) return { ...c, name: real[0], officialName: real[0], cca2: real[1], cca3: real[2] };
  const cca2 = `X${"ABCDEFGHIJLMNOPQRSTUVWYZ"[i - REAL.length]}`;
  return { ...c, name: `Filler ${cca2}`, officialName: `Filler ${cca2}`, cca2, cca3: `${cca2}X` };
});

describe("chat commands", () => {
  it("understands English and Spanish commands, flags and bare votes", () => {
    expect(parseCommand("!join colombia")).toEqual({ kind: "join", query: "colombia" });
    expect(parseCommand("!país Países Bajos")).toEqual({ kind: "join", query: "Países Bajos" });
    expect(parseCommand("🇦🇷")).toEqual({ kind: "join", query: "🇦🇷" });
    expect(parseCommand("!boost")).toEqual({ kind: "boost" });
    expect(parseCommand("!DALE")).toEqual({ kind: "boost" });
    expect(parseCommand("!votar 2")).toEqual({ kind: "vote", option: 2 });
    expect(parseCommand("3")).toEqual({ kind: "vote", option: 3 });
    expect(parseCommand("hola a todos")).toBeNull();
    expect(parseCommand("!join")).toBeNull();
    expect(flagToCca2("🇨🇴")).toBe("CO");
  });

  it("finds countries by name in English or Spanish, code, alias, flag or a clear start", () => {
    const m = new CountryMatcher(countries);
    const code = (q: string) => m.find(q)?.cca3 ?? null;
    expect(code("colombia")).toBe("COL");
    expect(code("ALEMANIA")).toBe("DEU");
    expect(code("Países Bajos")).toBe("NLD");
    expect(code("holanda")).toBe("NLD");
    expect(code("eeuu")).toBe("USA");
    expect(code("inglaterra")).toBe("GBR");
    expect(code("costa de marfil")).toBe("CIV");
    expect(code("🇧🇷")).toBe("BRA");
    expect(code("de")).toBe("DEU");
    expect(code("arg")).toBe("ARG");
    expect(code("argentin")).toBe("ARG");
    // "Aus…" could be Australia or Austria.
    expect(code("aus")).toBe("AUS");
    expect(code("austr")).toBeNull();
    expect(code("narnia")).toBeNull();
  });
});

const chat = (user: string, text: string, kind?: ChatMessage["kind"]): ChatMessage => ({ platform: "test", user, text, kind });

function session(overrides: Partial<typeof DEFAULT_LIVE_OPTIONS> = {}) {
  return new LiveSession(countries, { ...DEFAULT_LIVE_OPTIONS, lobbySeconds: 10, resultsSeconds: 3, players: 8, ...overrides, seed: "live-test", fill: countries.map((c) => c.cca3) });
}

describe("LiveSession", () => {
  it("lobby: viewers join teams and vote; the game uses their countries and the winning vote", () => {
    const live = session();
    live.handle(chat("ana", "!join colombia"));
    live.handle(chat("beto", "🇨🇴"));
    live.handle(chat("caro", "!unirme argentina"));
    live.handle(chat("dani", "!join narnia"));
    live.handle(chat("ana", "2"));
    live.handle(chat("beto", "!vote 2"));
    live.handle(chat("caro", "1"));
    const view = live.view();
    expect(view.teams).toEqual([
      { cca3: "COL", users: ["ana", "beto"] },
      { cca3: "ARG", users: ["caro"] },
    ]);
    expect(view.choices.map((c) => c.votes)).toEqual([1, 2, 0]);
    expect(view.feed.some((f) => f.kind === "unknown")).toBe(true);

    expect(live.advance(5)).toBeNull();
    expect(live.advance(5)).toBe("start");
    const config = live.startConfig(DEFAULT_CONFIG);
    expect(config.countries).toEqual(expect.arrayContaining(["COL", "ARG"]));
    expect(config.countries).toHaveLength(8);
    const voted = view.choices[1];
    expect(live.view().current).toEqual({ mode: voted?.mode, map: voted?.map });
    expect(config.mode).toBe(voted?.mode);
    // Same session seed, same game.
    const again = session();
    for (const [u, t] of [["ana", "!join colombia"], ["beto", "🇨🇴"], ["caro", "!unirme argentina"], ["ana", "2"], ["beto", "2"], ["caro", "1"]]) again.handle(chat(u as string, t as string));
    again.advance(10);
    expect(again.startConfig(DEFAULT_CONFIG)).toEqual(config);
  });

  it("boosts: only your own country, only while playing, with a cooldown (gifts skip it)", () => {
    const live = session({ boostCooldown: 5 });
    live.handle(chat("ana", "!join colombia"));
    expect(live.handle(chat("ana", "!boost"))).toEqual([]);
    live.advance(10);
    live.startConfig(DEFAULT_CONFIG);
    expect(live.handle(chat("ana", "!boost"))).toEqual([{ type: "boost", cca3: "COL", user: "ana" }]);
    expect(live.handle(chat("ana", "!boost"))).toEqual([]);
    expect(live.handle(chat("ana", "", "gift"))).toHaveLength(1);
    live.advance(5);
    expect(live.handle(chat("ana", "!dale"))).toHaveLength(1);
    // Joined after the start: plays the next game.
    live.handle(chat("beto", "!join peru"));
    expect(live.handle(chat("beto", "!boost"))).toEqual([]);
  });

  it("a whole cycle: lobby → game → points → results → lobby, with boosts replayable", () => {
    const live = session();
    live.handle(chat("ana", "!join colombia"));
    live.handle(chat("beto", "!join argentina"));
    live.advance(10);
    const config = live.startConfig(DEFAULT_CONFIG);
    const sim = createSimulation(config, countries);
    while (sim.status !== "finished") {
      live.advance(TICK_DT);
      if (sim.tick % 60 === 0) for (const user of ["ana", "beto"]) for (const a of live.handle(chat(user, "!boost"))) sim.input("boost", a.cca3);
      sim.step();
    }
    const result = sim.result as SimulationResult;
    const inputs = [...sim.inputs];
    sim.destroy();
    expect(inputs.length).toBeGreaterThan(0);
    live.finish(result);
    expect(live.phase).toBe("results");
    const board = live.view().leaderboard;
    expect(board.map((r) => r.name).sort()).toEqual(["ana", "beto"]);
    const winner = result.winner.cca3;
    if (winner === "COL") expect(board[0]).toMatchObject({ name: "ana", wins: 1, points: 105 });
    expect(live.advance(3)).toBe("lobby");
    expect(live.phase).toBe("lobby");
    // The game, with the viewers' boosts, replays exactly from its log.
    const replay = createSimulation({ ...config, inputs }, countries).runToEnd() as SimulationResult;
    expect(replay.fingerprint).toBe(result.fingerprint);
    // Points survive a new session (between streams).
    const next = session();
    next.importScores(live.exportScores());
    expect(next.view().leaderboard.map((r) => r.points).sort()).toEqual(board.map((r) => r.points).sort());
  }, 60_000);
});

describe("chat sources", () => {
  it("reads Twitch IRC lines, YouTube ids and bridge payloads", async () => {
    const { parseTwitchLine, youTubeId } = await import("./sources");
    const { MessageBuffer, toMessages } = await import("./bridge");
    expect(parseTwitchLine("@badge-info=;display-name=Ana_G;user-id=42 :ana_g!ana_g@ana_g.tmi.twitch.tv PRIVMSG #canal :!join colombia")).toEqual({
      platform: "twitch",
      userId: "42",
      user: "Ana_G",
      text: "!join colombia",
      kind: "chat",
    });
    expect(parseTwitchLine("@bits=100;display-name=Beto;user-id=7 :beto!beto@beto.tmi.twitch.tv PRIVMSG #canal :Cheer100")?.kind).toBe("gift");
    expect(parseTwitchLine(":tmi.twitch.tv 001 justinfan123 :Welcome")).toBeNull();
    expect(youTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1")).toBe("dQw4w9WgXcQ");
    expect(youTubeId("https://youtube.com/live/dQw4w9WgXcQ?si=x")).toBe("dQw4w9WgXcQ");
    expect(youTubeId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");

    // TikFinity-style fields, a list, gifts, junk.
    expect(toMessages([{ nickname: "ana", comment: "!join peru" }, { uniqueId: "beto", giftName: "Rose" }, { foo: 1 }, "x"])).toEqual([
      { platform: "bridge", user: "ana", userId: undefined, text: "!join peru", kind: "chat" },
      { platform: "bridge", user: "beto", userId: "beto", text: "", kind: "gift" },
    ]);
    const buffer = new MessageBuffer();
    expect(buffer.since(-1)).toEqual({ last: -1, messages: [] });
    buffer.push(toMessages({ user: "ana", text: "1" }));
    const { last } = buffer.since(-1);
    buffer.push(toMessages({ user: "beto", text: "2" }));
    expect(buffer.since(last).messages.map((m) => m.message.user)).toEqual(["beto"]);
  });
});
