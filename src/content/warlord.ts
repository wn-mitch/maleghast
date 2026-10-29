// The Goregrinders necromancer, the Warlord (p35), and the extra trait,
// ACT and SOUL abilities it may pick (p36).

import { cellsOf, gap, index, isWall } from "../rules/board";
import { type Ability, type Trait, type UnitDef, hooks } from "../rules/content";
import { NEGATIVE, around, attack, damage, effectDie, force, give, hasTrait, hurtWall, log, nameOf, slay, spend, tokens, unit } from "../rules/effects";
import { lineCells, step, unitsIn } from "../rules/moves";
import type { Token } from "../rules/types";
import { chew } from "./goregrinders";
import { BLOOD_RAGE, FOREVER, LINE, MELEE, SELF, aimed, atWall, choose, lasting, reach } from "./kit";

const chainblade: Ability = {
  id: "superheatedChainblade", name: "Superheated Chainblade", tags: "Attack, melee", text: "On hit: 1 damage; (4+) 1 fire damage again; (6+) 1 fire damage again.",
  attack: true, melee: true, target: MELEE,
  *resolve(x, t) {
    yield* chew(x, t, 1, "fire");
  },
};

const ignite: Ability = {
  id: "ignite", name: "Ignite", tags: "1 SOUL, own or allied turn, range 3", text: "1 fire damage to self or a unit in range, which can't slay it; it gains 1 strength, 1 berserk and 1 speed.",
  soul: { cost: 1, when: "allied" }, target: reach(0, 3, "any"),
  *resolve(x, t) {
    const v = aimed(x, t);
    if (!v) return;
    yield* damage(x, v, 1, { type: "fire", cannotSlay: true });
    if (!unit(x.g, v.id)) return;
    for (const k of ["strength", "berserk", "speed"] as const) give(x.g, v, k);
  },
};

const gloryKill: Ability = {
  id: "gloryKill", name: "Glory Kill", tags: "3 SOUL, own or allied turn", text: "Obliterate an adjacent unit at 1 hp or lower. Gain 2 strength, then step 2.",
  soul: { cost: 3, when: "allied" }, target: reach(1, 1),
  *resolve(x, t) {
    const v = aimed(x, t);
    if (!v || v.hp > 1) {
      log(x.g, "Glory Kill needs a unit at 1 hp or lower");
      return;
    }
    yield* slay(x, v, true);
    give(x.g, x.actor, "strength", 2);
    yield* step(x, x.actor, 2);
  },
};

const traits: Trait[] = [
  { id: "nerveTwitch", name: "Nerve Twitch", text: "At 3 hp or lower, DF rises to 5+." },
  { id: "bloodDrinker", name: "Blood Drinker", text: "Slaying a unit clears a negative token." },
  { id: "bloodRush", name: "Blood Rush", text: "At 3 hp or lower, gain retaliation." },
];

const quench: Ability = {
  id: "quench", name: "Quench", tags: "Self", text: "Convert up to 3 negative tokens on self or adjacent allies to speed or strength tokens.",
  target: SELF,
  *resolve(x) {
    const strength = yield { kind: "yesno", side: x.side, prompt: "Quench into strength? (No gives speed)" };
    const into: Token = strength === true ? "strength" : "speed";
    let left = 3;
    for (const v of [x.actor, ...around(x.g, cellsOf(x.actor)).filter((u) => u.side === x.actor.side)]) {
      for (const t of NEGATIVE) {
        while (left > 0 && spend(v, t)) {
          left--;
          give(x.g, v, into);
        }
      }
    }
  },
};

const frenzyChain: Ability = {
  id: "frenzyChain", name: "Frenzy Chain", tags: "Range 3", text: "Pull a unit in range 2 spaces; (4+) pull another unit; (6+) pull another.",
  target: reach(1, 3),
  *resolve(x, t) {
    const first = aimed(x, t);
    if (!first) return;
    yield* force(x, first, 2, cellsOf(x.actor), false);
    const die = effectDie(x.g);
    const done = new Set([first.id]);
    for (const need of [4, 6]) {
      if (die < need) continue;
      const v = yield* choose(x, x.g.units.filter((u) => u !== x.actor && !done.has(u.id) && gap(cellsOf(u), cellsOf(x.actor)) <= 3), "Frenzy Chain: pull another unit");
      if (!v) continue;
      done.add(v.id);
      yield* force(x, v, 2, cellsOf(x.actor), false);
    }
  },
};

