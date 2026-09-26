import type { ObstacleSpec, ShapeSpec, Vec2 } from "@/engine/types";
import { pegGrid, type PegGrid } from "./grid";
import type { ModuleContext, ModuleKind, TrackModuleDefinition } from "./types";

// ── Geometry helpers ─────────────────────────────────────────────────────

/** A straight bar between two points, as a rotated rectangle. */
export function bar(a: Vec2, b: Vec2, thickness: number): ShapeSpec {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return {
    kind: "rect",
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    w: Math.hypot(dx, dy),
    h: thickness,
    angle: Math.atan2(dy, dx),
  };
}

function solid(id: string, style: ObstacleSpec["style"], shapes: ShapeSpec[], extra: Partial<ObstacleSpec> = {}): ObstacleSpec {
  return { id, style, shapes, restitution: 0.4, friction: 0.02, ...extra };
}

/** Minimum opening that any ball can always pass through. */
function passGap(ctx: ModuleContext): number {
  return ctx.ballRadius * 2 * 2.6;
}

/** Grid pegs as obstacles; `bumpers` (grid indices) become kicking bumpers. */
function gridObstacles(ctx: ModuleContext, grid: PegGrid, options: { bumpers?: Set<number>; style?: "peg" | "bumper"; kick?: number } = {}): ObstacleSpec[] {
  const r = ctx.ballRadius;
  // A bumper may be bigger than a peg, but never closes the gap to a neighbour.
  const bumperR = Math.max(grid.pegRadius, Math.min(Math.max(grid.pegRadius * 1.4, 24), grid.pitch - grid.pegRadius - 2 * r * 1.9));
  return grid.pegs.map((p) => {
    const bumper = options.style === "bumper" || (options.bumpers?.has(p.index) ?? false);
    const radius = bumper && options.style !== "bumper" ? bumperR : grid.pegRadius;
    return solid(`${ctx.id}-${bumper ? "bumper" : "peg"}-${p.index}`, bumper ? "bumper" : "peg", [{ kind: "circle", x: p.x, y: p.y, r: radius }], {
      restitution: bumper ? 0.9 : 0.6,
      kick: bumper ? (options.kick ?? 5 + ctx.difficulty * 3) : undefined,
    });
  });
}

/**
 * Short ramps on both side walls that steer wall-huggers inward, so no ball
 * slides past a spinner or wheel along the wall. `reach` is how far from the
 * wall the ramp's tip ends.
 */
function wallDeflectors(ctx: ModuleContext, y: number, reach: number): ObstacleSpec[] {
  const drop = reach * 0.55;
  return [
    solid(`${ctx.id}-deflect-l`, "ramp", [bar({ x: ctx.left - 10, y }, { x: ctx.left + reach, y: y + drop }, 18)], { friction: 0.01 }),
    solid(`${ctx.id}-deflect-r`, "ramp", [bar({ x: ctx.right + 10, y }, { x: ctx.right - reach, y: y + drop }, 18)], { friction: 0.01 }),
  ];
}

// ── Modules ──────────────────────────────────────────────────────────────

const start: TrackModuleDefinition = {
  kind: "start",
  label: "Start",
  weight: 0,
  build(ctx) {
    const { left, right, y, ballRadius: r, count } = ctx;
    const width = right - left;
    const perRow = Math.max(1, Math.floor((width - 2 * r) / (2.4 * r)));
    const rows = Math.ceil(count / perRow);
    const spawnH = rows * 2.4 * r * 0.95 + 2 * r + 30;
    const gateY = y + 40 + spawnH + 16;
    const half = width / 2;
    const gateOpensAt = 3;
    // The mode opens (and may re-close) the gate: see `startGate` in modes/shared.
    const gate = (side: -1 | 1): ObstacleSpec =>
      solid(`${ctx.id}-gate-${side < 0 ? "l" : "r"}`, "gate", [{ kind: "rect", x: left + width / 2 + (side * half) / 2, y: gateY, w: half, h: 22 }], {
        motion: { type: "manual" },
      });
    return {
      height: gateY - y + 90,
      obstacles: [gate(-1), gate(1)],
      spawn: { x: left + 8, y: y + 40, w: width - 16, h: spawnH },
      gateOpensAt,
    };
  },
};

