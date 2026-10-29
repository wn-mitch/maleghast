// C.A.R.C.A.S.S. (p26-p29): ranged dominance. Formation, reload and
// headshots. Card text is summarised; page numbers are the rulebook's.

import { cellsOf, footprint, gap, inBounds, isWall } from "../rules/board";
import { type Ability, type Ctx, type Gen, type UnitDef, hooks } from "../rules/content";
import { around, attack, damage, effectDie, give, hasTrait, hurtWall, nameOf, slay, unit } from "../rules/effects";
import { lineCells, step, unitsIn, walk } from "../rules/moves";
import type { Cell } from "../rules/types";
import { FORMATION, FOREVER, LINE, MELEE, SELF, THRALL, TYRANT, aimed, atWall, besideCover, choose, cursed, lasting, pushAll, ranged, reach } from "./kit";

const HOUSE = "carcass";

const ol45: Ability = {
  id: "ol45", name: "OL45", tags: "Attack, range 2-3, reload", text: "On hit: 1 damage, ignoring armor. Headshot: 1 vulnerable.",
  attack: true, reload: true, target: reach(2, 3, "other", true),
  *resolve(x, t) {
    if (atWall(x, t, 1)) return;
    const v = aimed(x, t)!;
    const r = yield* attack(x, v);
    if (!r.hit) return;
    yield* damage(x, v, 1, { ignoreArmor: true });
    if (r.headshot && unit(x.g, v.id)) give(x.g, v, "vulnerable");
  },
};

const baton: Ability = {
  id: "baton", name: "Baton", tags: "Push, melee", text: "Push 1.", melee: true, target: { kind: "unit", min: 1, max: 1, who: "other" },
  *resolve(x, t) {
    const v = aimed(x, t);
    if (v) yield* pushAll(x, [v], 1, cellsOf(x.actor));
  },
};

export const gunwight: UnitDef = {
  id: "gunwight", name: "Gunwight", house: HOUSE, type: "thrall", mv: 2, hp: 2, df: 4, armor: "none", size: 1,
  traits: [FORMATION, THRALL], acts: [ol45, baton],
};

const skullCrack: Ability = {
  id: "skullCrack", name: "Skull Crack", tags: "Attack, melee, push", text: "On hit: 2 damage and push 1. Headshot: push 2.",
  attack: true, melee: true, target: MELEE,
  *resolve(x, t) {
    if (atWall(x, t, 2)) return;
    const v = aimed(x, t)!;
    const r = yield* attack(x, v);
    if (!r.hit) return;
    yield* damage(x, v, 2);
    if (unit(x.g, v.id)) yield* pushAll(x, [v], r.headshot ? 2 : 1, cellsOf(x.actor));
  },
};

const flashbang: Ability = {
  id: "flashbang", name: "Flashbang", tags: "Range 3, reload, splash", text: "1 fire damage and 1 vulnerable, then units adjacent to the target are pushed 1 away from it.",
  reload: true, target: reach(1, 3),
  *resolve(x, t) {
    const v = aimed(x, t);
    if (!v) return;
    const where = cellsOf(v);
    yield* damage(x, v, 1, { type: "fire" });
    if (unit(x.g, v.id)) give(x.g, v, "vulnerable");
    yield* pushAll(x, around(x.g, where), 1, where);
  },
};

const shieldwall: Ability = {
  id: "shieldwall", name: "Shieldwall", tags: "Self", text: "Until the start of its next turn: can't MOVE, step or be pushed or pulled; has cover from all directions, and so do adjacent allies.",
  target: SELF,
  *resolve(x) {
    for (const name of ["rooted", "anchored", "coverAll", "shieldwall"]) lasting(x.g, name, x.actor, x.actor, "start");
  },
};

export const enforcer: UnitDef = {
  id: "enforcer", name: "Enforcer", house: HOUSE, type: "scion", mv: 3, hp: 4, df: 3, armor: "arm", size: 1,
  traits: [FORMATION], acts: [skullCrack, flashbang, shieldwall],
};

const regurgitate: Ability = {
  id: "regurgitateAmmo", name: "Regurgitate Ammo", tags: "Range 3", text: "A unit in range reloads and gains 1 strength, (5+) 2 strength.",
  target: reach(0, 3, "any"),
  *resolve(x, t) {
    const v = aimed(x, t);
    if (!v) return;
    v.unloaded = false;
    for (const h of hooks.reload) h(x.g, v);
    give(x.g, v, "strength", effectDie(x.g) >= 5 ? 2 : 1);
  },
};

