// The C.A.R.C.A.S.S. necromancer, the Operator (p29), and the extra trait,
// ACT and SOUL abilities it may pick (p30).

import { cellsOf, gap } from "../rules/board";
import { type Ability, type Ctx, type Gen, type Trait, type UnitDef, hooks } from "../rules/content";
import { type Roll, around, attack, damage, effectDie, force, give, hasTrait, log, nameOf, slay, unit } from "../rules/effects";
import { step } from "../rules/moves";
import type { Target } from "../rules/state";
import type { Unit } from "../rules/types";
import { FORMATION, SELF, aimed, atWall, choose, foesOf, lasting, pushAll, ranged, reach } from "./kit";

/**
 * An Operator's attack, with what its picks add: Devil Bullet's +1D and
 * certain headshot (p30), Gun Kata's push on an adjacent target, and
 * Clutch Reload's headshot reload.
 */
function* fire(x: Ctx, v: Unit): Gen<Roll> {
  const devil = x.g.lasting.find((l) => l.on === x.actor.id && l.name === "devilBullet");
  if (devil) x.g.lasting = x.g.lasting.filter((l) => l !== devil);
  const r = yield* attack(x, v, "physical", devil ? 1 : 0);
  const shot = { ...r, headshot: r.headshot || (devil !== undefined && r.hit) };
  const near = unit(x.g, v.id) && gap(cellsOf(x.actor), cellsOf(v)) === 1;
  if (x.ability && ranged(x.ability)) {
    if (near && hasTrait(x.g, x.actor, "gunKata")) yield* force(x, v, 1, cellsOf(x.actor), true);
    if (shot.headshot && hasTrait(x.g, x.actor, "clutchReload")) x.actor.unloaded = false;
  }
  return shot;
}

/** Whether Devil Bullet's armor-piercing is loaded for this shot; read before `fire` spends it. */
function devilLoaded(x: Ctx): boolean {
  return x.g.lasting.some((l) => l.on === x.actor.id && l.name === "devilBullet");
}

const akimbo: Ability = {
  id: "akimbo", name: "Akimbo", tags: "Attack, range 2-4, reload", text: "On hit: 2 damage. (4+) one other foe in range takes 1 damage, (6+) one more does.",
  attack: true, reload: true, target: reach(2, 4, "other", true),
  *resolve(x, t) {
    if (atWall(x, t, 2)) return;
    const v = aimed(x, t)!;
    const pierce = devilLoaded(x);
    const r = yield* fire(x, v);
    if (!r.hit) return;
    yield* damage(x, v, 2, { ignoreArmor: pierce });
    const die = effectDie(x.g);
    const done = new Set([v.id]);
    for (const need of [4, 6]) {
      if (die < need) continue;
      const others = foesOf(x.g, x.actor).filter((f) => !done.has(f.id) && gap(cellsOf(x.actor), cellsOf(f)) <= 4);
      const f = yield* choose(x, others, "Akimbo: another foe in range takes 1 damage");
      if (!f) continue;
      done.add(f.id);
      yield* damage(x, f, 1);
    }
  },
};

const reloadSlide: Ability = {
  id: "reloadSlide", name: "Reload Slide", tags: "1 SOUL, own or allied turn", text: "Step 1, then you or an adjacent ally reloads.",
  soul: { cost: 1, when: "allied" }, target: SELF,
  *resolve(x) {
    yield* step(x, x.actor, 1);
    const who = yield* choose(x, [x.actor, ...around(x.g, cellsOf(x.actor)).filter((v) => v.side === x.actor.side)], "Who reloads?");
    if (!who) return;
    who.unloaded = false;
    for (const h of hooks.reload) h(x.g, who);
    log(x.g, `${nameOf(who)} reloads`, who.id);
  },
};

const bulletTime: Ability = {
  id: "bulletTime", name: "Bullet Time", tags: "3 SOUL, own turn", text: "Ranged attacks automatically miss you until the end of your next turn.",
  soul: { cost: 3, when: "own" }, target: SELF,
  *resolve(x) {
    lasting(x.g, "bulletTime", x.actor, x.actor, "end");
  },
};

const traits: Trait[] = [
  { id: "boneWall", name: "Bone Wall", text: "You can use your units as cover. While in cover your abilities gain +1 range." },
  { id: "gunKata", name: "Gun Kata", text: "Your ranged attacks gain a minimum range of 1 and push units 1 if they are adjacent." },
  { id: "clutchReload", name: "Clutch Reload", text: "Your ranged attacks gain Headshot: reload." },
];

const grenadeJump: Ability = {
  id: "grenadeJump", name: "Grenade Jump", tags: "Self", text: "1 fire damage to each adjacent unit, then step 2 with free movement.",
  target: SELF,
  *resolve(x) {
    for (const v of around(x.g, cellsOf(x.actor))) yield* damage(x, v, 1, { type: "fire" });
    yield* step(x, x.actor, 2, true, true);
  },
};

