import type { CountryBall } from "@/entities/CountryBall";
import type { Zone } from "@/entities/Zone";
import { TICK_RATE } from "@/engine/physicsWorld";
import type { ModeDefinition, ModeRules, Simulation } from "@/engine/simulation";
import { spawnPoints } from "@/engine/spawn";
import type { ObstacleSpec, Rect, WorldLayout, ZoneSpec } from "@/engine/types";
import { autoRadius, eliminateKeepingOne } from "./shared";

const WIDTH = 1080;
const LEFT = 40;
const RIGHT = WIDTH - 40;
const GATE_DELAY = 1.6;
const ROUND_LIMIT = 30;
const SETTLE_TICKS = Math.round(1.2 * TICK_RATE);

interface Board {
  layout: WorldLayout;
  spawn: Rect;
  slots: number;
}

function slotCount(ballRadius: number): number {
  const n = Math.floor((RIGHT - LEFT) / (ballRadius * 2 * 2.5));
  const clamped = Math.max(3, Math.min(9, n));
  return clamped % 2 ? clamped : clamped - 1;
}

/** Plinko board: spawn box, gate, pegs and bumpers, then slots that decide. */
function buildBoard(scenario: string, count: number, ballRadius: number, random: Simulation["random"]): Board {
  const r = ballRadius;
  const width = RIGHT - LEFT;
  const perRow = Math.max(1, Math.floor((width - 2 * r) / (2.4 * r)));
  const spawnH = Math.ceil(count / perRow) * 2.4 * r * 0.95 + 2 * r + 20;
  const spawn = { x: LEFT + 8, y: 40, w: width - 16, h: spawnH };
  const gateY = spawn.y + spawnH + 16;

  const obstacles: ObstacleSpec[] = [];
  const zones: ZoneSpec[] = [];
  const half = width / 2;
  for (const side of [-1, 1] as const) {
    obstacles.push({
      id: `gate-${side < 0 ? "l" : "r"}`,
      style: "gate",
      shapes: [{ kind: "rect", x: LEFT + half + (side * half) / 2, y: gateY, w: half, h: 22 }],
      motion: { type: "manual" },
    });
  }

  const pegR = 10;
  const spacing = Math.max(r * 2 * 2.5 + pegR * 2, 118);
  const boardTop = gateY + 130;
  const rows = scenario === "tall" ? 11 : 7;
  const rowH = spacing * 0.87;
  const cols = Math.floor(width / spacing);
  const bumpers = new Set(random.sample(Array.from({ length: rows * cols }, (_, i) => i), scenario === "bumpers" ? 7 : 3));
  for (let row = 0; row < rows; row++) {
    const offset = row % 2 ? spacing / 2 : 0;
    for (let col = 0; col < cols; col++) {
      const x = LEFT + spacing / 2 + offset + col * spacing;
      if (x > RIGHT - spacing / 3) continue;
      const y = boardTop + row * rowH;
      const slot = row * cols + col;
      const bumper = bumpers.has(slot);
      obstacles.push({
        id: `peg-${slot}`,
        style: bumper ? "bumper" : "peg",
        shapes: [{ kind: "circle", x, y, r: bumper ? 26 : pegR }],
        restitution: bumper ? 0.9 : 0.6,
        kick: bumper ? 5 : 0,
      });
    }
  }
  if (scenario === "spinners") {
    for (let i = 0; i < 2; i++) {
      const pivot = { x: LEFT + width * (0.3 + 0.4 * i), y: boardTop + rowH * (rows / 2) };
      obstacles.push({
        id: `spinner-${i}`,
        style: "spinner",
        shapes: [{ kind: "rect", x: pivot.x, y: pivot.y, w: spacing * 1.6, h: 18 }],
        motion: { type: "rotate", speed: random.float(1.2, 2) * (i ? -1 : 1), pivot },
        restitution: 0.6,
      });
    }
  }

  const slots = slotCount(r);
  const slotW = width / slots;
  const slotTop = boardTop + rows * rowH + 110;
  const floorY = slotTop + Math.max(260, r * 9);
  for (let i = 1; i < slots; i++) {
    const x = LEFT + i * slotW;
    obstacles.push({
      id: `divider-${i}`,
      style: "wall",
      shapes: [
        { kind: "rect", x, y: (slotTop + floorY) / 2, w: 14, h: floorY - slotTop },
        { kind: "circle", x, y: slotTop, r: 9 },
      ],
      restitution: 0.3,
    });
  }
  for (let i = 0; i < slots; i++) {
    zones.push({
      id: `slot-${i}`,
      kind: "eliminate",
      shape: { kind: "rect", x: LEFT + i * slotW + 7, y: slotTop + r * 1.2, w: slotW - 14, h: floorY - slotTop - r * 1.2 },
      visible: true,
    });
  }
  obstacles.unshift(
    { id: "wall-left", style: "wall", shapes: [{ kind: "rect", x: LEFT - 20, y: floorY / 2, w: 40, h: floorY + 200 }] },
    { id: "wall-right", style: "wall", shapes: [{ kind: "rect", x: RIGHT + 20, y: floorY / 2, w: 40, h: floorY + 200 }] },
    { id: "lid", style: "wall", shapes: [{ kind: "rect", x: WIDTH / 2, y: -20, w: WIDTH, h: 40 }] },
    { id: "floor", style: "wall", shapes: [{ kind: "rect", x: WIDTH / 2, y: floorY + 20, w: WIDTH, h: 40 }] },
  );

  const height = floorY + 40;
  return {
    spawn,
    slots,
    layout: {
      bounds: { x: 0, y: -60, w: WIDTH, h: height + 60 },
      focus: { x: 0, y: -60, w: WIDTH, h: height + 60 },
      obstacles,
      zones,
      spawn: { kind: "rect", ...spawn, speed: 1 },
      startY: gateY,
      finishY: floorY,
    },
  };
}