const furiousRoar: Ability = {
  id: "furiousRoar", name: "Furious Roar", tags: "Self", text: "All allied units anywhere may step 1 and gain 1 speed.",
  target: SELF,
  *resolve(x) {
    for (const v of x.g.units.filter((u) => u.side === x.actor.side)) {
      yield* step(x, v, 1);
      if (unit(x.g, v.id)) give(x.g, v, "speed");
    }
  },
};

const apoplexy: Ability = {
  id: "apoplexy", name: "Apoplexy", tags: "Self", text: "Gain 1 strength and 1 berserk, then double all berserk and strength tokens.",
  target: SELF,
  *resolve(x) {
    give(x.g, x.actor, "strength");
    give(x.g, x.actor, "berserk");
    x.actor.tokens.strength = tokens(x.actor, "strength") * 2;
    x.actor.tokens.berserk = tokens(x.actor, "berserk") * 2;
  },
};

const pilebunker: Ability = {
  id: "pilebunker", name: "Pilebunker", tags: "Attack, melee", text: "On hit: 2 damage, then 1 fire damage again. The attack rolls -1D.",
  attack: true, melee: true, target: MELEE,
  *resolve(x, t) {
    if (atWall(x, t, 3)) return;
    const v = aimed(x, t)!;
    if (!(yield* attack(x, v, "physical", -1)).hit) return;
    yield* damage(x, v, 2);
    if (unit(x.g, v.id)) yield* damage(x, v, 1, { type: "fire" });
  },
};

const slayerAxe: Ability = {
  id: "sawToothedSlayerAxe", name: "Saw Toothed Slayer Axe", tags: "Line 4", text: "1 damage to each unit in the line. If only one unit is caught, the damage ignores armor and the line destroys walls.",
  target: LINE,
  *resolve(x, t) {
    if (t.kind !== "cell") return;
    const open = lineCells(x.g, x.actor, t.cell, 4);
    const hit = unitsIn(x.g, open).filter((v) => v !== x.actor);
    const alone = hit.length === 1;
    for (const v of hit) yield* damage(x, v, 1, { ignoreArmor: alone });
    if (!alone) return;
    for (const c of lineCells(x.g, x.actor, t.cell, 4, true)) if (isWall(x.g.board, c)) hurtWall(x.g, c, x.g.board.walls[index(x.g.board, c)] ?? 0);
  },
};

const spineDevilBlade: Ability = {
  id: "spineDevilBlade", name: "Spine Devil Blade", tags: "Attack, melee", text: "On hit: 1 damage, +1 for each of up to 3 strength and berserk tokens spent; then take damage equal to the tokens spent, which can't slay you.",
  attack: true, melee: true, target: MELEE,
  *resolve(x, t) {
    if (atWall(x, t, 1)) return;
    const v = aimed(x, t)!;
    if (!(yield* attack(x, v)).hit) return;
    let spent = 0;
    while (spent < 3 && (tokens(x.actor, "strength") || tokens(x.actor, "berserk"))) {
      const more = yield { kind: "yesno", side: x.side, prompt: `Spine Devil Blade: spend a token for +1 damage? (${spent} spent)` };
      if (more !== true) break;
      if (!spend(x.actor, "berserk")) spend(x.actor, "strength");
      spent++;
    }
    yield* damage(x, v, 1 + spent);
    if (spent && unit(x.g, x.actor.id)) yield* damage(x, x.actor, spent, { cannotSlay: true, sourceless: true });
  },
};

const hellriderKick: Ability = {
  id: "hellriderKick", name: "Hellrider Kick", tags: "1 SOUL, own or allied turn", text: "MOVE with free movement, then 1 fire damage to an adjacent foe.",
  soul: { cost: 1, when: "allied" }, target: SELF,
  *resolve(x) {
    yield* step(x, x.actor, 4, true, true);
    const foe = yield* choose(x, around(x.g, cellsOf(x.actor)).filter((v) => v.side !== x.actor.side), "Hellrider Kick: which foe?");
    if (foe) yield* damage(x, foe, 1, { type: "fire" });
  },
};

const overclock: Ability = {
  id: "overclock", name: "Overclock", tags: "1 SOUL, own or allied turn, range 3", text: "Self or a unit in range gains 1 speed. If it is at 1 hp or lower, each unit adjacent to it takes 1 fire damage.",
  soul: { cost: 1, when: "allied" }, target: reach(0, 3, "any"),
  *resolve(x, t) {
    const v = aimed(x, t);
    if (!v) return;
    give(x.g, v, "speed");
    if (v.hp <= 1) for (const s of around(x.g, cellsOf(v))) yield* damage(x, s, 1, { type: "fire" });
  },
};

