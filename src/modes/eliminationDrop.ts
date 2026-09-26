import type { CountryBall } from "@/entities/CountryBall";
import type { Zone } from "@/entities/Zone";
import { TICK_RATE } from "@/engine/physicsWorld";
import type { LayoutContext, ModeDefinition, ModeRules, Simulation } from "@/engine/simulation";
import { spawnPoints } from "@/engine/spawn";
import type { ObstacleSpec, Rect, WorldLayout, ZoneSpec } from "@/engine/types";
import { pegGrid } from "@/tracks/grid";
import { buildMap, findMap, type MapDefinition } from "@/tracks/maps";
import { RING_CENTER } from "./arena";
import { configMap, courseFor, mapBallRadius, mapLayout, trackLayout } from "./course";
import { autoRadius, eliminateKeepingOne } from "./shared";

const WIDTH = 1080;
const LEFT = 40;
const RIGHT = WIDTH - 40;
const GATE_DELAY = 2.9;
const SETTLE_TICKS = Math.round(1.7 * TICK_RATE);

interface Board {
  layout: WorldLayout;
  spawn: Rect;
  slots: number;
}

function slotCount(ballRadius: number): number {
  // Wide boxes (3.5 ball widths or more): a landing ball stays in its box.
  const n = Math.floor((RIGHT - LEFT) / (ballRadius * 2 * 3.5));
  const clamped = Math.max(3, Math.min(7, n));
  return clamped % 2 ? clamped : clamped - 1;
}

/**
 * Wide, deep boxes with a dead floor, from `top` down: deep enough that a box
 * catching twice its share never overflows (balls piled above a box would
 * never count as landed), walled well above the pile so nothing bounces from
 * one box into another. Returns the floor's y.
 */
function addBoxes(obstacles: ObstacleSpec[], zones: ZoneSpec[], top: number, count: number, r: number): number {
  const width = RIGHT - LEFT;
  const slots = slotCount(r);
  const slotW = width / slots;
  const slotRow = Math.max(1, Math.floor((slotW - 14) / (2 * r)));
  const stack = Math.ceil((2 * count) / slots / slotRow);
  const floorY = top + Math.max(300, r * 11, stack * 2 * r * 0.9 + 5 * r);
  for (let i = 1; i < slots; i++) {
    const x = LEFT + i * slotW;
    obstacles.push({
      id: `divider-${i}`,
      style: "wall",
      shapes: [
        { kind: "rect", x, y: (top + floorY) / 2, w: 14, h: floorY - top },
        { kind: "circle", x, y: top, r: 9 },
      ],
      restitution: 0.05,
      friction: 0.1,
    });
  }
  for (let i = 0; i < slots; i++) {
    zones.push({
      id: `slot-${i}`,
      kind: "eliminate",
      shape: { kind: "rect", x: LEFT + i * slotW + 7, y: top + r * 0.6, w: slotW - 14, h: floorY - top - r * 0.6 },
      visible: true,
    });
  }
  // A dead floor: balls land in their box instead of bouncing back out.
  obstacles.push({ id: "floor", style: "wall", shapes: [{ kind: "rect", x: WIDTH / 2, y: floorY + 20, w: WIDTH, h: 40 }], restitution: 0, friction: 0.3 });
  return floorY;
}

/** Side walls from `top` to the floor (the boxes' part of a map). */
function sideWalls(top: number, floorY: number, id: string): ObstacleSpec[] {
  const h = floorY + 40 - top;
  return [
    { id: `${id}-left`, style: "wall", shapes: [{ kind: "rect", x: LEFT - 20, y: top + h / 2, w: 40, h }] },
    { id: `${id}-right`, style: "wall", shapes: [{ kind: "rect", x: RIGHT + 20, y: top + h / 2, w: 40, h }] },
  ];
}

/**
 * Any map from the registry above the boxes: a track (without its finish, it
 * pours straight into the boxes) or a ring arena (escape the rings, fall into
 * a box).
 */