const drop: TrackModuleDefinition = {
  kind: "drop",
  label: "Drop",
  weight: 1,
  build(ctx) {
    // A few rows of big, widely spaced pegs: quick, bouncy, no free lanes.
    const rows = ctx.random.int(2, 3);
    const grid = pegGrid({ left: ctx.left, right: ctx.right, top: ctx.y + 100, rows, ballRadius: ctx.ballRadius, pitch: 8.5, minPitch: 110, maxPitch: 280, minPegRadius: 16 });
    const slots = grid.pegs.filter((p) => !p.wall).map((p) => p.index);
    const bumpers = new Set(ctx.random.sample(slots, 1 + Math.round(ctx.difficulty)));
    return { height: 100 + grid.span + 150, obstacles: gridObstacles(ctx, grid, { bumpers }) };
  },
};

const zigzag: TrackModuleDefinition = {
  kind: "zigzag",
  label: "Zigzag",
  weight: 3,
  build(ctx) {
    const { left, right, y, random } = ctx;
    const width = right - left;
    // Few, fairly steep ramps: balls visibly roll and drop instead of crawling.
    // Every switchback stops the ball against the wall: easy tracks get three.
    const n = ctx.difficulty < 0.5 ? 3 : random.int(3, 4);
    const spacing = 250 + ctx.ballRadius * 2;
    const length = width * 0.68;
    let side = random.sign();
    const obstacles: ObstacleSpec[] = [];
    const route: Vec2[] = [{ x: (left + right) / 2, y }];
    for (let i = 0; i < n; i++) {
      const slope = random.float(0.3, 0.4);
      const top = y + 80 + i * spacing;
      const from = { x: side < 0 ? left - 10 : right + 10, y: top };
      const to = { x: from.x - side * length * Math.cos(slope), y: top + length * Math.sin(slope) };
      obstacles.push(solid(`${ctx.id}-ramp-${i}`, "ramp", [bar(from, to, 22)], { friction: 0.01 }));
      // Balls roll along each ramp and drop off its low end.
      route.push({ x: to.x, y: to.y - ctx.ballRadius });
      side = side < 0 ? 1 : -1;
    }
    return { height: 80 + n * spacing + 140, obstacles, route };
  },
};

const spinner: TrackModuleDefinition = {
  kind: "spinner",
  label: "Spinner",
  weight: 3,
  build(ctx) {
    const { left, right, y, random } = ctx;
    const width = right - left;
    const cx = (left + right) / 2;
    const gap = passGap(ctx);
    const pair = random.chance(0.5);
    const pivots = pair ? [left + width / 4, right - width / 4] : [cx];
    const reach = pair ? width / 4 - gap * 0.55 : width / 2 - gap;
    const height = reach * 2 + 220;
    const direction = random.sign();
    const r = ctx.ballRadius;
    // Steer wall-huggers (and, for a pair, the middle lane) into the blades.
    const sideLane = pivots[0]! - reach - left;
    const extras: ObstacleSpec[] = wallDeflectors(ctx, y + 30, sideLane + 0.5 * r);
    if (pair) {
      const middleR = Math.max(14, (cx - (pivots[0]! + reach)) - 1.4 * r);
      extras.push(solid(`${ctx.id}-splitter`, "peg", [{ kind: "circle", x: cx, y: y + 40 + middleR, r: middleR }], { restitution: 0.6 }));
    }
    const obstacles = pivots.map((px, i) => {
      const pivot = { x: px, y: y + height / 2 };
      const cross = random.chance(0.4);
      const shapes: ShapeSpec[] = [{ kind: "rect", x: pivot.x, y: pivot.y, w: reach * 2, h: 22 }];
      if (cross) shapes.push({ kind: "rect", x: pivot.x, y: pivot.y, w: 22, h: reach * 2 });
      shapes.push({ kind: "circle", x: pivot.x, y: pivot.y, r: 20 });
      const speed = random.float(1.1, 1.9 + ctx.difficulty) * (i % 2 ? -direction : direction);
      return solid(`${ctx.id}-spinner-${i}`, "spinner", shapes, {
        motion: { type: "rotate", speed, pivot, phase: random.float(0, Math.PI) },
        restitution: 0.6,
      });
    });
    return { height, obstacles: [...extras, ...obstacles] };
  },
};

