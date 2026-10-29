// Goregrinders (p32-p35): aggressive melee. Blood Rage, berserk and
// retaliation. Card text is summarised; page numbers are the rulebook's.

import { cellsOf, gap, index, isWall } from "../rules/board";
import { type Ability, type Ctx, type Gen, type UnitDef, defOf } from "../rules/content";
import { around, attack, clearNegative, damage, effectDie, force, give, hurtWall, spend, tokens, unit } from "../rules/effects";
import { dash } from "../rules/moves";
import type { Target } from "../rules/state";
import type { Cell } from "../rules/types";
import { BLOOD_RAGE, DIRECTION, FORMATION, MELEE, SELF, THRALL, TYRANT, aimed, atWall, choose, cursed, lasting, reach } from "./kit";

const HOUSE = "goregrinders";

/** The budget a straight-line MOVE has: MV, +2 with speed (p18). */
function budget(x: Ctx): number {
  return defOf(x.actor.kind).mv + (tokens(x.actor, "speed") ? 2 : 0);
}

function dir(t: Target): Cell {
  return t.kind === "direction" ? t.d : { col: 0, row: -1 };
}

/** A melee attack with effect-die follow-ups: on hit `base`, then +1 on (4+) and +1 more on (6+) (Chainsaw, p33). */
function* chew(x: Ctx, t: Target, base: number, type: "physical" | "fire" = "physical", extraDice = 0): Gen {
  if (atWall(x, t, base)) return;
  const v = aimed(x, t)!;
  const r = yield* attack(x, v, "physical", extraDice);
  if (!r.hit) return;
  yield* hellwheel(x);
  yield* damage(x, v, base);
  const die = effectDie(x.g);
  for (const need of [4, 6]) {
    if (die < need || !unit(x.g, v.id)) continue;
    yield* hellwheel(x);
    yield* damage(x, v, 1, { type });
  }
}

/** Hellwheel: the Painwheel may spend a speed token as a strength token (p34). */
function* hellwheel(x: Ctx): Gen {
  if (x.actor.kind !== "painwheel" || tokens(x.actor, "strength") || !tokens(x.actor, "speed")) return;
  const yes = yield { kind: "yesno", side: x.side, prompt: "Spend a speed token as strength?" };
  if (yes === true && spend(x.actor, "speed")) give(x.g, x.actor, "strength");
}

const charge: Ability = {
  id: "charge", name: "Charge", tags: "Self", text: "MOVE as far as possible in a straight line, passing through units; each unit passed through takes 1 damage.",
  target: DIRECTION,
  *resolve(x, t) {
    const { passed } = yield* dash(x, x.actor, dir(t), budget(x));
    for (const v of passed) yield* damage(x, v, 1);
  },
};

const cleave: Ability = {
  id: "cleave", name: "Cleave", tags: "Melee, attack", text: "On hit: 1 damage, and 1 damage to another adjacent unit.",
  attack: true, melee: true, target: MELEE,
  *resolve(x, t) {
    if (atWall(x, t, 1)) return;
    const v = aimed(x, t)!;
    if (!(yield* attack(x, v)).hit) return;
    yield* damage(x, v, 1);
    const other = yield* choose(x, around(x.g, cellsOf(x.actor)).filter((u) => u !== v), "Cleave: 1 damage to another adjacent unit");
    if (other) yield* damage(x, other, 1);
  },
};

export const warhead: UnitDef = {
  id: "warhead", name: "Warhead", house: HOUSE, type: "thrall", mv: 4, hp: 2, df: 3, armor: "none", size: 1,
  traits: [BLOOD_RAGE, THRALL], acts: [charge, cleave],
};

const rev: Ability = {
  id: "rev", name: "Rev", tags: "Self", text: "Gain 1 strength and 1 speed; (5+) and retaliation until the start of its next turn.",
  target: SELF,
  *resolve(x) {
    give(x.g, x.actor, "strength");
    give(x.g, x.actor, "speed");
    if (effectDie(x.g) >= 5) lasting(x.g, "retaliation", x.actor, x.actor, "start");
  },
};

const chainsaw: Ability = {
  id: "chainsaw", name: "Chainsaw", tags: "Melee, attack", text: "On hit: 1 damage; (4+) 1 damage again; (6+) 1 damage again.",
  attack: true, melee: true, target: MELEE,
  *resolve(x, t) {
    yield* chew(x, t, 1);
  },
};

const wildSlashes: Ability = {
  id: "wildSlashes", name: "Wild Slashes", tags: "Self", text: "MOVE as far as possible in a straight line; then every unit adjacent to any space of the MOVE takes 1 damage.",
  target: DIRECTION,
  *resolve(x, t) {
    const start = { col: x.actor.col, row: x.actor.row };
    const { path } = yield* dash(x, x.actor, dir(t), budget(x));
    const swept = [start, ...path].flatMap((c) => cellsOf({ ...c, size: x.actor.size }));
    const hit = x.g.units.filter((v) => v !== x.actor && gap(cellsOf(v), swept) <= 1);
    for (const v of hit) yield* damage(x, v, 1);
  },
};

export const carnifex: UnitDef = {
  id: "carnifex", name: "Carnifex", house: HOUSE, type: "scion", mv: 4, hp: 4, df: 3, armor: "none", size: 1,
  traits: [BLOOD_RAGE], acts: [rev, chainsaw, wildSlashes],
};

