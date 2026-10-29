import { describe, expect, it } from "vitest";
import { emptyBoard, index } from "../src/rules/board";
import { type Ability, type UnitDef, register } from "../src/rules/content";
import { attack, damage, force, unit } from "../src/rules/effects";
import { RuleError, apply } from "../src/rules/engine";
import { newGame } from "../src/rules/setup";
import type { Command, Game } from "../src/rules/state";
import type { Cell } from "../src/rules/types";

const at = (col: number, row: number): Cell => ({ col, row });

const shove: Ability = {
  id: "shove", name: "Shove", tags: "Melee, push", text: "Push 2", melee: true,
  target: { kind: "unit", min: 1, max: 1, who: "other" },
  *resolve(x, t) {
    if (t.kind === "unit") yield* force(x, unit(x.g, t.id)!, 2, [{ col: x.actor.col, row: x.actor.row }], true);
  },
};
const shot: Ability = {
  id: "shot", name: "Shot", tags: "Attack, range 2-4, reload", text: "2 damage", attack: true, reload: true,
  target: { kind: "unit", min: 2, max: 4, who: "foe" },
  *resolve(x, t) {
    if (t.kind !== "unit") return;
    const v = unit(x.g, t.id)!;
    if ((yield* attack(x, v)).hit) yield* damage(x, v, 2);
  },
};
const bash: Ability = {
  id: "bash", name: "Bash", tags: "Attack, melee", text: "On hit: 1 damage and push 1", attack: true, melee: true,
  target: { kind: "unit", min: 1, max: 1, who: "foe" },
  *resolve(x, t) {
    if (t.kind !== "unit") return;
    const v = unit(x.g, t.id)!;
    if (!(yield* attack(x, v)).hit) return;
    yield* damage(x, v, 1);
    yield* force(x, v, 1, [{ col: x.actor.col, row: x.actor.row }], true);
  },
};
const base = { house: "test", size: 1 as const, armor: "none" as const, traits: [] };
const lich: UnitDef = { ...base, id: "t-lich", name: "Lich", type: "necromancer", mv: 4, hp: 8, df: 4, acts: [shove, shot, bash] };
const brute: UnitDef = { ...base, id: "t-brute", name: "Brute", type: "scion", mv: 3, hp: 4, df: 3, acts: [shove, shot] };
const raged: UnitDef = { ...brute, id: "t-raged", name: "Raged", traits: [{ id: "bloodRage", name: "Blood Rage", text: "" }] };
register(lich, brute, raged);


/**
 * A duel on an empty 8x8 board at the start of round 1: each side's lich
 * and one unit, deployed on their edges and then set where the test wants
 * them, in the order side 0's lich, its unit, side 1's lich, its unit.
 */
function duel(seed: number, placing: [Cell, Cell, Cell, Cell], kinds: [string, string] = ["t-brute", "t-brute"]): Game {
  let g = newGame({ board: emptyBoard(8), seed, sides: [{ necromancer: "t-lich", picks: [], units: [kinds[0]] }, { necromancer: "t-lich", picks: [], units: [kinds[1]] }] });
  const order = [0, 1].map((s) => g.reserve.filter((u) => u.side === s).map((u) => u.id));
  for (const s of [g.first, 1 - g.first]) {
    for (const [i, id] of order[s]!.entries()) g = apply(g, { kind: "deploy", side: s, unit: id, at: at(i, s === 0 ? 7 : 0) });
  }
  [...order[0]!, ...order[1]!].forEach((id, i) => Object.assign(unit(g, id)!, placing[i]!));
  return g;
}

const units = (g: Game, side: number) => g.units.filter((u) => u.side === side);

