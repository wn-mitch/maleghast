// Test helpers: set up a battle with units where a test wants them, rig the
// dice, and play commands through the engine, answering its questions.

import { emptyBoard, index } from "../src/rules/board";
import { HOUSES, installContent } from "../src/content";
import { defOf } from "../src/rules/content";
import { unit } from "../src/rules/effects";
import { d6 } from "../src/rules/dice";
import { apply } from "../src/rules/engine";
import { newGame } from "../src/rules/setup";
import type { Answer, Command, Game, Request } from "../src/rules/state";
import type { Board, Cell, Unit } from "../src/rules/types";

installContent();

export const at = (col: number, row: number): Cell => ({ col, row });

export interface Placed {
  readonly kind: string;
  readonly at: Cell;
  readonly side: 0 | 1;
}

const PICKS: Record<string, string[]> = {
  operator: ["boneWall", "grenadeJump", "doubleTap"],
  warlord: ["nerveTwitch", "quench", "hellriderKick"],
};

/** The necromancer of the house a side's units serve: C.A.R.C.A.S.S. for side 0 and Goregrinders for side 1 if it has none. */
function necromancerFor(units: readonly Placed[], side: 0 | 1): string {
  const kind = units.find((u) => u.side === side)?.kind;
  const house = kind ? defOf(kind).house : side === 0 ? "carcass" : "goregrinders";
  return HOUSES[house as keyof typeof HOUSES].necromancer.id;
}

/**
 * A battle in round 1 with the given units standing where given. Each
 * side's necromancer is placed out of the way unless the list includes it;
 * `picks` overrides a necromancer's picks.
 */
export function battle(units: readonly Placed[], opts: { board?: Board; picks?: Partial<Record<string, string[]>> } = {}): Game {
  const necros = [necromancerFor(units, 0), necromancerFor(units, 1)];
  const sides = [0, 1].map((s) => ({
    necromancer: necros[s]!,
    picks: opts.picks?.[necros[s]!] ?? PICKS[necros[s]!]!,
    units: units.filter((u) => u.side === s && u.kind !== necros[s]).map((u) => u.kind),
  }));
  let g = newGame({ board: opts.board ?? emptyBoard(8), seed: 1, sides, slots: 99 });
  // Deploy anywhere legal, then move every unit where the test wants it.
  for (const s of [g.first, 1 - g.first]) {
    for (const [i, u] of g.reserve.filter((r) => r.side === s).entries()) {
      g = apply(g, { kind: "deploy", side: s, unit: u.id, at: at(i % 8, s === 0 ? 7 - Math.floor(i / 8) * 2 : Math.floor(i / 8) * 2) });
    }
  }
  const spare = [at(7, 3), at(0, 4)];
  for (const s of [0, 1]) {
    const mine = g.units.filter((u) => u.side === s);
    const wanted = units.filter((u) => u.side === s);
    const necro = mine.find((u) => u.kind === necros[s])!;
    const placed = new Set<string>();
    for (const w of wanted) {
      const u = mine.find((m) => m.kind === w.kind && !placed.has(m.id))!;
      placed.add(u.id);
      Object.assign(u, w.at);
    }
    if (!placed.has(necro.id)) Object.assign(necro, spare[s]);
  }
  return g;
}

/** The unit of `kind` on `side` (the first, or the `n`th). */
export function the(g: Game, kind: string, side = 0, n = 0): Unit {
  const u = g.units.filter((v) => v.kind === kind && v.side === side)[n];
  if (!u) throw new Error(`no ${kind} on side ${side}`);
  return u;
}

/** Make `u` the unit taking its turn, whoever's turn it was and whether or not it has had one this round. */
export function turn(g: Game, u: Unit): Game {
  unit(g, u.id)!.done = false;
  g.side = u.side;
  g.active = [];
  return apply(g, { kind: "activate", side: u.side, units: [u.id] });
}

/** Rig the next d6 rolls to come up `rolls`. */
export function rig(g: Game, ...rolls: number[]): void {
  for (let seed = 0; seed < 5_000_000; seed++) {
    let s = seed, ok = true;
    for (const want of rolls) {
      const r = d6(s);
      s = r.seed;
      if (r.roll !== want) { ok = false; break; }
    }
    if (ok) { g.seed = seed; return; }
  }
  throw new Error(`no seed rolls ${rolls.join(",")}`);
}

/**
 * Apply `cmd`, answering every question with `answer` (the first option,
 * or yes, by default). Returns the game and the requests it saw.
 */
export function play(g: Game, cmd: Command, answer: (r: Request) => Answer = (r) => (r.kind === "yesno" ? true : 0)): { g: Game; asked: Request[] } {
  const asked: Request[] = [];
  let next = apply(g, cmd);
  while (next.pending) {
    const r = next.pending.request;
    asked.push(r);
    next = apply(next, { kind: "answer", side: r.side, answer: answer(r) });
  }
  return { g: next, asked };
}

export function wall(b: Board, ...cells: Cell[]): Board {
  for (const c of cells) b.walls[index(b, c)] = 2;
  return b;
}

/** Log lines since `from`. */
export function logSince(g: Game, from: number): string[] {
  return g.log.slice(from).map((e) => e.text);
}