const painFrenzy: Ability = {
  id: "painFrenzy", name: "Pain Frenzy", tags: "Curse, range 3", text: "The unit gains 2 berserk or 2 speed.",
  curse: true, target: reach(1, 3),
  *resolve(x, t) {
    const v = aimed(x, t);
    if (!v || !cursed(x, v)) return;
    const berserk = yield { kind: "yesno", side: x.side, prompt: "Pain Frenzy: 2 berserk? (No gives 2 speed)" };
    give(x.g, v, berserk === true ? "berserk" : "speed", 2);
  },
};

const cauterize: Ability = {
  id: "cauterize", name: "Cauterize", tags: "Curse, range 3", text: "Clear all negative tokens on self or a unit, then 1 fire damage to it that can't slay it.",
  curse: true, target: reach(0, 3, "any"),
  *resolve(x, t) {
    const v = aimed(x, t);
    if (!v || !cursed(x, v)) return;
    clearNegative(v);
    yield* damage(x, v, 1, { type: "fire", cannotSlay: true });
  },
};

const meatHook: Ability = {
  id: "meatHook", name: "Meat Hook", tags: "Pull, range 3", text: "Pull the unit 3.",
  target: reach(1, 3),
  *resolve(x, t) {
    const v = aimed(x, t);
    if (v) yield* force(x, v, 3, cellsOf(x.actor), false);
  },
};

export const painGhoul: UnitDef = {
  id: "painGhoul", name: "Pain Ghoul", house: HOUSE, type: "freak", mv: 4, hp: 4, df: 3, armor: "none", size: 1,
  traits: [BLOOD_RAGE], acts: [painFrenzy, cauterize, meatHook],
};

const exfoliate: Ability = {
  id: "exfoliate", name: "Exfoliate", tags: "Melee, attack", text: "On hit: 1 damage; (4+) 1 damage again; (6+) 1 damage again.",
  attack: true, melee: true, target: MELEE,
  *resolve(x, t) {
    yield* chew(x, t, 1);
  },
};

const spinOut: Ability = {
  id: "spinOut", name: "Spin Out", tags: "Self", text: "MOVE as far as possible in a straight line; units passed through take 1 fire damage. Then gain 2 speed.",
  target: DIRECTION,
  *resolve(x, t) {
    const { passed } = yield* dash(x, x.actor, dir(t), budget(x));
    for (const v of passed) {
      yield* hellwheel(x);
      yield* damage(x, v, 1, { type: "fire" });
    }
    if (unit(x.g, x.actor.id)) give(x.g, x.actor, "speed", 2);
  },
};

export const painwheel: UnitDef = {
  id: "painwheel", name: "Painwheel", house: HOUSE, type: "horror", mv: 5, hp: 4, df: 3, armor: "none", size: 1,
  traits: [BLOOD_RAGE, { id: "passThrough", name: "Hellwheel", text: "May spend speed tokens as strength. May pass through units but not end its turn in their spaces." }],
  acts: [exfoliate, spinOut],
};

const pulverize: Ability = {
  id: "pulverize", name: "Pulverize", tags: "Self", text: "Pull every unit in range 2 one space toward this unit; then 1 fire damage to each adjacent unit, and destroy all adjacent walls.",
  target: SELF,
  *resolve(x) {
    const me = cellsOf(x.actor);
    const near = x.g.units.filter((v) => v !== x.actor && gap(cellsOf(v), me) <= 2).sort((a, b) => gap(cellsOf(a), me) - gap(cellsOf(b), me));
    for (const v of near) if (unit(x.g, v.id)) yield* force(x, v, 1, me, false);
    for (const v of around(x.g, me)) yield* damage(x, v, 1, { type: "fire" });
    for (let dr = -1; dr <= x.actor.size; dr++) {
      for (let dc = -1; dc <= x.actor.size; dc++) {
        const c = { col: x.actor.col + dc, row: x.actor.row + dr };
        if (c.col >= 0 && c.row >= 0 && c.col < x.g.board.size && c.row < x.g.board.size && isWall(x.g.board, c)) hurtWall(x.g, c, x.g.board.walls[index(x.g.board, c)] ?? 0);
      }
    }
  },
};

const buildingRage: Ability = {
  id: "buildingRage", name: "Building Rage", tags: "Self, retaliation", text: "Gain 1 strength and 1 berserk; (4+) gain retaliation until the end of its next turn.",
  target: SELF,
  *resolve(x) {
    give(x.g, x.actor, "strength");
    give(x.g, x.actor, "berserk");
    if (effectDie(x.g) >= 4) lasting(x.g, "retaliation", x.actor, x.actor, "end");
  },
};

const ripAndTear: Ability = {
  id: "ripAndTear", name: "Rip and Tear", tags: "Melee, attack", text: "On hit: 2 damage; 1 damage again if this unit has 3 hp or less; then 1 again if it has 1 hp or less.",
  attack: true, melee: true, target: MELEE,
  *resolve(x, t) {
    if (atWall(x, t, 2)) return;
    const v = aimed(x, t)!;
    if (!(yield* attack(x, v)).hit) return;
    yield* damage(x, v, 2);
    if (x.actor.hp <= 3 && unit(x.g, v.id)) yield* damage(x, v, 1);
    if (x.actor.hp <= 1 && unit(x.g, v.id)) yield* damage(x, v, 1);
  },
};

export const berserker: UnitDef = {
  id: "berserker", name: "Berserker", house: HOUSE, type: "tyrant", mv: 4, hp: 6, df: 2, armor: "none", size: 2,
  traits: [FORMATION, { id: "steamingRage", name: "Steaming Rage", text: "When it takes damage, it gains 1 berserk and 1 strength, at most once a round." }, TYRANT],
  acts: [pulverize, buildingRage, ripAndTear],
};

export { chew };