const boneShards: Ability = {
  id: "boneShards", name: "Bone Shards", tags: "Curse, range 3", text: "Until the end of this unit's next turn, or until it has taken 3 damage this way, the target takes 1 curse damage after any ACT ability that pushes or pulls it resolves.",
  curse: true, target: reach(1, 3),
  *resolve(x, t) {
    const v = aimed(x, t);
    if (!v || !cursed(x, v)) return;
    v.marks = { ...v.marks, shards: 0 };
    lasting(x.g, "boneShards", v, x.actor, "end");
  },
};

const glee: Ability = {
  id: "destructiveGlee", name: "Destructive Glee", tags: "Self", text: "Step 1, then each adjacent unit takes 1 fire damage, is pushed 1 and gains 1 vulnerable; then this unit is obliterated.",
  target: SELF,
  *resolve(x) {
    yield* step(x, x.actor, 1);
    const here = cellsOf(x.actor);
    for (const v of around(x.g, here)) {
      yield* damage(x, v, 1, { type: "fire" });
      if (unit(x.g, v.id)) yield* pushAll(x, [v], 1, here);
      if (unit(x.g, v.id)) give(x.g, v, "vulnerable");
    }
    yield* slay(x, x.actor, true);
  },
};

export const ammoGoblin: UnitDef = {
  id: "ammoGoblin", name: "Ammo Goblin", house: HOUSE, type: "freak", mv: 3, hp: 4, df: 4, armor: "none", size: 1,
  traits: [FORMATION], acts: [regurgitate, boneShards, glee],
};

const snipe: Ability = {
  id: "snipe", name: "Snipe", tags: "Attack, range 2-4, reload", text: "On hit: 2 damage. Headshot: and 1 vulnerable.",
  attack: true, reload: true, target: reach(2, 4, "other", true),
  *resolve(x, t) {
    if (atWall(x, t, 2)) return;
    const v = aimed(x, t)!;
    const r = yield* attack(x, v);
    if (!r.hit) return;
    yield* damage(x, v, 2);
    if (r.headshot && unit(x.g, v.id)) give(x.g, v, "vulnerable");
  },
};

const transform: Ability = {
  id: "transformToGun", name: "Transform to Gun", tags: "Self", text: "Can't MOVE or step, gains 2 strength, and its ranged abilities gain +2 maximum range. Sacrificing a MOVE ends it and loses all strength.",
  target: SELF,
  *resolve(x) {
    if (hasTrait(x.g, x.actor, "transformed")) return;
    lasting(x.g, "transformed", x.actor, x.actor, "end", FOREVER);
    lasting(x.g, "rooted", x.actor, x.actor, "end", FOREVER);
    give(x.g, x.actor, "strength", 2);
  },
};

const deathmark: Ability = {
  id: "deathmark", name: "Deathmark", tags: "Curse, range 4", text: "2 vulnerable, (4+) 3 vulnerable, (6+) after first removing any vitality.",
  curse: true, target: reach(1, 4),
  *resolve(x, t) {
    const v = aimed(x, t);
    if (!v || !cursed(x, v)) return;
    const die = effectDie(x.g);
    if (die >= 6) v.tokens.vitality = 0;
    give(x.g, v, "vulnerable", die >= 4 ? 3 : 2);
  },
};

export const barrelform: UnitDef = {
  id: "barrelform", name: "Barrelform", house: HOUSE, type: "hunter", mv: 2, hp: 4, df: 4, armor: "none", size: 1,
  traits: [FORMATION], acts: [snipe, transform, deathmark],
};

/** Juggernaut's step: one space, smashing walls in its way (p29). */
function* trample(x: Ctx): Gen {
  const u = x.actor, g = x.g;
  if (hasTrait(g, u, "rooted")) return;
  const options: Cell[] = [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dc, dr]) => ({ col: u.col + dc!, row: u.row + dr! }))
    .filter((c) => footprint(c, u.size).every((p) => inBounds(g.board, p) && !g.units.some((v) => v !== u && cellsOf(v).some((w) => w.col === p.col && w.row === p.row))));
  if (!options.length) return;
  const pick = yield { kind: "cell", side: x.side, prompt: `Step ${nameOf(u)} 1`, options, optional: true };
  if (typeof pick !== "number") return;
  const to = options[pick]!;
  for (const p of footprint(to, u.size)) if (isWall(g.board, p)) hurtWall(g, p, 99);
  yield* walk(x, u, [to]);
}

