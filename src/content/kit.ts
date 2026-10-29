// Shared pieces for the houses' cards: common traits, targeting shorthands,
// and effects several cards repeat.

import { cellsOf, gap, inBounds, isWall, terrainAt } from "../rules/board";
import type { Ability, Ctx, Gen, Targeting, Trait } from "../rules/content";
import { around, force, hasTrait, hurtWall, log, nameOf, unit } from "../rules/effects";
import type { Game, Target } from "../rules/state";
import type { Cell, Unit } from "../rules/types";

export const FORMATION: Trait = { id: "formation", name: "Formation", text: "+1D on attacks while adjacent to an ally." };
export const THRALL: Trait = { id: "thrall", name: "Thrall", text: "Two fill one unit slot; may activate two at a time." };
export const TYRANT: Trait = { id: "tyrant", name: "Tyrant", text: "A 2x2 unit." };
export const BLOOD_RAGE: Trait = { id: "bloodRage", name: "Blood Rage", text: "At 0 hp it isn't slain but gains 1 strength; any further damage slays it." };

export const SELF: Targeting = { kind: "self" };
export const MELEE: Targeting = { kind: "unit", min: 1, max: 1, who: "other", walls: true };
export const LINE: Targeting = { kind: "line" };
export const DIRECTION: Targeting = { kind: "direction" };

/** A unit target in `min`-`max` range. Attacks may also be aimed at walls. */
export function reach(min: number, max: number, who: "other" | "foe" | "ally" | "any" = "other", walls = false): Targeting {
  return { kind: "unit", min, max, who, walls };
}

/** The unit an ability is aimed at, or null for a wall or a dead unit. */
export function aimed(x: Ctx, t: Target): Unit | null {
  return t.kind === "unit" ? unit(x.g, t.id) ?? null : null;
}

/** An attack aimed at a wall hits it for `n` (walls have no defense; p19). Whether `t` was a wall. */
export function atWall(x: Ctx, t: Target, n: number): boolean {
  if (t.kind !== "cell" || !isWall(x.g.board, t.cell)) return false;
  hurtWall(x.g, t.cell, n);
  return true;
}

/** Whether an ability is a ranged one: it has a range and isn't melee. */
export function ranged(a: Ability): boolean {
  return a.target.kind === "unit" && a.melee !== true && a.target.max > 1;
}

/** Add a lasting effect `name` on `on`, ending at the start or end of `owner`'s turn `ahead` turns from now. */
export function lasting(g: Game, name: string, on: Unit, owner: Unit, at: "start" | "end", ahead = 1): void {
  g.lasting.push({ name, on: on.id, owner: owner.id, at, turn: (g.turns[owner.id] ?? 0) + ahead });
}

/** A lasting effect with no end of its own. */
export const FOREVER = 1e9;

export function adjacentTo(g: Game, u: Unit): Unit[] {
  return around(g, cellsOf(u));
}

/** Whether `u` stands beside something that gives cover: a wall, or elevation while it is on the ground (p16). */
export function besideCover(g: Game, u: Unit): boolean {
  const own = cellsOf(u);
  const low = !own.some((c) => terrainAt(g.board, c).elevated);
  return own.some((c) => [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dc, dr]) => {
    const n = { col: c.col + dc!, row: c.row + dr! };
    if (!inBounds(g.board, n) || own.some((o) => o.col === n.col && o.row === n.row)) return false;
    return isWall(g.board, n) || (low && terrainAt(g.board, n).elevated === true);
  }));
}

/** Ask the acting side to pick one of `options`; null if it declines an optional pick or there are none. */
export function* choose(x: Ctx, options: readonly Unit[], prompt: string, optional = false): Gen<Unit | null> {
  if (!options.length) return null;
  if (options.length === 1 && !optional) return options[0]!;
  const pick = yield { kind: "unit", side: x.side, prompt, options: options.map((u) => u.id), optional };
  return typeof pick === "number" ? options[pick] ?? null : null;
}

/** Push each of `units` `n` away from `from`, nearest first. */
export function* pushAll(x: Ctx, units: readonly Unit[], n: number, from: readonly Cell[]): Gen {
  const order = [...units].sort((a, b) => gap(cellsOf(a), from) - gap(cellsOf(b), from));
  for (const u of order) if (unit(x.g, u.id)) yield* force(x, u, n, from, true);
}

export function foesOf(g: Game, u: Unit): Unit[] {
  return g.units.filter((v) => v.side !== u.side);
}

/** Whether a curse lands: a curseproof unit shrugs off curse damage and effects (p18). */
export function cursed(x: Ctx, v: Unit): boolean {
  if (!hasTrait(x.g, v, "curseproof")) return true;
  log(x.g, `${nameOf(v)} is curseproof`, v.id);
  return false;
}
