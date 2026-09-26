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

// ── Obstacle modules (inspired by marble-race staples: pendulum hammers,
// crushers, trapdoors, tumbling drums, funnel-endurance bowls, hurdles) ──

/** Switchback ramps shared by Hammers and Hurdles: ramp i starts at a wall. */
function switchbacks(ctx: ModuleContext, n: number, spacing: number, slope: number, reach: number, top: number) {
  const { left, right, random } = ctx;
  let side = random.sign();
  return Array.from({ length: n }, (_, i) => {
    const y0 = ctx.y + top + i * spacing;
    const wallX = side < 0 ? left - 10 : right + 10;
    const dir = -side;
    const run = (right - left) * reach;
    const ramp = { from: { x: wallX, y: y0 }, to: { x: wallX + dir * run * Math.cos(slope), y: y0 + run * Math.sin(slope) }, dir, wallX, y0 };
    side = side < 0 ? 1 : -1;
    return ramp;
  });
}

/** Height of a ramp's top surface at x. */
function rampY(ramp: { from: Vec2; to: Vec2 }, x: number): number {
  const t = (x - ramp.from.x) / (ramp.to.x - ramp.from.x);
  return ramp.from.y + (ramp.to.y - ramp.from.y) * t - 11;
}

const hammers: TrackModuleDefinition = {
  kind: "hammers",
  label: "Hammers",
  weight: 2,
  build(ctx) {
    const { random, ballRadius: r } = ctx;
    const arm = 250;
    const head = Math.max(26, 1.2 * r);
    // A single rolling ball fits under the lowest swing point: the hammer
    // bats bouncing balls and breaks up piles instead of walling the ramp.
    const clearance = 2.3 * r;
    const spacing = arm + head + clearance + 3 * r + 150;
    const ramps = switchbacks(ctx, 2, spacing, 0.24, 0.8, arm + head + clearance + 60);
    const obstacles: ObstacleSpec[] = [];
    const route: Vec2[] = [{ x: (ctx.left + ctx.right) / 2, y: ctx.y }];
    ramps.forEach((ramp, i) => {
      obstacles.push(solid(`${ctx.id}-ramp-${i}`, "ramp", [bar(ramp.from, ramp.to, 22)], { friction: 0.01 }));
      const px = ramp.wallX + ramp.dir * (ctx.right - ctx.left) * random.float(0.4, 0.55);
      const pivot = { x: px, y: rampY(ramp, px) - clearance - head - arm };
      obstacles.push(
        solid(`${ctx.id}-hammer-${i}`, "hammer", [
          { kind: "circle", x: pivot.x, y: pivot.y, r: 12 },
          { kind: "rect", x: pivot.x, y: pivot.y + arm / 2, w: 14, h: arm },
          { kind: "circle", x: pivot.x, y: pivot.y + arm, r: head },
        ], {
          motion: { type: "swing", pivot, amplitude: random.float(0.8, 0.95), period: random.float(2.3, 3), phase: random.float(0, Math.PI * 2) },
          restitution: 0.7,
        }),
      );
      route.push({ x: ramp.to.x, y: ramp.to.y - r });
    });
    const last = ramps[ramps.length - 1] as (typeof ramps)[number];
    return { height: last.to.y - ctx.y + 200, obstacles, route };
  },
};

const crushers: TrackModuleDefinition = {
  kind: "crushers",
  label: "Crushers",
  weight: 2,
  build(ctx) {
    const { left, right, random, ballRadius: r } = ctx;
    const cx = (left + right) / 2;
    const levels = 3;
    const bh = 40;
    // Even fully out, the two jaws leave a ball and a half of room: they
    // shove and fling, never squeeze.
    const gap = 3 * r;
    const stub = 60;
    const reach = (right - left) / 2 - gap / 2 - stub;
    const spacing = bh + 2 * r * 2.6 + 70;
    const period = random.float(2.4, 3.2);
    const obstacles: ObstacleSpec[] = [];
    for (let k = 0; k < levels; k++) {
      const cy = ctx.y + 90 + k * spacing;
      for (const side of [-1, 1] as const) {
        const wall = side < 0 ? left : right;
        const inner = wall - side * stub;
        // A ram: flat underside, top sloping toward the middle so nothing rests
        // on it, long enough to stay in the wall at full stroke (no gap behind
        // it for a ball to fall into and get crushed against the wall).
        const shape: ShapeSpec = {
          kind: "polygon",
          points:
            side < 0
              ? [{ x: wall - 40 - reach, y: cy - bh / 2 - 26 }, { x: inner, y: cy - bh / 2 }, { x: inner, y: cy + bh / 2 }, { x: wall - 40 - reach, y: cy + bh / 2 }]
              : [{ x: wall + 40 + reach, y: cy - bh / 2 - 26 }, { x: wall + 40 + reach, y: cy + bh / 2 }, { x: inner, y: cy + bh / 2 }, { x: inner, y: cy - bh / 2 }],
        };
        obstacles.push(
          solid(`${ctx.id}-crusher-${k}-${side < 0 ? "l" : "r"}`, "piston", [shape], {
            motion: { type: "cycle", offset: { x: -side * reach, y: 0 }, period, out: 0.28, hold: 0.18, back: 0.34, phase: (k * 0.37 + (side < 0 ? 0 : 0.5)) % 1 },
            restitution: 0.5,
          }),
        );
      }
      if (k < levels - 1) {
        // Centre peg between levels closes the lane between the jaws.
        const pr = Math.max(12, 0.7 * r);
        obstacles.push(solid(`${ctx.id}-peg-${k}`, "peg", [{ kind: "circle", x: cx, y: cy + spacing / 2, r: pr }], { restitution: 0.6 }));
      }
    }
    return { height: 90 + (levels - 1) * spacing + 170, obstacles };
  },
};