describe("deployment and turns", () => {
  it("deploys within two rows of a side's own edge only", () => {
    const g = newGame({ board: emptyBoard(8), seed: 1, sides: [{ necromancer: "t-lich", picks: [], units: [] }, { necromancer: "t-lich", picks: [], units: [] }] });
    const s = g.first, id = g.reserve.find((u) => u.side === s)!.id;
    const far = s === 0 ? at(0, 5) : at(0, 2), near = s === 0 ? at(0, 6) : at(0, 1);
    expect(() => apply(g, { kind: "deploy", side: s, unit: id, at: far })).toThrow(RuleError);
    expect(apply(g, { kind: "deploy", side: s, unit: id, at: near }).units).toHaveLength(1);
  });

  it("alternates sides, and lets a unit MOVE then ACT but not ACT twice or move three times", () => {
    let g = duel(7, [at(0, 7), at(1, 7), at(0, 0), at(1, 0)]);
    expect(g.phase).toBe("battle");
    const s = g.side, me = units(g, s)[1]!;
    g = apply(g, { kind: "activate", side: s, units: [me.id] });
    const dir = s === 0 ? -1 : 1;
    g = apply(g, { kind: "move", side: s, unit: me.id, path: [at(me.col, me.row + dir)] });
    g = apply(g, { kind: "move", side: s, unit: me.id, path: [at(me.col, me.row + 2 * dir)] });
    expect(() => apply(g, { kind: "move", side: s, unit: me.id, path: [at(me.col, me.row + 3 * dir)] })).toThrow("no MOVE left");
    expect(() => apply(g, { kind: "act", side: s, unit: me.id, ability: "shove", target: { kind: "self" } })).toThrow("no ACT left");
    g = apply(g, { kind: "end", side: s });
    expect(g.side).toBe(1 - s);
    expect(() => apply(g, { kind: "activate", side: s, units: [me.id] })).toThrow("other side's turn");
  });

  it("refuses a MOVE through a foe or longer than MV", () => {
    let g = duel(7, [at(3, 6), at(1, 7), at(3, 5), at(1, 0)]);
    const s = 0, me = units(g, 0)[0]!;
    if (g.side !== 0) {
      g = apply(g, { kind: "activate", side: 1, units: [units(g, 1)[1]!.id] });
      g = apply(g, { kind: "end", side: 1 });
    }
    g = apply(g, { kind: "activate", side: s, units: [me.id] });
    expect(() => apply(g, { kind: "move", side: s, unit: me.id, path: [at(3, 5), at(3, 4)] })).toThrow("a foe is in the way");
    expect(() => apply(g, { kind: "move", side: s, unit: me.id, path: [at(4, 6), at(5, 6), at(6, 6), at(7, 6), at(7, 5)] })).toThrow("not enough movement");
  });

  it("ends the round when every unit has acted, then gives each side a SOUL", () => {
    let g = duel(3, [at(0, 7), at(1, 7), at(0, 0), at(1, 0)]);
    for (let i = 0; i < 4; i++) {
      const s = g.side, u = units(g, s).find((v) => !v.done)!;
      g = apply(g, { kind: "activate", side: s, units: [u.id] });
      g = apply(g, { kind: "end", side: s });
    }
    expect(g.round).toBe(2);
    expect(g.soul).toEqual([1, 1]);
    expect(g.units.every((u) => !u.done)).toBe(true);
  });

  it("calls a draw after six rounds", () => {
    let g = duel(3, [at(0, 7), at(1, 7), at(0, 0), at(1, 0)]);
    for (let i = 0; i < 24; i++) {
      const s = g.side, u = units(g, s).find((v) => !v.done)!;
      g = apply(g, { kind: "activate", side: s, units: [u.id] });
      g = apply(g, { kind: "end", side: s });
    }
    expect(g.phase).toBe("over");
    expect(g.winner).toBe("draw");
  });
});