const funnel: TrackModuleDefinition = {
  kind: "funnel",
  label: "Funnel",
  weight: 2,
  build(ctx) {
    const { left, right, y } = ctx;
    const width = right - left;
    const cx = (left + right) / 2;
    const r = ctx.ballRadius;
    const opening = Math.min(width * 0.2, Math.max(r * 6, 130));
    const neckY = y + 430;
    const t = 24;
    // A splitter under the neck: nothing drops straight through the funnel.
    const splitR = Math.max(16, opening / 2 - 1.5 * r);
    const splitY = neckY + 90 + 2.4 * r + splitR;
    return {
      height: splitY - y + splitR + 2.6 * r + 20,
      obstacles: [
        solid(`${ctx.id}-split`, "bumper", [{ kind: "circle", x: cx, y: splitY, r: splitR }], { restitution: 0.8, kick: 3 }),
        solid(`${ctx.id}-l`, "funnel", [
          bar({ x: left - 10, y: y + 40 }, { x: cx - opening / 2 - t / 2, y: neckY }, t),
          { kind: "rect", x: cx - opening / 2 - t / 2, y: neckY + 45, w: t, h: 90 },
        ], { friction: 0.01 }),
        solid(`${ctx.id}-r`, "funnel", [
          bar({ x: right + 10, y: y + 40 }, { x: cx + opening / 2 + t / 2, y: neckY }, t),
          { kind: "rect", x: cx + opening / 2 + t / 2, y: neckY + 45, w: t, h: 90 },
        ], { friction: 0.01 }),
      ],
    };
  },
};

const plinko: TrackModuleDefinition = {
  kind: "plinko",
  label: "Plinko",
  weight: 2,
  build(ctx) {
    const rows = ctx.random.int(5, 6) + Math.round(ctx.difficulty * 2);
    const grid = pegGrid({ left: ctx.left, right: ctx.right, top: ctx.y + 90, rows, ballRadius: ctx.ballRadius, pitch: 6, minPitch: 80 });
    return { height: 90 + grid.span + 130, obstacles: gridObstacles(ctx, grid) };
  },
};

const pinball: TrackModuleDefinition = {
  kind: "pinball",
  label: "Pinball",
  weight: 3,
  build(ctx) {
    const { random } = ctx;
    const rows = random.int(3, 5);
    const grid = pegGrid({ left: ctx.left, right: ctx.right, top: ctx.y + 110, rows, ballRadius: ctx.ballRadius, pitch: 6.5, minPitch: 90 });
    const slots = grid.pegs.filter((p) => !p.wall).map((p) => p.index);
    const bumpers = new Set(random.sample(slots, 2 + Math.round(ctx.difficulty * 2)));
    return { height: 110 + grid.span + 140, obstacles: gridObstacles(ctx, grid, { bumpers, kick: 6 + ctx.difficulty * 3 }) };
  },
};

const tunnel: TrackModuleDefinition = {
  kind: "tunnel",
  label: "Tunnel",
  weight: 1,
  build(ctx) {
    const { left, right, y, random } = ctx;
    const width = right - left;
    const minChannel = ctx.ballRadius * 2 * 3.2;
    const channels = width / 3 >= minChannel ? random.int(2, 3) : 2;
    const channelW = width / channels;
    const height = 780;
    const top = y + 170;
    const bottom = y + height - 90;
    const obstacles: ObstacleSpec[] = [];
    for (let i = 1; i < channels; i++) {
      const x = left + i * channelW;
      obstacles.push(
        solid(`${ctx.id}-wall-${i}`, "tunnel", [
          { kind: "rect", x, y: (top + bottom) / 2, w: 20, h: bottom - top },
          { kind: "polygon", points: [{ x: x - 10, y: top }, { x, y: top - 40 }, { x: x + 10, y: top }] },
        ]),
      );
    }
    // One channel gets a sweeping gate that slows it down; luck decides who picks it.
    const slow = random.int(0, channels - 1);
    const gx = left + channelW * (slow + 0.5);
    const gateW = channelW * 0.55;
    obstacles.push(
      solid(`${ctx.id}-sweeper`, "gate", [{ kind: "rect", x: gx, y: top + (bottom - top) * 0.3, w: gateW, h: 18 }], {
        motion: { type: "oscillate", axis: { x: 1, y: 0 }, amplitude: (channelW - gateW) / 2 - 14, period: random.float(1.6, 2.6), phase: random.float(0, 6) },
      }),
    );
    // Two staggered rows near each channel's exit, so no channel is a free fall.
    for (let i = 0; i < channels; i++) {
      const inner = { left: left + i * channelW + (i > 0 ? 10 : 0), right: left + (i + 1) * channelW - (i < channels - 1 ? 10 : 0) };
      const grid = pegGrid({ ...inner, top: 0, rows: 2, ballRadius: ctx.ballRadius, minPitch: 90 });
      const shifted = { ...grid, pegs: grid.pegs.map((p) => ({ ...p, y: bottom - 50 - grid.span + p.y })) };
      obstacles.push(...gridObstacles({ ...ctx, id: `${ctx.id}-c${i}` }, shifted));
    }
    return { height, obstacles };
  },
};