function mapBoard(map: MapDefinition, ctx: LayoutContext): WorldLayout {
  const r = ctx.ballRadius;
  if (map.arena) {
    const arena = mapLayout(map, ctx);
    const obstacles = [...arena.obstacles];
    const zones = arena.zones.filter((z) => z.kind !== "eliminate");
    const top = RING_CENTER.y + 520 + 3 * r;
    const floorY = addBoxes(obstacles, zones, top, ctx.count, r);
    obstacles.unshift(...sideWalls(-40, floorY, "wall"), { id: "lid", style: "wall", shapes: [{ kind: "rect", x: WIDTH / 2, y: -20, w: WIDTH, h: 40 }] });
    const height = floorY + 40;
    return { ...arena, obstacles, zones, bounds: { x: 0, y: -60, w: WIDTH, h: height + 60 }, focus: { x: 0, y: -60, w: WIDTH, h: height + 60 }, finishY: floorY };
  }
  const track = buildMap(map, ctx.random.seed, { ballRadius: r, count: ctx.count, ending: "open" });
  const layout = trackLayout(track);
  const obstacles = [...layout.obstacles];
  const zones = [...layout.zones];
  const top = track.height + 40;
  const floorY = addBoxes(obstacles, zones, top, ctx.count, r);
  obstacles.push(...sideWalls(track.height - 100, floorY, "box-wall"));
  const height = floorY + 40;
  return { ...layout, obstacles, zones, bounds: { x: 0, y: -60, w: WIDTH, h: height + 60 }, focus: { x: 0, y: -60, w: WIDTH, h: height + 60 }, finishY: floorY };
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

  // The Plinko grid: staggered rows that leave no straight lane for any ball
  // size (see tracks/grid.ts), with wall bumps on the odd rows.
  const boardTop = gateY + 110;
  const rows = scenario === "tall" ? 10 : 7;
  const grid = pegGrid({ left: LEFT, right: RIGHT, top: boardTop, rows, ballRadius: r, pitch: 6, minPitch: 90 });
  const inner = grid.pegs.filter((p) => !p.wall && !p.edge).map((p) => p.index);
  const bumpers = new Set(random.sample(inner, scenario === "bumpers" ? 8 : 3));
  // Bumpers are a little bigger than pegs, never closing a gap.
  const bumperR = Math.max(grid.pegRadius, Math.min(grid.pegRadius * 1.3, grid.pitch - grid.pegRadius - 2 * r * 1.9));
  // Spinners replace the pegs they would sweep through.
  const spinners =
    scenario === "spinners"
      ? [0, 1].map((i) => ({ x: LEFT + width * (0.27 + 0.46 * i), y: boardTop + grid.rowHeight * Math.floor(rows / 2), reach: grid.pitch * 0.95 }))
      : [];
  for (const p of grid.pegs) {
    if (spinners.some((s) => Math.hypot(p.x - s.x, p.y - s.y) < s.reach + grid.pegRadius + r * 2.2)) continue;
    const bumper = bumpers.has(p.index);
    obstacles.push({
      id: `peg-${p.index}`,
      style: bumper ? "bumper" : "peg",
      shapes: [{ kind: "circle", x: p.x, y: p.y, r: bumper ? bumperR : p.r }],
      restitution: bumper ? 0.9 : 0.55,
      kick: bumper ? 5 : 0,
    });
  }
  spinners.forEach((pivot, i) => {
    obstacles.push({
      id: `spinner-${i}`,
      style: "spinner",
      shapes: [
        { kind: "rect", x: pivot.x, y: pivot.y, w: pivot.reach * 2, h: 18 },
        { kind: "circle", x: pivot.x, y: pivot.y, r: 18 },
      ],
      motion: { type: "rotate", speed: random.float(1.4, 2.2) * (i ? -1 : 1), pivot },
      restitution: 0.6,
    });
  });

  const slots = slotCount(r);
  const slotTop = boardTop + grid.span + grid.pegRadius + 2.6 * r + 40;
  const floorY = addBoxes(obstacles, zones, slotTop, count, r);
  obstacles.unshift(
    { id: "wall-left", style: "wall", shapes: [{ kind: "rect", x: LEFT - 20, y: floorY / 2, w: 40, h: floorY + 200 }] },
    { id: "wall-right", style: "wall", shapes: [{ kind: "rect", x: RIGHT + 20, y: floorY / 2, w: 40, h: floorY + 200 }] },
    { id: "lid", style: "wall", shapes: [{ kind: "rect", x: WIDTH / 2, y: -20, w: WIDTH, h: 40 }] },
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
  // Softer bounces than the arena modes: balls work down the pegs instead of
  // bouncing back up, which keeps a round at ~8–15 s.
  recommendedPhysics: { gravity: 1.6, maxSpeed: 20, restitution: 0.45 },

  autoBallRadius(count, _scenario, mapId) {
    const map = findMap(mapId);
    if (map?.arena) return mapBallRadius(map, count);
    return autoRadius(1000 * 380, count, 0.3, 11, 26);
  },

  createLayout(ctx) {
    const map = findMap(ctx.map);
    if (map) return mapBoard(map, ctx);
    return buildBoard(ctx.scenario, ctx.count, ctx.ballRadius, ctx.random).layout;
  },

  createRules(sim) {
    return createDropRules(sim);
  },
};

function createDropRules(sim: Simulation): ModeRules {
  const slots = sim.zones.filter((z) => z.id.startsWith("slot-"));
  const first = slots[0]?.spec.shape;
  const slotTop = first && first.kind === "rect" ? first.y : 0;
  const gates = sim.obstacles.filter((o) => o.id.startsWith("gate-"));
  // On a map, its own gate (track) or rings (arena) hold the field back.
  const map = configMap(sim);
  const course = map ? courseFor(sim, map) : null;
  let opened = false;
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
    if (round > 1 && (spawn.kind === "rect" || course)) {
      const points = spawnPoints(spawn, alive.length, sim.ballRadius, rounds.fork(`spawn-${round}`));
      alive.forEach((ball, i) => {
        const p = points[i];
        if (!p) return;
        const v = course?.arena ? course.launch(rounds) : { vx: rounds.float(-1, 1), vy: 0 };
        sim.teleport(ball, p.x, p.y, v.vx, v.vy);
      });
    }
    if (course) {
      course.close();
      opened = false;
    }
    setGate(0);
    sim.events.emit("roundStarted", { round, remaining: alive.length, tick: sim.tick });
  };

  const inSlot = (ball: CountryBall): Zone | undefined => slots.find((z) => z.contains(ball.x, ball.y, ball.radius));

  const rules: ModeRules = {
    beforeStep() {
      if (round === 0) startRound();
      const t = (sim.tick - roundStart) / TICK_RATE - GATE_DELAY;
      if (course) {
        if (!opened && t >= 0) {
          opened = true;
          course.open();
        }
        course.update(opened ? t : null);
        return;
      }
      // Gate eases open over 0.4 s.
      const open = Math.min(1, Math.max(0, t / 0.4));
      setGate(open * open * (3 - 2 * open));
    },

    afterStep() {
      if (course && opened) course.kick();
      const out: CountryBall[] = [];
      for (const ball of sim.balls) {
        if (!ball.alive || safe.has(ball.id)) continue;
        // A ball is judged once it has landed in a box: settled inside it, or
        // so deep that no bounce can carry it over the wall into the next one.
        const zone = inSlot(ball);
        const depth = ball.y - slotTop;
        const landed = zone && (depth > 3 * ball.radius || (depth > ball.radius && Math.hypot(ball.vx, ball.vy) < 2.5));
        if (landed && zone.kind === "safe") safe.add(ball.id);
        else if (landed && zone.kind === "eliminate") out.push(ball);
        else if (!zone) antiStall(ball);
      }
      if (out.length) eliminateKeepingOne(sim, out, { fall: false });
      if (sim.status !== "running") return;

      // The round ends when every ball has landed, never on the clock.
      const alive = sim.aliveBalls;
      if (alive.every((b) => safe.has(b.id))) {
        settledAt ??= sim.tick;
        if (sim.tick - settledAt < SETTLE_TICKS) return;
        if (sim.status === "running") startRound();
      }
    },

    cameraMoment() {
      if ((sim.tick - roundStart) / TICK_RATE < GATE_DELAY) return "setup";
      return settledAt === null ? "live" : "hold";
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
    if (ticks % (2 * TICK_RATE) === 0) sim.nudge(ball, forces.float(-6, 6), forces.float(-6, -2));
    // Still stuck after three kicks: it drops through whatever holds it.
    if (ticks >= 7 * TICK_RATE) {
      stalled.set(ball.id, 0);
      lastY.delete(ball.id);
      sim.phase(ball, 0.4);
    }
  }

  return rules;
}