const armorLock: Ability = {
  id: "armorLock", name: "Armor Lock", tags: "Self", text: "Push all adjacent foes 1. Until the end of your next turn: super armor, allies may use you as cover, and you can't MOVE, step or be pushed or pulled.",
  target: SELF,
  *resolve(x) {
    yield* pushAll(x, around(x.g, cellsOf(x.actor)).filter((v) => v.side !== x.actor.side), 1, cellsOf(x.actor));
    for (const name of ["superArmor", "armorLock", "rooted", "anchored"]) lasting(x.g, name, x.actor, x.actor, "end");
  },
};

const devilBullet: Ability = {
  id: "devilBullet", name: "Devil Bullet", tags: "Self, reload", text: "Your next attack gains +1D, ignores armor and ward, and triggers its headshot effects on a hit.",
  reload: true, target: SELF,
  *resolve(x) {
    lasting(x.g, "devilBullet", x.actor, x.actor, "end", 1e9);
  },
};

const superkick: Ability = {
  id: "superkick", name: "Superkick", tags: "Melee", text: "Push an adjacent unit 3. A foe gains 1 vulnerable if it would be pushed into a wall or elevated space.",
  melee: true, target: { kind: "unit", min: 1, max: 1, who: "other" },
  *resolve(x, t) {
    const v = aimed(x, t);
    if (!v) return;
    const r = yield* force(x, v, 3, cellsOf(x.actor), true);
    if ((r.blocked === "wall" || r.blocked === "elevation") && v.side !== x.actor.side && unit(x.g, v.id)) give(x.g, v, "vulnerable");
  },
};

const LV4_RELOADS = 2;

const livingCannon: Ability = {
  id: "lv4LivingCannon", name: "LV4 Living Cannon", tags: "Attack, range 2-6, reload twice", text: "On hit: 1 fire damage, then 1 fire damage to each unit adjacent to the target. Headshot: every unit hit gains 1 vulnerable. Must reload twice before reuse.",
  attack: true, reload: true, target: reach(2, 6, "other", true),
  usable: (_g, u) => (u.marks?.lv4 ?? 0) === 0,
  *resolve(x, t) {
    x.actor.marks = { ...x.actor.marks, lv4: LV4_RELOADS };
    if (atWall(x, t, 1)) return;
    const v = aimed(x, t)!;
    const where = cellsOf(v);
    const pierce = devilLoaded(x);
    const r = yield* fire(x, v);
    if (!r.hit) return;
    const hit = [v, ...around(x.g, where)];
    yield* damage(x, v, 1, { type: "fire", ignoreArmor: pierce });
    for (const s of hit.slice(1)) yield* damage(x, s, 1, { type: "fire" });
    if (r.headshot) for (const s of hit) if (unit(x.g, s.id)) give(x.g, s, "vulnerable");
  },
};

const shotgun: Ability = {
  id: "sg88", name: "SG88 Two Barrel Shotgun", tags: "Attack, range 1-2, reload", text: "On hit: 1 damage, then 1 damage again; push 1, then push 1. Headshot: reload.",
  attack: true, reload: true, target: reach(1, 2, "other", true),
  *resolve(x, t) {
    if (atWall(x, t, 2)) return;
    const v = aimed(x, t)!;
    const pierce = devilLoaded(x);
    const r = yield* fire(x, v);
    if (!r.hit) return;
    yield* damage(x, v, 1, { ignoreArmor: pierce });
    yield* damage(x, v, 1, { ignoreArmor: pierce });
    for (let i = 0; i < 2; i++) if (unit(x.g, v.id)) yield* force(x, v, 1, cellsOf(x.actor), true);
    if (r.headshot) x.actor.unloaded = false;
  },
};

const sixgun: Ability = {
  id: "unholySixgun", name: "Unholy Sixgun", tags: "Attack, range 2-4, reload", text: "On hit: 1 damage. Headshot: +1 base damage on hit for the rest of the battle, to at most 4.",
  attack: true, reload: true, target: reach(2, 4, "other", true),
  *resolve(x, t) {
    const base = 1 + (x.actor.marks?.sixgun ?? 0);
    if (atWall(x, t, base)) return;
    const v = aimed(x, t)!;
    const pierce = devilLoaded(x);
    const r = yield* fire(x, v);
    if (!r.hit) return;
    yield* damage(x, v, base, { ignoreArmor: pierce });
    if (r.headshot) x.actor.marks = { ...x.actor.marks, sixgun: Math.min(3, (x.actor.marks?.sixgun ?? 0) + 1) };
  },
};

function subject(x: Ctx, t: Target): Unit | null {
  return aimed(x, t);
}

const doubleTap: Ability = {
  id: "doubleTap", name: "Double Tap", tags: "1 SOUL, any turn; when you reduce a unit to exactly 1 hp", text: "Deal 1 damage to it, ignoring armor.",
  soul: { cost: 1, when: "any", trigger: "reducedToOne" }, target: SELF,
  *resolve(x, t) {
    const v = subject(x, t);
    if (v) yield* damage(x, v, 1, { ignoreArmor: true });
  },
};

const fragBullet: Ability = {
  id: "fragBullet", name: "Frag Bullet", tags: "1 SOUL, own turn; when you hit with an attack", text: "The target gains 2 vulnerable after the ability resolves.",
  soul: { cost: 1, when: "own", trigger: "hit" }, target: SELF,
  *resolve(x, t) {
    const v = subject(x, t);
    if (v) lasting(x.g, "frag", v, x.actor, "end", 1e9);
  },
};

