// Moving across the grid (p13, p19): orthogonal steps, through allies but
// not foes or walls, with elevation and adverse terrain costing extra.

import { cellsOf, elevated, footprint, inBounds, index, isWall, terrainAt } from "./board";
import type { Board, Cell, Unit } from "./types";

const COMPASS: readonly Cell[] = [{ col: 0, row: -1 }, { col: 1, row: 0 }, { col: 0, row: 1 }, { col: -1, row: 0 }];

/** Where a MOVE can end, what it costs and the way there (the start left out). */
export interface Reach {
  readonly cost: number;
  readonly path: readonly Cell[];
}

/**
 * The movement a step from `from` to `to` costs a unit of `size`: 1, +1 to
 * climb from the ground onto elevation unless stairs are under either end,
 * and +1 to leave adverse terrain.
 */
export function stepCost(b: Board, from: Cell, to: Cell, size: 1 | 2): number {
  const was = footprint(from, size), now = footprint(to, size);
  const stairs = [...was, ...now].some((c) => terrainAt(b, c).stairs === true);
  const climb = !stairs && !elevated(b, was) && elevated(b, now) ? 1 : 0;
  const leave = was.some((c) => terrainAt(b, c).adverse === true) ? 1 : 0;
  return 1 + climb + leave;
}

/**
 * Every square `mover` could end a MOVE on, keyed by board index, with its
 * cheapest cost and path. `budget` is the movement it has; with `maxSpaces`
 * set (a slowed unit), a path may not run longer than that many spaces. A
 * unit can always move one space, whatever it costs (p13).
 */
export function reachable(b: Board, units: readonly Unit[], mover: Unit, budget: number, maxSpaces = Infinity): Map<number, Reach> {
  const foes = new Set<number>(), allies = new Set<number>();
  for (const u of units) {
    if (u.id === mover.id || u.hp <= 0) continue;
    for (const c of cellsOf(u)) (u.side === mover.side ? allies : foes).add(index(b, c));
  }
  const fits = (at: Cell) => footprint(at, mover.size).every((c) => inBounds(b, c) && !isWall(b, c) && !foes.has(index(b, c)));
  const free = (at: Cell) => footprint(at, mover.size).every((c) => !allies.has(index(b, c)));
  const start = { col: mover.col, row: mover.row };
  const best = new Map<number, { cost: number; path: Cell[] }>([[index(b, start), { cost: 0, path: [] }]]);
  const open: { at: Cell; cost: number; path: Cell[] }[] = [{ at: start, cost: 0, path: [] }];
  while (open.length) {
    open.sort((p, q) => p.cost - q.cost);
    const { at, cost, path } = open.shift()!;
    if (cost > (best.get(index(b, at))?.cost ?? Infinity)) continue;
    if (path.length >= maxSpaces) continue;
    for (const d of COMPASS) {
      const to = { col: at.col + d.col, row: at.row + d.row };
      if (!fits(to)) continue;
      const next = cost + stepCost(b, at, to, mover.size);
      // The first space is always open to a unit with any movement at all.
      if (next > budget && !(path.length === 0 && budget >= 1)) continue;
      const k = index(b, to);
      if (next >= (best.get(k)?.cost ?? Infinity)) continue;
      const route = [...path, to];
      best.set(k, { cost: next, path: route });
      open.push({ at: to, cost: next, path: route });
    }
  }
  const out = new Map<number, Reach>();
  for (const [k, r] of best) {
    const at = { col: k % b.size, row: Math.floor(k / b.size) };
    if (r.path.length > 0 && free(at)) out.set(k, r);
  }
  return out;
}
