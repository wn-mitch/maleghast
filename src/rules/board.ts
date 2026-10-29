// The grid's geometry: footprints, distance, line of sight and cover
// (p16, p19).

import type { Board, Cell, Terrain, Unit } from "./types";

export function index(b: Board, c: Cell): number {
  return c.row * b.size + c.col;
}

export function inBounds(b: Board, c: Cell): boolean {
  return c.col >= 0 && c.row >= 0 && c.col < b.size && c.row < b.size;
}

export function terrainAt(b: Board, c: Cell): Terrain {
  return b.terrain[index(b, c)] ?? {};
}

export function isWall(b: Board, c: Cell): boolean {
  return (b.walls[index(b, c)] ?? 0) > 0;
}

/** An empty board `size` squares on a side. */
export function emptyBoard(size: number): Board {
  const n = size * size;
  return { size, terrain: Array.from({ length: n }, () => ({})), walls: Array(n).fill(0), corpses: Array(n).fill(0) };
}

/** The squares a unit standing with its north-west square at `at` covers. */
export function footprint(at: Cell, size: 1 | 2): Cell[] {
  if (size === 1) return [at];
  return [at, { col: at.col + 1, row: at.row }, { col: at.col, row: at.row + 1 }, { col: at.col + 1, row: at.row + 1 }];
}

export function cellsOf(u: Pick<Unit, "col" | "row" | "size">): Cell[] {
  return footprint({ col: u.col, row: u.row }, u.size);
}

/** Spaces between two squares, counting a diagonal step as one (p16). */
export function steps(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
}

/** Spaces between the nearest squares of two footprints. */
export function gap(a: readonly Cell[], b: readonly Cell[]): number {
  let best = Infinity;
  for (const p of a) for (const q of b) best = Math.min(best, steps(p, q));
  return best;
}

/** Whether a footprint stands on elevation: any of its squares does. */
export function elevated(b: Board, cells: readonly Cell[]): boolean {
  return cells.some((c) => terrainAt(b, c).elevated === true);
}

/**
 * Whether the segment from `p` to `q` touches the closed square of `c`,
 * edges and corners included (Liang-Barsky clipping).
 */
export function touches(p: { x: number; y: number }, q: { x: number; y: number }, c: Cell): boolean {
  let t0 = 0, t1 = 1;
  const dx = q.x - p.x, dy = q.y - p.y;
  const clip = (den: number, num: number): boolean => {
    // Keeps the part of the segment where den * t <= num.
    if (den === 0) return num >= 0;
    const t = num / den;
    if (den > 0) { if (t < t1) t1 = t; } else if (t > t0) t0 = t;
    return t0 <= t1;
  };
  return clip(-dx, p.x - c.col) && clip(dx, c.col + 1 - p.x) && clip(-dy, p.y - c.row) && clip(dy, c.row + 1 - p.y);
}

function corners(cells: readonly Cell[]): { x: number; y: number }[] {
  const out = new Map<string, { x: number; y: number }>();
  for (const c of cells) {
    for (const [x, y] of [[c.col, c.row], [c.col + 1, c.row], [c.col, c.row + 1], [c.col + 1, c.row + 1]] as const) out.set(`${x},${y}`, { x, y });
  }
  return [...out.values()];
}

/**
 * Line of sight between two footprints (p16): some line from a corner of
 * one to a corner of the other touches no wall, not even a wall's edge. A
 * wall that is itself one of the footprints (a targeted wall) doesn't block.
 */
export function sees(b: Board, from: readonly Cell[], to: readonly Cell[]): boolean {
  const own = new Set([...from, ...to].map((c) => index(b, c)));
  const blockers: Cell[] = [];
  for (let row = 0; row < b.size; row++) {
    for (let col = 0; col < b.size; col++) {
      const c = { col, row };
      if (isWall(b, c) && !own.has(index(b, c))) blockers.push(c);
    }
  }
  const a = corners(from), z = corners(to);
  return a.some((p) => z.some((q) => !blockers.some((w) => touches(p, q, w))));
}

const COMPASS: readonly Cell[] = [{ col: 0, row: -1 }, { col: 1, row: 0 }, { col: 0, row: 1 }, { col: -1, row: 0 }];

/**
 * Whether `target` has cover against an attacker at `from` (p16). A unit
 * has cover from a wall it stands beside, or from an elevated space beside
 * it while it stands on the ground. The edge it shares with that space
 * extends across the battlefield as a line, and the cover counts against an
 * attacker whose every square lies past that line. `extra` adds squares
 * that give cover as a wall does, such as units some rules let allies use.
 */
export function inCover(b: Board, target: readonly Cell[], from: readonly Cell[], extra: ReadonlySet<number> = new Set()): boolean {
  const low = !elevated(b, target);
  const minCol = Math.min(...target.map((c) => c.col)), maxCol = Math.max(...target.map((c) => c.col));
  const minRow = Math.min(...target.map((c) => c.row)), maxRow = Math.max(...target.map((c) => c.row));
  for (const d of COMPASS) {
    const shields = target.some((c) => {
      const n = { col: c.col + d.col, row: c.row + d.row };
      if (!inBounds(b, n) || target.some((t) => t.col === n.col && t.row === n.row)) return false;
      return isWall(b, n) || extra.has(index(b, n)) || (low && terrainAt(b, n).elevated === true);
    });
    if (!shields) continue;
    const past = (c: Cell) => d.col > 0 ? c.col > maxCol : d.col < 0 ? c.col < minCol : d.row > 0 ? c.row > maxRow : c.row < minRow;
    if (from.every(past)) return true;
  }
  return false;
}
