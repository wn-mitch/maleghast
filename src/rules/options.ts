// What a player can do right now, as options: each option is a set
// of squares to highlight and the command a click on them sends. The rules
// engine decides what is legal; the client and the AI only offer what it accepts.

import { cellsOf, inBounds } from "./board";
import { defOf } from "./content";
import type { Ability } from "./content";
import { hasTrait, unit } from "./effects";
import { actsOf, apply, deployRows, moveBudget, targetError } from "./engine";
import { reachable } from "./movement";
import type { Command, Game, Target } from "./state";
import { necromancerOf, soulsOf } from "./triggers";
import type { Cell, Unit } from "./types";

export interface Option {
  readonly cells: readonly Cell[];
  readonly cmd: Command;
}

const COMPASS: readonly Cell[] = [{ col: 0, row: -1 }, { col: 1, row: 0 }, { col: 0, row: 1 }, { col: -1, row: 0 }];

/** Why the engine would refuse `cmd`, or null if it would take it. */
export function refusal(g: Game, cmd: Command): string | null {
  try {
    apply(g, cmd);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function allCells(g: Game): Cell[] {
  const out: Cell[] = [];
  for (let row = 0; row < g.board.size; row++) for (let col = 0; col < g.board.size; col++) out.push({ col, row });
  return out;
}

/** Where `side` may deploy a reserve unit. */
export function deployOptions(g: Game, side: number, id: string): Option[] {
  const [lo, hi] = deployRows(g, side);
  return allCells(g)
    .filter((c) => c.row >= lo && c.row <= hi)
    .map((at) => ({ cells: [at], cmd: { kind: "deploy", side, unit: id, at } as const }))
    .filter((o) => refusal(g, o.cmd) === null);
}

/** Whether `u` may spend a berserk token as speed on its MOVE (Fueled by Rage). */
export function canBoost(g: Game, u: Unit): boolean {
  return hasTrait(g, u, "fueledByRage") && (u.tokens.berserk ?? 0) > 0 && !u.tokens.speed;
}

/** The spaces an active unit can MOVE to, each with the cheapest path. */
export function moveOptions(g: Game, side: number, id: string, boost: boolean): Option[] {
  const u = unit(g, id);
  const a = g.active.find((x) => x.id === id);
  if (!u || !a || u.side !== side || a.moves + (a.acted ? 1 : 0) >= 2 || hasTrait(g, u, "rooted")) return [];
  const { budget, maxSpaces } = moveBudget(g, u);
  const reach = reachable(g.board, g.units, u, budget + (boost && canBoost(g, u) ? 2 : 0), maxSpaces);
  return [...reach.values()].map((r) => {
    const end = r.path[r.path.length - 1]!;
    const cmd: Command = boost && canBoost(g, u) ? { kind: "move", side, unit: id, path: r.path, boost: true } : { kind: "move", side, unit: id, path: r.path };
    return { cells: cellsOf({ ...end, size: u.size }), cmd };
  });
}

/** Every target `a` used by `u` could legally take, with the squares that stand for each. */
function targets(g: Game, u: Unit, a: Ability): { t: Target; cells: Cell[] }[] {
  const tg = a.target;
  if (tg.kind === "self") return [{ t: { kind: "self" }, cells: cellsOf(u) }];
  if (tg.kind === "direction") {
    // A direction is shown as the square beside the user that way.
    return COMPASS.map((d) => {
      const edge = cellsOf(u).map((c) => ({ col: c.col + d.col, row: c.row + d.row })).filter((c) => !cellsOf(u).some((o) => o.col === c.col && o.row === c.row));
      return { t: { kind: "direction", d } as Target, cells: edge.filter((c) => inBounds(g.board, c)) };
    }).filter((o) => o.cells.length > 0);
  }
  const out: { t: Target; cells: Cell[] }[] = [];
  for (const v of g.units) {
    const t: Target = { kind: "unit", id: v.id };
    if (targetError(g, u, a, t) === null) out.push({ t, cells: cellsOf(v) });
  }
  for (const c of allCells(g)) {
    const t: Target = { kind: "cell", cell: c };
    if (targetError(g, u, a, t) === null) out.push({ t, cells: [c] });
  }
  return out;
}

/** The targets an active unit's ACT ability can take now. */
export function actOptions(g: Game, side: number, id: string, abilityId: string): Option[] {
  const u = unit(g, id);
  const a = u && actsOf(u).find((x) => x.id === abilityId);
  if (!u || !a) return [];
  return targets(g, u, a)
    .map(({ t, cells }) => ({ cells, cmd: { kind: "act", side, unit: id, ability: abilityId, target: t } as const }))
    .filter((o) => refusal(g, o.cmd) === null);
}

/** The SOUL abilities `side` can use by choice (not the triggered ones). */
export function soulAbilities(g: Game, side: number): Ability[] {
  const n = necromancerOf(g, side);
  return n ? soulsOf(n).filter((a) => a.soul && !a.soul.trigger) : [];
}

export function soulOptions(g: Game, side: number, abilityId: string): Option[] {
  const n = necromancerOf(g, side);
  const a = n && soulsOf(n).find((x) => x.id === abilityId);
  if (!n || !a) return [];
  return targets(g, n, a)
    .map(({ t, cells }) => ({ cells, cmd: { kind: "soul", side, ability: abilityId, target: t } as const }))
    .filter((o) => refusal(g, o.cmd) === null);
}

/** The answers to a waiting cell or unit choice that's `side`'s to make. */
export function requestOptions(g: Game, side: number): Option[] {
  const r = g.pending?.request;
  if (!r || r.side !== side) return [];
  if (r.kind === "cell") return r.options.map((c, i) => ({ cells: [c], cmd: { kind: "answer", side, answer: i } }));
  if (r.kind === "unit") {
    return r.options.flatMap((id, i) => {
      const v = unit(g, id);
      return v ? [{ cells: cellsOf(v), cmd: { kind: "answer", side, answer: i } as const }] : [];
    });
  }
  return [];
}

/** The option a click on `cell` (or on a unit standing there) chooses. */
export function chosen(options: readonly Option[], cell: Cell): Option | undefined {
  return options.find((o) => o.cells.some((c) => c.col === cell.col && c.row === cell.row));
}

/** Units `side` could start a turn with now. */
export function readyUnits(g: Game, side: number): Unit[] {
  if (g.phase !== "battle" || g.side !== side || g.active.length > 0 || g.pending) return [];
  return g.units.filter((u) => u.side === side && !u.done);
}

export function isThrall(u: Unit): boolean {
  return defOf(u.kind).type === "thrall";
}

export interface Forecast {
  /** Dice rolled; 0 or fewer rolls two and keeps the lowest. */
  readonly dice: number;
  /** The roll needed to hit. */
  readonly needs: number;
  /** The chance to hit, 0 to 1. */
  readonly chance: number;
}

/** The chance a die pool of `dice` rolls `needs` or more: the best of the dice, or the worse of two at 0D or fewer. */
export function hitChance(dice: number, needs: number): number {
  const t = Math.min(7, Math.max(1, needs));
  return dice <= 0 ? ((7 - t) / 6) ** 2 : 1 - ((t - 1) / 6) ** dice;
}

/**
 * The attack roll `cmd` would make, read from a trial run through the engine,
 * so cover, elevation, Formation and every ability's own dice are counted
 * exactly as the real roll will count them. Null if it rolls no attack.
 */
export function forecast(g: Game, cmd: Command): Forecast | null {
  let after: Game;
  try {
    after = apply(g, cmd);
  } catch {
    return null;
  }
  const before = after.pending ? after.pending.before.log.length : g.log.length;
  for (const e of after.log.slice(before)) {
    const m = /\((-?\d+)D\) against .*'s (\d+)\+/.exec(e.text);
    if (m) {
      const dice = Number(m[1]), needs = Number(m[2]);
      return { dice, needs, chance: hitChance(dice, needs) };
    }
  }
  return null;
}