const trapdoors: TrackModuleDefinition = {
  kind: "trapdoors",
  label: "Trapdoors",
  weight: 2,
  build(ctx) {
    const { left, right, random, ballRadius: r } = ctx;
    const cx = (left + right) / 2;
    const post = 20;
    // Two quadrants a side of a centre post; each has a hinged flap that
    // swings from flat (closed) to hanging (open), launching whatever sits on
    // its tip as it closes.
    const quarter = ((right - left) / 2 - post / 2) / 2;
    const flap = quarter - 3;
    const levels = 2;
    const spacing = flap + 3 * r + 70;
    const period = random.float(2.6, 3.6);
    const obstacles: ObstacleSpec[] = [];
    for (let k = 0; k < levels; k++) {
      const hy = ctx.y + 80 + k * spacing;
      // Hinges: outer wall, post, post, outer wall; flaps point inward.
      const hinges: { x: number; dir: 1 | -1 }[] = [
        { x: left, dir: 1 },
        { x: cx - post / 2, dir: -1 },
        { x: cx + post / 2, dir: 1 },
        { x: right, dir: -1 },
      ];
      hinges.forEach((h, i) => {
        const base = h.dir > 0 ? Math.PI / 4 : (3 * Math.PI) / 4;
        const c = { x: h.x + (Math.cos(base) * flap) / 2, y: hy + (Math.sin(base) * flap) / 2 };
        // Closed (flat) when the swing is at -π/4 (dir +1) or +π/4 (dir −1).
        const phase = (h.dir > 0 ? -Math.PI / 2 : Math.PI / 2) + random.float(-0.5, 0.5) + k * 1.3;
        obstacles.push(
          solid(`${ctx.id}-flap-${k}-${i}`, "trapdoor", [{ kind: "rect", x: c.x, y: c.y, w: flap, h: 16, angle: base }], {
            motion: { type: "swing", pivot: { x: h.x, y: hy }, amplitude: Math.PI / 4, period, phase },
            restitution: 0.4,
          }),
        );
      });
      obstacles.push(solid(`${ctx.id}-post-${k}`, "wall", [{ kind: "rect", x: cx, y: hy + spacing / 2 - 20, w: post, h: spacing - 40 }]));
    }
    return { height: 80 + (levels - 1) * spacing + flap + 3 * r + 60, obstacles };
  },
};

/** A rotating ring with `openings` evenly spaced gaps (drums, tumblers). */
function drum(id: string, centre: Vec2, radius: number, thickness: number, gap: number, openings: number, speed: number, phase: number): ObstacleSpec {
  const step = (Math.PI * 2) / openings;
  const shapes: ShapeSpec[] = Array.from({ length: openings }, (_, i) => ({
    kind: "arc" as const,
    x: centre.x,
    y: centre.y,
    radius,
    thickness,
    start: -Math.PI / 2 + i * step + gap / 2,
    end: -Math.PI / 2 + (i + 1) * step - gap / 2,
    resolution: 96,
  }));
  return solid(id, "ring", shapes, { motion: { type: "rotate", speed, pivot: centre, phase }, restitution: 0.5 });
}

