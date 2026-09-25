import type { ObstacleSpec, ShapeSpec, Vec2 } from "@/engine/types";
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

/** Rejection-sample well-spaced points (seeded). */
function scatter(ctx: ModuleContext, count: number, area: { x: number; y: number; w: number; h: number }, spacing: number): Vec2[] {
  const points: Vec2[] = [];
  for (let attempt = 0; attempt < count * 40 && points.length < count; attempt++) {
    const p = { x: ctx.random.float(area.x, area.x + area.w), y: ctx.random.float(area.y, area.y + area.h) };
    if (points.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= spacing)) points.push(p);
  }
  return points;
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
    const gate = (side: -1 | 1): ObstacleSpec =>
      solid(
        `${ctx.id}-gate-${side < 0 ? "l" : "r"}`,
        "gate",
        [{ kind: "rect", x: left + width / 2 + (side * half) / 2, y: gateY, w: half, h: 22 }],
        { motion: { type: "slide", offset: { x: side * (half + 60), y: 0 }, start: gateOpensAt, duration: 0.45 } },
      );
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
    const height = 520;
    const pegR = ctx.random.float(11, 17);
    const count = 5 + Math.round(ctx.difficulty * 4);
    const pegs = scatter(
      ctx,
      count,
      { x: ctx.left + 60, y: ctx.y + 90, w: ctx.right - ctx.left - 120, h: height - 180 },
      passGap(ctx) + pegR * 2,
    );
    return {
      height,
      obstacles: pegs.map((p, i) => solid(`${ctx.id}-peg-${i}`, "peg", [{ kind: "circle", x: p.x, y: p.y, r: pegR }], { restitution: 0.7 })),
    };
  },
};

const zigzag: TrackModuleDefinition = {
  kind: "zigzag",
  label: "Zigzag",
  weight: 6,
  build(ctx) {
    const { left, right, y, random } = ctx;
    const width = right - left;
    const n = random.int(4, 6);
    const spacing = 200 + ctx.ballRadius * 2;
    const length = width * 0.76;
    let side = random.sign();
    const obstacles: ObstacleSpec[] = [];
    for (let i = 0; i < n; i++) {
      const slope = random.float(0.1, 0.17);
      const top = y + 80 + i * spacing;
      const from = { x: side < 0 ? left - 10 : right + 10, y: top };
      const to = { x: from.x - side * length * Math.cos(slope), y: top + length * Math.sin(slope) };
      obstacles.push(solid(`${ctx.id}-ramp-${i}`, "ramp", [bar(from, to, 22)], { friction: 0.01 }));
      side = side < 0 ? 1 : -1;
    }
    return { height: 80 + n * spacing + 140, obstacles };
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
    return { height, obstacles };
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
    const opening = Math.max(ctx.ballRadius * 2 * 3, width * 0.2);
    const height = 580;
    const neckY = y + height - 150;
    const t = 24;
    return {
      height,
      obstacles: [
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

const pinball: TrackModuleDefinition = {
  kind: "pinball",
  label: "Pinball",
  weight: 3,
  build(ctx) {
    const { left, right, y, random } = ctx;
    const width = right - left;
    const pegR = 12;
    const spacing = Math.max(passGap(ctx) + pegR * 2, 150);
    const rows = random.int(3, 5);
    const rowH = spacing * 0.87;
    const cols = Math.floor(width / spacing);
    const obstacles: ObstacleSpec[] = [];
    const bumperSlots = new Set(random.sample(Array.from({ length: rows * cols }, (_, i) => i), 2 + Math.round(ctx.difficulty)));
    for (let row = 0; row < rows; row++) {
      const offset = row % 2 ? spacing / 2 : 0;
      for (let col = 0; col < cols; col++) {
        const x = left + spacing / 2 + offset + col * spacing;
        if (x > right - spacing / 3) continue;
        const cy = y + 110 + row * rowH;
        const slot = row * cols + col;
        if (bumperSlots.has(slot)) {
          obstacles.push(solid(`${ctx.id}-bumper-${slot}`, "bumper", [{ kind: "circle", x, y: cy, r: 34 }], { restitution: 0.9, kick: 6 + ctx.difficulty * 3 }));
        } else {
          obstacles.push(solid(`${ctx.id}-peg-${slot}`, "peg", [{ kind: "circle", x, y: cy, r: pegR }], { restitution: 0.7 }));
        }
      }
    }
    return { height: 110 + rows * rowH + 120, obstacles };
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
      solid(`${ctx.id}-sweeper`, "gate", [{ kind: "rect", x: gx, y: (top + bottom) / 2, w: gateW, h: 18 }], {
        motion: { type: "oscillate", axis: { x: 1, y: 0 }, amplitude: (channelW - gateW) / 2 - 14, period: random.float(1.6, 2.6), phase: random.float(0, 6) },
      }),
    );
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
    const obstacles: ObstacleSpec[] = [];
    for (let i = 0; i < n; i++) {
      const cy = y + 100 + i * spacing;
      const amplitude = ((width - pw) / 2 - 20) * random.float(0.5, 1);
      obstacles.push(
        solid(`${ctx.id}-platform-${i}`, "platform", [
          { kind: "rect", x: (left + right) / 2, y: cy, w: pw, h: 20, angle: random.float(-0.14, 0.14) },
        ], {
          motion: { type: "oscillate", axis: { x: 1, y: 0 }, amplitude, period: random.float(2.4, 4.4), phase: random.float(0, Math.PI * 2) },
        }),
      );
    }
    return { height: 100 + n * spacing + 100, obstacles };
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
    const height = 680;
    const neckY = y + height - 200;
    const t = 24;
    return {
      height,
      obstacles: [
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
    const height = 640;
    const pegR = 26;
    const pegs = scatter(
      ctx,
      3 + ctx.random.int(0, 1),
      { x: ctx.left + 120, y: ctx.y + 140, w: ctx.right - ctx.left - 240, h: height - 300 },
      passGap(ctx) + pegR * 2 + 40,
    );
    return {
      height,
      obstacles: pegs.map((p, i) => solid(`${ctx.id}-peg-${i}`, "bumper", [{ kind: "circle", x: p.x, y: p.y, r: pegR }], { restitution: 0.9, kick: 4 })),
    };
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
  pinball,
  tunnel,
  jump,
  platforms,
  bottleneck,
  wheel,
  "final-drop": finalDrop,
  finish,
};