const jump: TrackModuleDefinition = {
  kind: "jump",
  label: "Jump",
  weight: 2,
  build(ctx) {
    const { left, right, y, random } = ctx;
    const width = right - left;
    const side = random.sign();
    const from = side < 0 ? left - 10 : right + 10;
    const dir = -side;
    const rampEnd = { x: from + dir * width * 0.52, y: y + 60 + width * 0.52 * 0.36 };
    const lip = { x: rampEnd.x + dir * 70, y: rampEnd.y - 22 };
    const landingY = y + 560;
    const landFrom = { x: side < 0 ? right + 10 : left - 10, y: landingY };
    const landTo = { x: landFrom.x + side * width * 0.5, y: landingY + width * 0.5 * 0.3 };
    return {
      height: 760,
      route: [{ x: (left + right) / 2, y }, { x: lip.x, y: lip.y - ctx.ballRadius }, { x: landTo.x, y: landTo.y - ctx.ballRadius }],
      obstacles: [
        solid(`${ctx.id}-ramp`, "ramp", [bar({ x: from, y: y + 60 }, rampEnd, 22), bar(rampEnd, lip, 22)], { friction: 0.005, restitution: 0.2 }),
        solid(`${ctx.id}-landing`, "ramp", [bar(landFrom, landTo, 22)], { friction: 0.01 }),
      ],
    };
  },
};

const platforms: TrackModuleDefinition = {
  kind: "platforms",
  label: "Platforms",
  weight: 2,
  build(ctx) {
    const { left, right, y, random } = ctx;
    const width = right - left;
    const n = random.int(3, 4);
    const pw = width * 0.3;
    const spacing = 210;
    const r = ctx.ballRadius;
    // Platforms stop short of the walls (never pinch a ball against them);
    // ramps above steer wall-huggers into their stroke.
    const margin = 2.2 * r + 10;
    const reach = margin + 0.5 * r;
    const first = 30 + reach * 0.55 + 2.6 * r + 10;
    const obstacles: ObstacleSpec[] = wallDeflectors(ctx, y + 30, reach);
    for (let i = 0; i < n; i++) {
      const cy = y + first + i * spacing;
      const amplitude = (width - pw) / 2 - margin;
      obstacles.push(
        solid(`${ctx.id}-platform-${i}`, "platform", [
          { kind: "rect", x: (left + right) / 2, y: cy, w: pw, h: 20, angle: random.float(-0.14, 0.14) },
        ], {
          motion: { type: "oscillate", axis: { x: 1, y: 0 }, amplitude, period: random.float(2.4, 4.4), phase: random.float(0, Math.PI * 2) },
        }),
      );
    }
    return { height: first + (n - 1) * spacing + 200, obstacles };
  },
};

function paddleWheel(ctx: ModuleContext, id: string, centre: Vec2, hub: number, reach: number, paddles: number, speed: number): ObstacleSpec {
  const shapes: ShapeSpec[] = [{ kind: "circle", x: centre.x, y: centre.y, r: hub }];
  for (let i = 0; i < paddles; i++) {
    const a = (i / paddles) * Math.PI;
    shapes.push({ kind: "rect", x: centre.x, y: centre.y, w: reach * 2, h: 18, angle: a });
  }
  return solid(id, "wheel", shapes, { motion: { type: "rotate", speed, pivot: centre, phase: ctx.random.float(0, 1) }, restitution: 0.5 });
}