const bulletHustle: Ability = {
  id: "bulletHustle", name: "Bullet Hustle", tags: "2 SOUL, any turn; after any unit MOVEs", text: "Step 2, then deal 1 damage to a unit in range 3.",
  soul: { cost: 2, when: "any", trigger: "moved" }, target: SELF,
  *resolve(x) {
    yield* step(x, x.actor, 2);
    const v = yield* choose(x, x.g.units.filter((u) => u !== x.actor && gap(cellsOf(x.actor), cellsOf(u)) <= 3), "Bullet Hustle: 1 damage to whom?");
    if (v) yield* damage(x, v, 1);
  },
};

const overwatch: Ability = {
  id: "overwatch", name: "Overwatch", tags: "3 SOUL, own turn", text: "Reload. Until the start of your next turn, a foe entering a space adjacent to you by its own movement takes 1 damage and is pushed 1, stopping it. Once a turn.",
  soul: { cost: 3, when: "own" }, target: SELF,
  *resolve(x) {
    x.actor.unloaded = false;
    lasting(x.g, "overwatch", x.actor, x.actor, "start");
  },
};

const sonata: Ability = {
  id: "bulletSonata", name: "Bullet Sonata", tags: "4 SOUL, own turn", text: "Every foe in range 2 takes 1 damage, ignoring armor, and is pushed 1.",
  soul: { cost: 4, when: "own" }, target: SELF,
  *resolve(x) {
    const foes = foesOf(x.g, x.actor).filter((f) => gap(cellsOf(x.actor), cellsOf(f)) <= 2);
    for (const f of foes) {
      yield* damage(x, f, 1, { ignoreArmor: true });
      if (unit(x.g, f.id)) yield* force(x, f, 1, cellsOf(x.actor), true);
    }
  },
};

const stg: Ability = {
  id: "stg", name: "S.T.G.", tags: "6 SOUL, own turn; on a headshot", text: "Obliterate the target.",
  soul: { cost: 6, when: "own", trigger: "headshot" }, target: SELF,
  *resolve(x, t) {
    const v = subject(x, t);
    if (v) yield* slay(x, v, true);
  },
};

export const operator: UnitDef = {
  id: "operator", name: "Operator", house: "carcass", type: "necromancer", mv: 4, hp: 8, df: 4, armor: "arm", size: 1,
  traits: [FORMATION, { id: "hotClip", name: "Hot Clip", text: "Reloading grants 1 strength." }],
  acts: [akimbo], souls: [reloadSlide, bulletTime],
  picks: {
    traits,
    acts: [grenadeJump, armorLock, devilBullet, superkick, livingCannon, shotgun, sixgun],
    souls: [doubleTap, fragBullet, bulletHustle, overwatch, sonata, stg],
  },
};

/** The Operator's rules that react to play. */
export function installOperator(): void {
  // Bone Wall: your own units are cover for you.
  hooks.cover.push((g, target) => (hasTrait(g, target, "boneWall") ? g.units.filter((v) => v !== target && v.side === target.side).flatMap((v) => cellsOf(v)) : []));
  // Gun Kata: ranged attacks may target adjacent units.
  hooks.minRange.push((g, u, a, min) => (a.attack && ranged(a) && hasTrait(g, u, "gunKata") ? Math.min(min, 1) : min));
  // LV4 Living Cannon counts its reloads down; while it waits, there is something to reload.
  hooks.reload.push((_g, u) => {
    if ((u.marks?.lv4 ?? 0) > 0) u.marks = { ...u.marks, lv4: (u.marks?.lv4 ?? 0) - 1 };
  });
  hooks.reloadable.push((_g, u) => (u.marks?.lv4 ?? 0) > 0);
  // Frag Bullet's vulnerable lands once the ability it hit with has resolved.
  hooks.after.push(function* (x) {
    for (const l of x.g.lasting.filter((f) => f.name === "frag")) {
      const v = unit(x.g, l.on);
      if (v) give(x.g, v, "vulnerable", 2);
    }
    x.g.lasting = x.g.lasting.filter((f) => f.name !== "frag");
  });
  // Overwatch: a foe stepping next to the Operator is shot and pushed back, once a turn.
  hooks.enter.push(function* (x, mover) {
    for (const l of x.g.lasting.filter((f) => f.name === "overwatch")) {
      const op = unit(x.g, l.on);
      if (!op || op.side === mover.side || gap(cellsOf(op), cellsOf(mover)) !== 1 || op.marks?.overwatch === x.g.activations) continue;
      op.marks = { ...op.marks, overwatch: x.g.activations };
      const shooter: Ctx = { ...x, actor: op, side: op.side };
      log(x.g, `${nameOf(op)}'s overwatch fires`, op.id);
      yield* damage(shooter, mover, 1);
      if (unit(x.g, mover.id)) yield* force(shooter, mover, 1, cellsOf(op), true);
      return true;
    }
    return false;
  });
}
