import type { Vec2 } from "@/engine/types";

/**
 * Staggered peg grid ("Plinko rejilla") that never leaves a straight vertical
 * lane, for any ball size.
 *
 * Columns divide the width exactly. Even rows put a peg in the middle of
 * every column; odd rows put one on every column boundary, including the two
 * walls (half-embedded "wall bumps"). Seen from above, peg centres are then
 * spaced pitch/2 apart edge to edge, so every lane passes within pitch/4 of a
 * peg centre. The peg radius is sized from that so each lane really hits a
 * peg (at least `overlap` of the ball radius deep), while the gap between
 * neighbouring pegs stays wide enough for a ball to pass.
 */

export interface PegGridOptions {
  left: number;
  right: number;
  /** y of the first row. */
  top: number;
  rows: number;
  ballRadius: number;
  /** Preferred column pitch in ball radii. Default 6. */
  pitch?: number;
  /** Smallest peg radius. Default 10. */
  minPegRadius?: number;
  /** Row height / column pitch. Default 0.87 (equilateral). */
  rowRatio?: number;
  /** Clamp for the pitch in px. */
  minPitch?: number;
  maxPitch?: number;
}

export interface GridPeg extends Vec2 {
  row: number;
  /** Index within the whole grid (stable ids, seeded picks). */
  index: number;
  /** Half-embedded in a side wall. */
  wall: boolean;
  /**
   * First or last peg of a centred row: the one next to a wall. Never a
   * bumper, and a little smaller when needed, so a ball always fits between
   * it and the wall.
   */
  edge: boolean;
  /** Radius of this peg. */
  r: number;
}

export interface PegGrid {
  pegs: GridPeg[];
  pitch: number;
  pegRadius: number;
  rowHeight: number;
  /** From the first row to the last. */
  span: number;
}

/** A lane must reach this deep into a peg (fraction of the ball radius). */
export const GRID_OVERLAP = 0.3;
/** Narrowest gap between two pegs, in ball diameters. */
const MIN_GAP = 1.9;

export function pegGrid(options: PegGridOptions): PegGrid {
  const r = options.ballRadius;
  const width = options.right - options.left;
  const minPeg = options.minPegRadius ?? 10;
  const target = clamp((options.pitch ?? 6) * r, options.minPitch ?? 64, options.maxPitch ?? 220);

  let columns = Math.max(2, Math.round(width / target));
  let pitch = width / columns;
  let pegRadius = Math.max(minPeg, pitch / 4 - (1 - GRID_OVERLAP) * r + 1);
  // Too tight for the ball? Use fewer, wider columns.
  while (columns > 2 && pitch - 2 * pegRadius < MIN_GAP * 2 * r) {
    columns--;
    pitch = width / columns;
    pegRadius = Math.max(minPeg, pitch / 4 - (1 - GRID_OVERLAP) * r + 1);
  }

  const rowHeight = pitch * (options.rowRatio ?? 0.87);
  // Wall ↔ edge peg gap of 2.4 ball radii, without opening a lane next to
  // the wall bumps (they cover up to pegRadius + 0.8 r from the wall).
  const edgeRadius = Math.max(pitch / 2 - pegRadius - (1 - GRID_OVERLAP) * 2 * r + 1, Math.min(pegRadius, pitch / 2 - 2.4 * r));
  const pegs: GridPeg[] = [];
  for (let row = 0; row < options.rows; row++) {
    const y = options.top + row * rowHeight;
    const odd = row % 2 === 1;
    const count = odd ? columns + 1 : columns;
    for (let c = 0; c < count; c++) {
      const x = options.left + (odd ? c : c + 0.5) * pitch;
      const edge = !odd && (c === 0 || c === count - 1);
      pegs.push({ x, y, row, index: pegs.length, wall: odd && (c === 0 || c === columns), edge, r: edge ? edgeRadius : pegRadius });
    }
  }
  return { pegs, pitch, pegRadius, rowHeight, span: (options.rows - 1) * rowHeight };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