const juggernaut: Ability = {
  id: "juggernaut", name: "Juggernaut", tags: "Self, push", text: "Step 1, through walls, destroying them; then push adjacent foes 1, (5+) 2.",
  target: SELF,
  *resolve(x) {
    yield* trample(x);
    const here = cellsOf(x.actor);
    yield* pushAll(x, around(x.g, here).filter((v) => v.side !== x.actor.side), effectDie(x.g) >= 5 ? 2 : 1, here);
  },
};

const mortar: Ability = {
  id: "mortar", name: "Mortar", tags: "Attack, range 2-4, reload", text: "On hit: 1 damage, then 1 fire damage to each unit adjacent to the target. Headshot: +1 damage on the target.",
  attack: true, reload: true, target: reach(2, 4, "other", true),
  *resolve(x, t) {
    if (atWall(x, t, 1)) return;
    const v = aimed(x, t)!;
    const where = cellsOf(v);
    const r = yield* attack(x, v);
    if (!r.hit) return;
    yield* damage(x, v, r.headshot ? 2 : 1);
    for (const s of around(x.g, where)) yield* damage(x, s, 1, { type: "fire" });
  },
};

const cannon: Ability = {
  id: "catechismDevilCannon", name: "Catechism Devil Cannon", tags: "Line, reload", text: "Line 5 through walls: 1 fire damage to each unit, and 1 vulnerable to the first.",
  reload: true, target: LINE,
  *resolve(x, t) {
    if (t.kind !== "cell") return;
    const hit = unitsIn(x.g, lineCells(x.g, x.actor, t.cell, 5, true)).filter((v) => v !== x.actor);
    for (const v of hit) yield* damage(x, v, 1, { type: "fire" });
    const first = hit[0];
    if (first && unit(x.g, first.id)) give(x.g, first, "vulnerable");
  },
};

export const egisWeapon: UnitDef = {
  id: "egisWeapon", name: "EGIS Weapon", house: HOUSE, type: "tyrant", mv: 3, hp: 6, df: 2, armor: "arm", size: 2,
  traits: [FORMATION, { id: "siegeShield", name: "Siege Shield", text: "Allies may use it as cover." }, TYRANT],
  acts: [juggernaut, mortar, cannon],
};

/** C.A.R.C.A.S.S. rules that react to play rather than being used. */
export function installCarcass(): void {
  // Shieldwall covers adjacent allies; Siege Shield and Armor Lock make a unit cover for its allies.
  hooks.trait.push((g, u, id) => id === "coverAll" && g.units.some((v) => v !== u && v.side === u.side && gap(cellsOf(v), cellsOf(u)) === 1 && g.lasting.some((l) => l.on === v.id && l.name === "shieldwall")));
  hooks.cover.push((g, target) => g.units.filter((v) => v !== target && v.side === target.side && (hasTrait(g, v, "siegeShield") || hasTrait(g, v, "armorLock"))).flatMap((v) => cellsOf(v)));
  // Transform to Gun: ranged abilities gain +2 maximum range.
  hooks.range.push((g, u, a) => (ranged(a) && hasTrait(g, u, "transformed") ? 2 : 0));
  // Bone Wall: while in cover, abilities gain +1 range (p30).
  hooks.range.push((g, u) => (hasTrait(g, u, "boneWall") && besideCover(g, u) ? 1 : 0));
  // Bone Shards: 1 curse damage after an ACT ability that forced the unit to move.
  hooks.after.push(function* (x) {
    for (const id of x.forced) {
      const v = unit(x.g, id);
      const shard = v && x.g.lasting.find((l) => l.on === v.id && l.name === "boneShards");
      if (!v || !shard) continue;
      const dealt = yield* damage(x, v, 1, { type: "curse", sourceless: true });
      v.marks = { ...v.marks, shards: (v.marks?.shards ?? 0) + dealt };
      if ((v.marks.shards ?? 0) >= 3) x.g.lasting = x.g.lasting.filter((l) => l !== shard);
    }
  });
}