const bottleneck: TrackModuleDefinition = {
  kind: "bottleneck",
  label: "Bottleneck",
  weight: 2,
  build(ctx) {
    const { left, right, y, random, ballRadius: r } = ctx;
    const cx = (left + right) / 2;
    const hub = 44;
    const reach = hub + r * 1.8;
    const opening = reach * 2 + r * 2 * 3;
    const neckY = y + 480;
    const t = 24;
    // Pegs under the two lanes beside the wheel, clear of its paddles.
    const pegR = Math.max(10, 0.6 * r);
    const laneX = reach + 1.5 * r;
    const clear = reach + pegR + 2.4 * r;
    const pegY = neckY + 20 + Math.sqrt(Math.max(0, clear * clear - laneX * laneX)) + 0.3 * r;
    return {
      height: pegY - y + pegR + 2.6 * r + 30,
      obstacles: [
        ...[-1, 1].map((side) =>
          solid(`${ctx.id}-peg-${side < 0 ? "l" : "r"}`, "peg", [{ kind: "circle", x: cx + side * laneX, y: pegY, r: pegR }], { restitution: 0.6 }),
        ),
        solid(`${ctx.id}-l`, "funnel", [bar({ x: left - 10, y: y + 40 }, { x: cx - opening / 2, y: neckY }, t)], { friction: 0.01 }),
        solid(`${ctx.id}-r`, "funnel", [bar({ x: right + 10, y: y + 40 }, { x: cx + opening / 2, y: neckY }, t)], { friction: 0.01 }),
        paddleWheel(ctx, `${ctx.id}-wheel`, { x: cx, y: neckY + 20 }, hub, reach, 2, random.float(1.6, 2.6) * random.sign()),
      ],
    };
  },
};

const wheel: TrackModuleDefinition = {
  kind: "wheel",
  label: "Wheel",
  weight: 2,
  build(ctx) {
    const { left, right, y, random } = ctx;
    const width = right - left;
    const reach = width / 2 - passGap(ctx);
    const hub = reach * 0.45;
    const height = reach * 2 + 240;
    return {
      height,
      obstacles: [
        ...wallDeflectors(ctx, y + 30, passGap(ctx) + 0.5 * ctx.ballRadius),
        paddleWheel(ctx, `${ctx.id}-wheel`, { x: (left + right) / 2, y: y + height / 2 }, hub, reach, 3, random.float(0.7, 1.3) * random.sign()),
      ],
    };
  },
};

const finalDrop: TrackModuleDefinition = {
  kind: "final-drop",
  label: "Final Drop",
  weight: 0,
  build(ctx) {
    const grid = pegGrid({ left: ctx.left, right: ctx.right, top: ctx.y + 140, rows: 2, ballRadius: ctx.ballRadius, pitch: 9, minPitch: 150, maxPitch: 290, minPegRadius: 22 });
    return { height: 140 + grid.span + 190, obstacles: gridObstacles(ctx, grid, { style: "bumper", kick: 4 }) };
  },
};

const finish: TrackModuleDefinition = {
  kind: "finish",
  label: "Finish",
  weight: 0,
  build(ctx) {
    const { left, right, y } = ctx;
    const height = 420;
    return {
      height,
      obstacles: [
        solid(`${ctx.id}-floor`, "wall", [{ kind: "rect", x: (left + right) / 2, y: y + height - 20, w: right - left + 80, h: 40 }]),
      ],
      zones: [
        { id: `${ctx.id}-line`, kind: "finish", shape: { kind: "rect", x: left, y: y + 60, w: right - left, h: 48 }, visible: true },
      ],
    };
  },
};

export const TRACK_MODULES: Record<ModuleKind, TrackModuleDefinition> = {
  start,
  drop,
  zigzag,
  spinner,
  funnel,
  plinko,
  pinball,
  tunnel,
  jump,
  platforms,
  bottleneck,
  wheel,
  "final-drop": finalDrop,
  finish,
};