const gorebather: Ability = {
  id: "gorebather", name: "Gorebather", tags: "2 SOUL, any turn; when you slay a unit", text: "Step 1. All allied units anywhere may step 1.",
  soul: { cost: 2, when: "any", trigger: "slay" }, target: SELF,
  *resolve(x) {
    yield* step(x, x.actor, 1);
    for (const v of x.g.units.filter((u) => u.side === x.actor.side && u !== x.actor)) yield* step(x, v, 1);
  },
};

const killingSpree: Ability = {
  id: "killingSpree", name: "Killing Spree", tags: "3 SOUL, any turn; after a unit ACTs", text: "Step 1, then 1 damage to an adjacent unit. If it is slain, repeat.",
  soul: { cost: 3, when: "any", trigger: "acted" }, target: SELF,
  *resolve(x) {
    for (;;) {
      yield* step(x, x.actor, 1);
      const v = yield* choose(x, around(x.g, cellsOf(x.actor)), "Killing Spree: 1 damage to whom?");
      if (!v) return;
      yield* damage(x, v, 1);
      if (unit(x.g, v.id) || !unit(x.g, x.actor.id)) return;
    }
  },
};

const bloodBoil: Ability = {
  id: "bloodBoil", name: "Blood Boil", tags: "4 SOUL, any turn; when a unit is slain", text: "It isn't slain but stays at 0 hp, immune to all damage. At the end of its next turn it explodes: obliterated, dealing 1 fire damage to each adjacent unit.",
  soul: { cost: 4, when: "any", trigger: "slain" }, target: SELF,
  *resolve(x, t) {
    const v = aimed(x, t);
    if (!v) return;
    lasting(x.g, "immune", v, v, "end", FOREVER);
    lasting(x.g, "boiling", v, v, "end");
    log(x.g, `${nameOf(v)}'s blood boils`, v.id);
  },
};

const devilImpact: Ability = {
  id: "devilImpact", name: "Devil Impact", tags: "6 SOUL, own turn", text: "6 devil damage to an adjacent unit, then 6 devil damage to yourself.",
  soul: { cost: 6, when: "own" }, target: reach(1, 1),
  *resolve(x, t) {
    const v = aimed(x, t);
    if (v) yield* damage(x, v, 6, { type: "devil" });
    if (unit(x.g, x.actor.id)) yield* damage(x, x.actor, 6, { type: "devil", sourceless: true });
  },
};

export const warlord: UnitDef = {
  id: "warlord", name: "Warlord", house: "goregrinders", type: "necromancer", mv: 4, hp: 10, df: 3, armor: "none", size: 1,
  traits: [BLOOD_RAGE, { id: "fueledByRage", name: "Fueled by Rage", text: "Gain 1 berserk at the start of your turn. You may spend berserk tokens as speed tokens." }],
  acts: [chainblade], souls: [ignite, gloryKill],
  picks: {
    traits,
    acts: [quench, frenzyChain, furiousRoar, apoplexy, pilebunker, slayerAxe, spineDevilBlade],
    souls: [hellriderKick, overclock, gorebather, killingSpree, bloodBoil, devilImpact],
  },
};

/** The Warlord's rules that react to play. */
export function installWarlord(): void {
  hooks.df.push((g, u, df) => (hasTrait(g, u, "nerveTwitch") && u.hp <= 3 ? Math.max(df, 5) : df));
  hooks.trait.push((_g, u, id) => id === "retaliation" && u.hp <= 3 && u.picks?.includes("bloodRush") === true);
  hooks.slay.push((x) => {
    if (!hasTrait(x.g, x.actor, "bloodDrinker")) return;
    for (const t of NEGATIVE) if (spend(x.actor, t)) return;
  });
  // Blood Boil: at the end of its next turn the boiling unit explodes.
  hooks.endTurn.push(function* (x, u) {
    if (!x.g.lasting.some((l) => l.on === u.id && l.name === "boiling" && l.turn <= (x.g.turns[u.id] ?? 0))) return;
    x.g.lasting = x.g.lasting.filter((l) => l.on !== u.id || (l.name !== "boiling" && l.name !== "immune"));
    for (const v of around(x.g, cellsOf(u))) yield* damage(x, v, 1, { type: "fire", sourceless: true });
    yield* slay(x, u, true);
  });
}