describe("choices", () => {
  /** Side 0's brute beside side 1's brute in open ground, side 0 to act with it. */
  function facing(seed: number): Game {
    let g = duel(seed, [at(3, 6), at(0, 7), at(3, 5), at(7, 0)]);
    if (g.side === 1) {
      g = apply(g, { kind: "activate", side: 1, units: [units(g, 1)[1]!.id] });
      g = apply(g, { kind: "end", side: 1 });
    }
    return apply(g, { kind: "activate", side: 0, units: [units(g, 0)[0]!.id] });
  }

  it("stops a push for the pusher's choice of space, and replays it with the answer", () => {
    let g = facing(11);
    const me = units(g, 0)[0]!, foe = units(g, 1)[0]!;
    g = apply(g, { kind: "act", side: 0, unit: me.id, ability: "shove", target: { kind: "unit", id: foe.id } });
    expect(g.pending?.request.kind).toBe("cell");
    expect(g.pending?.request.side).toBe(0);
    const req = g.pending!.request;
    if (req.kind !== "cell") throw new Error("expected a cell choice");
    const options = req.options;
    // Straight back or either diagonal: each further from the pusher.
    expect(options).toHaveLength(3);
    expect(() => apply(g, { kind: "answer", side: 1, answer: 0 })).toThrow("other side's");
    expect(() => apply(g, { kind: "act", side: 0, unit: me.id, ability: "shot", target: { kind: "unit", id: foe.id } })).toThrow("a choice is waiting");
    const pick = options.findIndex((c) => c.col === 4);
    g = apply(g, { kind: "answer", side: 0, answer: pick });
    // The second space asks again.
    expect(g.pending).not.toBeNull();
    g = apply(g, { kind: "answer", side: 0, answer: 0 });
    expect(g.pending).toBeNull();
    const moved = unit(g, foe.id)!;
    expect(Math.max(Math.abs(moved.col - 3), Math.abs(moved.row - 6))).toBe(3);
  });

  it("keeps the dice it rolled before a choice when the command replays with the answer", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const g = facing(seed);
      const me = units(g, 0)[0]!, foe = units(g, 1)[0]!;
      const asked = apply(g, { kind: "act", side: 0, unit: me.id, ability: "bash", target: { kind: "unit", id: foe.id } });
      if (!asked.pending) continue;
      expect(asked.seed).not.toBe(g.seed);
      const done = apply(asked, { kind: "answer", side: 0, answer: 0 });
      expect(done.seed).toBe(asked.seed);
      expect(unit(done, foe.id)!.hp).toBe(unit(asked, foe.id)!.hp);
      return;
    }
    throw new Error("no seed hit");
  });

  it("won't reuse a reload ability until a MOVE is spent reloading", () => {
    let g = facing(5);
    const me = units(g, 0)[0]!, foe = units(g, 1)[0]!;
    g = apply(g, { kind: "move", side: 0, unit: me.id, path: [at(3, 7)] });
    g = apply(g, { kind: "act", side: 0, unit: me.id, ability: "shot", target: { kind: "unit", id: foe.id } });
    expect(unit(g, me.id)!.unloaded).toBe(true);
    expect(() => apply(g, { kind: "reload", side: 0, unit: me.id })).toThrow("no MOVE left");
  });
});

describe("damage", () => {
  it("slays at 0 hp, leaves a corpse and harvests a SOUL, but blood rage holds at 0 until hit again", () => {
    const g = duel(9, [at(3, 6), at(0, 7), at(3, 5), at(7, 0)], ["t-raged", "t-brute"]);
    const x = { g, actor: g.units.find((u) => u.kind === "t-lich")!, side: 0, ability: null, damaged: new Set<string>(), retaliation: [], forced: new Set<string>() };
    const run = (gen: Generator<unknown, unknown, unknown>) => { for (let r = gen.next(); !r.done; r = gen.next(null)); };
    const brute = g.units.find((u) => u.kind === "t-brute")!, rager = g.units.find((u) => u.kind === "t-raged")!;
    run(damage(x, brute, 9, { sourceless: true }));
    expect(g.units.includes(brute)).toBe(false);
    expect(g.board.corpses[index(g.board, at(7, 0))]).toBe(1);
    expect(g.soul[1]).toBe(1);
    run(damage(x, rager, 9, { sourceless: true }));
    expect(g.units.includes(rager)).toBe(true);
    expect(rager.hp).toBe(0);
    expect(rager.tokens.strength).toBe(1);
    run(damage(x, rager, 1, { sourceless: true }));
    expect(g.units.includes(rager)).toBe(false);
  });

  it("ends the battle when a necromancer falls", () => {
    const g = duel(9, [at(3, 6), at(0, 7), at(3, 5), at(7, 0)]);
    const lich = g.units.find((u) => u.kind === "t-lich" && u.side === 1)!;
    const x = { g, actor: lich, side: 1, ability: null, damaged: new Set<string>(), retaliation: [], forced: new Set<string>() };
    const gen = damage(x, lich, 99, { sourceless: true });
    for (let r = gen.next(); !r.done; r = gen.next(null));
    expect(g.winner).toBe(0);
    expect(g.phase).toBe("over");
    expect(() => apply(g, { kind: "end", side: 0 } as Command)).toThrow("over");
  });
});