const tumbler: TrackModuleDefinition = {
  kind: "tumbler",
  label: "Tumbler",
  weight: 1,
  build(ctx) {
    const { left, right, random, ballRadius: r } = ctx;
    const cx = (left + right) / 2;
    const width = right - left;
    const th = 18;
    const radius = Math.min(300, width / 2 - 4 * r - 40);
    const outer = radius + th;
    // The funnel drops everyone onto the drum. Its lips stop a ball and a
    // bit above it (nothing gets pinched against the spinning rim): balls
    // either tumble in through an opening or get spun off the shoulders.
    const lip = radius * 0.6;
    const tipY = ctx.y + 40 + Math.max(160, (width / 2 - lip) * 0.55);
    const cy = tipY + 2.8 * r + Math.sqrt(outer * outer - lip * lip);
    const gap = Math.min(0.9, (4.2 * r) / radius);
    return {
      height: cy - ctx.y + outer + 4 * r + 60,
      obstacles: [
        solid(`${ctx.id}-l`, "funnel", [bar({ x: left - 10, y: ctx.y + 40 }, { x: cx - lip, y: tipY }, 22)], { friction: 0.01 }),
        solid(`${ctx.id}-r`, "funnel", [bar({ x: right + 10, y: ctx.y + 40 }, { x: cx + lip, y: tipY }, 22)], { friction: 0.01 }),
        drum(`${ctx.id}-drum`, { x: cx, y: cy }, radius, th, gap, 3, random.float(1.3, 1.8) * random.sign(), random.float(0, Math.PI * 2)),
      ],
    };
  },
};

const bowl: TrackModuleDefinition = {
  kind: "bowl",
  label: "Bowl",
  weight: 1,
  build(ctx) {
    const { left, right, ballRadius: r } = ctx;
    const cx = (left + right) / 2;
    const th = 18;
    const radius = (right - left) / 2 - 2;
    const cy = ctx.y + 90;
    // Funnel endurance in 2D: balls swing across a U until they're slow enough
    // to drop through the hole at the bottom.
    const hole = (5 * r) / radius;
    const pegR = Math.max(12, 1.05 * r);
    const pegY = cy + radius - 2.4 * r - pegR;
    const arc = (start: number, end: number): ShapeSpec => ({ kind: "arc", x: cx, y: cy, radius, thickness: th, start, end, resolution: 160 });
    return {
      height: cy - ctx.y + radius + th + 4 * r + 60,
      obstacles: [
        solid(`${ctx.id}-bowl-l`, "funnel", [arc(Math.PI / 2 + hole / 2, Math.PI - 0.02)], { friction: 0.005, restitution: 0.3 }),
        solid(`${ctx.id}-bowl-r`, "funnel", [arc(0.02, Math.PI / 2 - hole / 2)], { friction: 0.005, restitution: 0.3 }),
        solid(`${ctx.id}-peg`, "peg", [{ kind: "circle", x: cx, y: pegY, r: pegR }], { restitution: 0.6 }),
      ],
    };
  },
};

const hurdles: TrackModuleDefinition = {
  kind: "hurdles",
  label: "Hurdles",
  weight: 2,
  build(ctx) {
    const { random, ballRadius: r } = ctx;
    const ramps = switchbacks(ctx, 2, 300 + 2 * r, 0.34, 0.78, 80);
    const obstacles: ObstacleSpec[] = [];
    const route: Vec2[] = [{ x: (ctx.left + ctx.right) / 2, y: ctx.y }];
    ramps.forEach((ramp, i) => {
      obstacles.push(solid(`${ctx.id}-ramp-${i}`, "ramp", [bar(ramp.from, ramp.to, 22)], { friction: 0.01 }));
      // Humps along the ramp: balls hop them, the unlucky ones bounce back.
      const count = random.int(2, 3);
      for (let h = 0; h < count; h++) {
        const t = 0.3 + (0.55 * (h + random.float(0.2, 0.8))) / count;
        const x = ramp.from.x + (ramp.to.x - ramp.from.x) * t;
        const y = rampY(ramp, x);
        const w = 3 * r;
        const hgt = Math.max(8, 0.4 * r);
        obstacles.push(
          solid(`${ctx.id}-hurdle-${i}-${h}`, "bumper", [{ kind: "polygon", points: [{ x: x - w / 2, y: y + 4 }, { x, y: y - hgt }, { x: x + w / 2, y: y + 4 }] }], { restitution: 0.5 }),
        );
      }
      route.push({ x: ramp.to.x, y: ramp.to.y - r });
    });
    const last = ramps[ramps.length - 1] as (typeof ramps)[number];
    return { height: last.to.y - ctx.y + 200, obstacles, route };
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
  hammers,
  crushers,
  trapdoors,
  tumbler,
  bowl,
  hurdles,
  "final-drop": finalDrop,
  finish,
};

