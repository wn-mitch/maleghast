// Movement abilities use: steps (p13), straight-line MOVEs through units
// (Charge, Wild Slashes, Spin Out, p33-p34), and lines (p17).

import { cellsOf, elevated, footprint, inBounds, index, isWall, terrainAt } from "./board";
import { type Ctx, type Gen, hooks } from "./content";
import { damage, hasTrait, log, nameOf, spend, unit } from "./effects";
import { reachable, stepCost } from "./movement";
import type { Game } from "./state";
import type { Cell, Unit } from "./types";

function self(x: Ctx, u: Unit): Ctx {
  return { ...x, actor: u, side: u.side, ability: null, damaged: new Set(), retaliation: [], forced: new Set() };
}

/**
 * Carry `u` along `path` by its own movement: each hazard entered on its
 * own turn bites (p19), and enter hooks may stop it short. Whether it
 * finished the path.
 */
export function* walk(x: Ctx, u: Unit, path: readonly Cell[]): Gen<boolean> {
  const { g } = x;
  const own = g.active.some((a) => a.id === u.id);
  for (const c of path) {
    u.col = c.col;
    u.row = c.row;
    if (own && footprint(c, u.size).some((p) => terrainAt(g.board, p).hazard)) yield* damage(self(x, u), u, 1, { ignoreArmor: true, sourceless: true });
    if (!unit(g, u.id)) return false;
    let stop = false;
    for (const h of hooks.enter) if (yield* h(self(x, u), u, c)) stop = true;
    if (stop || !unit(g, u.id)) {
      log(g, `${nameOf(u)} is stopped`, u.id, [c]);
      return false;
    }
  }
  if (path.length) log(g, `${nameOf(u)} moves`, u.id, [...path]);
  return true;
}

/**
 * Let `u` step up to `n` spaces (p13): movement that isn't a MOVE, so slow
 * and speed don't touch it. `optional` lets the player stay put; `free`
 * steps ignore terrain costs.
 */
export function* step(x: Ctx, u: Unit, n: number, optional = true, free = false): Gen {
  const { g } = x;
  if (hasTrait(g, u, "rooted")) return;
  const reach = reachable(g.board, g.units, u, free ? Infinity : n, n);
  const options = [...reach.keys()].map((k) => ({ col: k % g.board.size, row: Math.floor(k / g.board.size) }));
  if (!options.length) return;
  const pick = yield { kind: "cell", side: x.side, prompt: `Step ${nameOf(u)} up to ${n}`, options, optional };
  if (typeof pick !== "number") return;
  const to = options[pick]!;
  yield* walk(x, u, reach.get(index(g.board, to))!.path);
}

/**
 * A MOVE in a straight line as far as it goes, passing through units but
 * not ending on one (p33). It stops at walls, the edge, or when the next
 * space costs more than is left; it then backs up to the last space no one
 * else stands on. The units it passed through, and the squares it crossed.
 */
export function* dash(x: Ctx, u: Unit, d: Cell, budget: number): Gen<{ passed: Unit[]; path: Cell[] }> {
  const { g } = x;
  const path: Cell[] = [];
  let at: Cell = { col: u.col, row: u.row }, left = budget;
  for (;;) {
    const next = { col: at.col + d.col, row: at.row + d.row };
    if (!footprint(next, u.size).every((c) => inBounds(g.board, c) && !isWall(g.board, c))) break;
    const cost = stepCost(g.board, at, next, u.size);
    if (cost > left && !(path.length === 0 && left >= 1)) break;
    left -= cost;
    path.push(next);
    at = next;
  }
  const taken = (c: Cell) => footprint(c, u.size).some((p) => g.units.some((v) => v !== u && cellsOf(v).some((w) => w.col === p.col && w.row === p.row)));
  while (path.length && taken(path[path.length - 1]!)) path.pop();
  const crossed = new Set(path.flatMap((c) => footprint(c, u.size)).map((c) => index(g.board, c)));
  const passed = g.units.filter((v) => v !== u && cellsOf(v).some((c) => crossed.has(index(g.board, c))));
  spend(u, "speed");
  spend(u, "slow");
  yield* walk(x, u, path);
  return { passed: passed.filter((v) => unit(g, v.id)), path };
}

/**
 * The squares of a line from `first`, a space beside `u`, running away
 * from it for `length` spaces (p17). It stops at a wall unless it
 * `pierces`, and at an elevated space unless `u` stands on elevation.
 */
export function lineCells(g: Game, u: Unit, first: Cell, length: number, pierces = false): Cell[] {
  const from = cellsOf(u).find((c) => Math.abs(c.col - first.col) + Math.abs(c.row - first.row) === 1);
  if (!from) return [];
  const d = { col: first.col - from.col, row: first.row - from.row };
  const high = elevated(g.board, cellsOf(u));
  const out: Cell[] = [];
  for (let i = 0, c = first; i < length && inBounds(g.board, c); i++, c = { col: c.col + d.col, row: c.row + d.row }) {
    if (isWall(g.board, c) && !pierces) break;
    if (terrainAt(g.board, c).elevated && !high) break;
    out.push(c);
  }
  return out;
}

/** The units standing in `cells`, nearest the start first. */
export function unitsIn(g: Game, cells: readonly Cell[]): Unit[] {
  const out: Unit[] = [];
  for (const c of cells) {
    for (const v of g.units) if (!out.includes(v) && cellsOf(v).some((w) => w.col === c.col && w.row === c.row)) out.push(v);
  }
  return out;
}