export const eliminationDrop: ModeDefinition = {
  id: "elimination-drop",
  label: "Elimination Drop",
  description:
    "Plinko rounds: countries drop through pegs into slots. Green slots survive, red slots are out. Fewer safe slots every round until one country is left.",
  scenarios: [
    { id: "classic", label: "Classic Plinko", description: "Seven rows of pegs and a few bumpers." },
    { id: "bumpers", label: "Bumper Frenzy", description: "More bumpers, more chaos." },
    { id: "spinners", label: "Spinners", description: "Two rotating bars in the middle of the board." },
    { id: "tall", label: "Tall Board", description: "Eleven rows: longer, more random drops." },
  ],
  defaultCamera: "follow-group",
  defaultParticipants: 48,
  defaultDuration: 240,
  recommendedPhysics: { gravity: 1.6, maxSpeed: 20 },

  autoBallRadius(count) {
    return autoRadius(1000 * 380, count, 0.3, 11, 26);
  },

  createLayout({ scenario, random, count, ballRadius }) {
    return buildBoard(scenario, count, ballRadius, random).layout;
  },

  createRules(sim) {
    return createDropRules(sim);
  },
};

function createDropRules(sim: Simulation): ModeRules {
  const slots = sim.zones.filter((z) => z.id.startsWith("slot-"));
  const gates = sim.obstacles.filter((o) => o.id.startsWith("gate-"));
  const spawn = sim.layout.spawn;
  const rounds = sim.random.fork("rounds");
  const forces = sim.random.fork("forces");
  let round = 0;
  let roundStart = 0;
  let settledAt: number | null = null;
  const safe = new Set<number>();
  const lastY = new Map<number, number>();
  const stalled = new Map<number, number>();

  const setGate = (open: number) => {
    for (const gate of gates) {
      const side = gate.id.endsWith("l") ? -1 : 1;
      gate.manualOffset = { x: side * open * ((RIGHT - LEFT) / 2 + 60), y: 0 };
    }
  };

  const startRound = () => {
    round++;
    roundStart = sim.tick;
    settledAt = null;
    safe.clear();
    stalled.clear();
    lastY.clear();
    const alive = sim.aliveBalls;
    // Roughly half the slots are safe; fewer as the field shrinks.
    const ratio = alive.length > 8 ? 0.45 : alive.length > 3 ? 0.35 : 0.25;
    const count = Math.max(1, Math.min(slots.length - 1, Math.round(slots.length * ratio)));
    const safeSlots = new Set(rounds.sample(slots.map((_, i) => i), count));
    slots.forEach((zone, i) => {
      zone.spec = { ...zone.spec, kind: safeSlots.has(i) ? "safe" : "eliminate" };
    });
    if (round > 1 && spawn.kind === "rect") {
      const points = spawnPoints(spawn, alive.length, sim.ballRadius, rounds.fork(`spawn-${round}`));
      alive.forEach((ball, i) => {
        const p = points[i];
        if (p) sim.teleport(ball, p.x, p.y, rounds.float(-1, 1), 0);
      });
    }
    setGate(0);
    sim.events.emit("roundStarted", { round, remaining: alive.length, tick: sim.tick });
  };

  const inSlot = (ball: CountryBall): Zone | undefined => slots.find((z) => z.contains(ball.x, ball.y, ball.radius));

  const rules: ModeRules = {
    beforeStep() {
      if (round === 0) startRound();
      const t = (sim.tick - roundStart) / TICK_RATE - GATE_DELAY;
      // Gate eases open over 0.4 s.
      const open = Math.min(1, Math.max(0, t / 0.4));
      setGate(open * open * (3 - 2 * open));
    },

    afterStep() {
      const out: CountryBall[] = [];
      for (const ball of sim.balls) {
        if (!ball.alive || safe.has(ball.id)) continue;
        const zone = inSlot(ball);
        if (zone?.kind === "safe") safe.add(ball.id);
        else if (zone?.kind === "eliminate") out.push(ball);
        else antiStall(ball);
      }
      if (out.length) eliminateKeepingOne(sim, out, { fall: false });
      if (sim.status !== "running") return;

      const alive = sim.aliveBalls;
      const elapsed = (sim.tick - roundStart) / TICK_RATE;
      const resolved = alive.every((b) => safe.has(b.id));
      if (resolved || elapsed > ROUND_LIMIT) {
        settledAt ??= sim.tick;
        if (sim.tick - settledAt < SETTLE_TICKS) return;
        if (!resolved) eliminateKeepingOne(sim, alive.filter((b) => !safe.has(b.id)));
        if (sim.status === "running") startRound();
      }
    },

    rank() {
      return [...sim.balls].sort((a, b) => {
        if (a.alive !== b.alive) return a.alive ? -1 : 1;
        if (a.alive) return Number(safe.has(b.id)) - Number(safe.has(a.id)) || b.y - a.y || a.id - b.id;
        return (b.eliminatedTick ?? 0) - (a.eliminatedTick ?? 0) || a.id - b.id;
      });
    },

    hud() {
      const t = (sim.tick - roundStart) / TICK_RATE;
      return {
        headline: "WHICH COUNTRY SURVIVES?",
        counterLabel: "COUNTRIES LEFT",
        counterValue: sim.aliveCount,
        showLeader: false,
        status: `ROUND ${Math.max(1, round)}`,
        banner: t < GATE_DELAY ? `ROUND ${round}` : undefined,
      };
    },

    onTimeout() {
      sim.declareWinner(rules.rank()[0], "timeout");
    },
  };

  function antiStall(ball: CountryBall) {
    if ((sim.tick - roundStart) / TICK_RATE < GATE_DELAY + 1) return;
    const previous = lastY.get(ball.id) ?? -Infinity;
    if (ball.y > previous + 3) {
      lastY.set(ball.id, ball.y);
      stalled.set(ball.id, 0);
      return;
    }
    const ticks = (stalled.get(ball.id) ?? 0) + 1;
    stalled.set(ball.id, ticks);
    if (ticks > 2 * TICK_RATE) {
      stalled.set(ball.id, 0);
      lastY.delete(ball.id);
      sim.nudge(ball, forces.float(-6, 6), forces.float(-6, -2));
    }
  }

  return rules;
}
