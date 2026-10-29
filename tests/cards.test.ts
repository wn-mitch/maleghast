import { describe, expect, it } from "vitest";
import { emptyBoard } from "../src/rules/board";
import { covered, unit } from "../src/rules/effects";
import { apply } from "../src/rules/engine";
import { at, battle, logSince, play, rig, the, turn, wall } from "./play";

const shoot = (side: number, u: string, ability: string, target: string) =>
  ({ kind: "act", side, unit: u, ability, target: { kind: "unit", id: target } }) as const;

describe("attacks", () => {
  it("lets OL45 ignore armor on a hit, while a graze is still reduced by it", () => {
    const g = battle([{ kind: "gunwight", side: 0, at: at(3, 6) }, { kind: "enforcer", side: 1, at: at(3, 3) }]);
    const gun = the(g, "gunwight"), enf = the(g, "enforcer", 1);
    let t = turn(g, gun);
    rig(t, 5);
    t = play(t, shoot(0, gun.id, "ol45", enf.id)).g;
    expect(unit(t, enf.id)!.hp).toBe(3);
    t = turn(g, gun);
    rig(t, 2);
    t = play(t, shoot(0, gun.id, "ol45", enf.id)).g;
    // A graze: 1 damage, less 1 for armor.
    expect(unit(t, enf.id)!.hp).toBe(4);
  });

  it("gives a headshot on a 6, and Formation's extra die beside an ally", () => {
    const g = battle([{ kind: "gunwight", side: 0, at: at(3, 6) }, { kind: "gunwight", side: 0, at: at(4, 6) }, { kind: "carnifex", side: 1, at: at(3, 3) }]);
    const gun = the(g, "gunwight"), foe = the(g, "carnifex", 1);
    let t = turn(g, gun);
    rig(t, 6, 1);
    const n = t.log.length;
    t = play(t, shoot(0, gun.id, "ol45", foe.id)).g;
    expect(logSince(t, n).join("\n")).toContain("(2D)");
    expect(unit(t, foe.id)!.tokens.vulnerable).toBe(1);
  });

  it("takes a die off a ranged attack at a unit beside a wall between them", () => {
    const shot = (walled: boolean) => {
      const board = walled ? wall(emptyBoard(8), at(4, 4)) : emptyBoard(8);
      const g = battle([{ kind: "barrelform", side: 0, at: at(6, 7) }, { kind: "carnifex", side: 1, at: at(4, 3) }], { board });
      const t = turn(g, the(g, "barrelform"));
      rig(t, 6, 6);
      const n = t.log.length;
      return logSince(play(t, shoot(0, the(t, "barrelform").id, "snipe", the(t, "carnifex", 1).id)).g, n).join("\n");
    };
    expect(shot(false)).toContain("(1D)");
    expect(shot(true)).toContain("(0D)");
  });
});

describe("forced movement", () => {
  it("won't push an Enforcer in Shieldwall, and its wall ends at the start of its next turn", () => {
    const g = battle([{ kind: "enforcer", side: 0, at: at(3, 4) }, { kind: "gunwight", side: 1, at: at(3, 3) }, { kind: "gunwight", side: 0, at: at(4, 4) }]);
    const enf = the(g, "enforcer"), gun = the(g, "gunwight", 1), pal = the(g, "gunwight", 0);
    let t = turn(g, enf);
    t = play(t, { kind: "act", side: 0, unit: enf.id, ability: "shieldwall", target: { kind: "self" } }).g;
    t = apply(t, { kind: "end", side: 0 });
    t = turn(t, unit(t, gun.id)!);
    t = play(t, { kind: "act", side: 1, unit: gun.id, ability: "baton", target: { kind: "unit", id: enf.id } }).g;
    expect(unit(t, enf.id)).toMatchObject({ col: 3, row: 4 });
    // The adjacent ally has cover from every direction while the wall stands.
    expect(covered(t, unit(t, pal.id)!, [at(4, 7)])).toBe(true);
    expect(covered(g, unit(g, pal.id)!, [at(4, 7)])).toBe(false);
    t = apply(t, { kind: "end", side: 1 });
    t = turn(t, unit(t, enf.id)!);
    expect(t.lasting.some((l) => l.on === enf.id)).toBe(false);
    expect(covered(t, unit(t, pal.id)!, [at(4, 7)])).toBe(false);
  });

  it("pulls a unit with Meat Hook until it is adjacent", () => {
    const g = battle([{ kind: "painGhoul", side: 1, at: at(3, 1) }, { kind: "gunwight", side: 0, at: at(3, 4) }]);
    const ghoul = the(g, "painGhoul", 1), gun = the(g, "gunwight");
    const t = play(turn(g, ghoul), { kind: "act", side: 1, unit: ghoul.id, ability: "meatHook", target: { kind: "unit", id: gun.id } }).g;
    // Any space closer will do, diagonals included; the pull stops once nothing is closer.
    const u = unit(t, gun.id)!;
    expect(u.row).toBe(2);
    expect(Math.abs(u.col - 3)).toBeLessThanOrEqual(1);
  });

  it("keeps a Goregrinder fighting at 0 hp in a blood rage, with 1 strength", () => {
    const g = battle([{ kind: "warhead", side: 1, at: at(3, 3) }, { kind: "gunwight", side: 0, at: at(3, 6) }]);
    const wh = the(g, "warhead", 1), gun = the(g, "gunwight");
    unit(g, wh.id)!.hp = 1;
    let t = turn(g, gun);
    rig(t, 5);
    t = play(t, shoot(0, gun.id, "ol45", wh.id), (r) => (r.kind === "yesno" ? false : 0)).g;
    expect(unit(t, wh.id)).toMatchObject({ hp: 0, raging: true, tokens: { strength: 1 } });
    t = turn(t, unit(t, gun.id)!);
    t = apply(t, { kind: "reload", side: 0, unit: gun.id });
    rig(t, 5);
    t = play(t, shoot(0, gun.id, "ol45", wh.id), (r) => (r.kind === "yesno" ? false : 0)).g;
    expect(unit(t, wh.id)).toBeUndefined();
  });

  it("charges a Warhead through units, hurting each, and ends on open ground", () => {
    const g = battle([{ kind: "warhead", side: 1, at: at(3, 0) }, { kind: "gunwight", side: 0, at: at(3, 2) }, { kind: "enforcer", side: 0, at: at(3, 4) }]);
    const wh = the(g, "warhead", 1), gun = the(g, "gunwight"), enf = the(g, "enforcer");
    const t = play(turn(g, wh), { kind: "act", side: 1, unit: wh.id, ability: "charge", target: { kind: "direction", d: at(0, 1) } }).g;
    // MV 4 from row 0 reaches row 4, where the Enforcer stands, so it stops at row 3.
    expect(unit(t, wh.id)).toMatchObject({ col: 3, row: 3 });
    expect(unit(t, gun.id)!.hp).toBe(1);
    expect(unit(t, enf.id)!.hp).toBe(4);
  });
});

describe("goregrinders", () => {
  it("gives the Warlord berserk as its turn starts, which Quench turns into speed", () => {
    const g = battle([{ kind: "warlord", side: 1, at: at(3, 3) }]);
    const lord = the(g, "warlord", 1);
    let t = turn(g, lord);
    expect(unit(t, lord.id)!.tokens.berserk).toBe(1);
    t = play(t, { kind: "act", side: 1, unit: lord.id, ability: "quench", target: { kind: "self" } }, (r) => (r.kind === "yesno" ? false : 0)).g;
    // Quench resolved before berserk could bite, so nothing was hurt.
    expect(unit(t, lord.id)).toMatchObject({ hp: 10, tokens: { speed: 1 } });
  });

  it("bites with berserk after an ACT: adjacent units take 1, or the unit itself if none are near", () => {
    const rev = (withNeighbour: boolean) => {
      const placed = [{ kind: "carnifex", side: 1, at: at(3, 3) }, { kind: "gunwight", side: 0, at: withNeighbour ? at(3, 4) : at(6, 6) }] as const;
      const g = battle(placed);
      const cx = the(g, "carnifex", 1);
      cx.tokens.berserk = 1;
      const t = play(turn(g, cx), { kind: "act", side: 1, unit: cx.id, ability: "rev", target: { kind: "self" } }).g;
      return { cx: unit(t, cx.id)!, gun: unit(t, the(g, "gunwight").id)! };
    };
    const near = rev(true);
    expect([near.cx.hp, near.gun.hp, near.cx.tokens.berserk ?? 0]).toEqual([4, 1, 0]);
    const alone = rev(false);
    expect([alone.cx.hp, alone.gun.hp]).toEqual([3, 2]);
  });

  it("strikes back with retaliation at any range, even when slain", () => {
    const g = battle([{ kind: "carnifex", side: 1, at: at(3, 3) }, { kind: "gunwight", side: 0, at: at(3, 6) }]);
    const cx = the(g, "carnifex", 1), gun = the(g, "gunwight");
    let t = turn(g, cx);
    rig(t, 5);
    t = play(t, { kind: "act", side: 1, unit: cx.id, ability: "rev", target: { kind: "self" } }).g;
    expect(t.lasting.some((l) => l.on === cx.id && l.name === "retaliation")).toBe(true);
    // Already at 0 hp in its blood rage, so the next damage slays it.
    Object.assign(unit(t, cx.id)!, { hp: 0, raging: true });
    t = turn(t, unit(t, gun.id)!);
    rig(t, 6);
    t = play(t, shoot(0, gun.id, "ol45", cx.id), (r) => (r.kind === "yesno" ? false : 0)).g;
    expect(unit(t, cx.id)).toBeUndefined();
    expect(unit(t, gun.id)!.hp).toBe(1);
  });
});

describe("carcass", () => {
  it("stops a foe moving next to an Operator on Overwatch, hurting and pushing it", () => {
    const g = battle([{ kind: "operator", side: 0, at: at(3, 5) }, { kind: "carnifex", side: 1, at: at(3, 1) }], { picks: { operator: ["boneWall", "grenadeJump", "overwatch"] } });
    const op = the(g, "operator"), cx = the(g, "carnifex", 1);
    let t = turn(g, op);
    t.soul[0] = 3;
    t = play(t, { kind: "soul", side: 0, ability: "overwatch", target: { kind: "self" } }).g;
    expect(t.soul[0]).toBe(0);
    t = apply(t, { kind: "end", side: 0 });
    t = turn(t, unit(t, cx.id)!);
    t = play(t, { kind: "move", side: 1, unit: cx.id, path: [at(3, 2), at(3, 3), at(3, 4)] }).g;
    const c = unit(t, cx.id)!;
    expect(c.hp).toBe(3);
    // Stopped at (3,4) beside the Operator, then pushed back a space.
    expect(Math.max(Math.abs(c.col - 3), Math.abs(c.row - 5))).toBe(2);
  });

  it("extends a transformed Barrelform's range by 2 and roots it until it reverts, losing its strength", () => {
    const g = battle([{ kind: "barrelform", side: 0, at: at(0, 7) }, { kind: "carnifex", side: 1, at: at(0, 1) }]);
    const bf = the(g, "barrelform"), cx = the(g, "carnifex", 1);
    let t = turn(g, bf);
    expect(() => apply(t, shoot(0, bf.id, "snipe", cx.id))).toThrow("out of range");
    t = play(t, { kind: "act", side: 0, unit: bf.id, ability: "transformToGun", target: { kind: "self" } }).g;
    expect(unit(t, bf.id)!.tokens.strength).toBe(2);
    expect(() => apply(t, { kind: "move", side: 0, unit: bf.id, path: [at(0, 6)] })).toThrow("can't MOVE");
    t = apply(t, { kind: "end", side: 0 });
    t = turn(t, unit(t, bf.id)!);
    rig(t, 1);
    t = play(t, shoot(0, bf.id, "snipe", cx.id)).g;
    t = apply(t, { kind: "end", side: 0 });
    t = turn(t, unit(t, bf.id)!);
    t = apply(t, { kind: "revert", side: 0, unit: bf.id });
    expect(unit(t, bf.id)!.tokens.strength ?? 0).toBe(0);
    t = apply(t, { kind: "move", side: 0, unit: bf.id, path: [at(1, 7)] });
    expect(unit(t, bf.id)!.col).toBe(1);
  });

  it("gives Hot Clip strength on a reload, and refuses a second shot until then", () => {
    const g = battle([{ kind: "operator", side: 0, at: at(3, 6) }, { kind: "carnifex", side: 1, at: at(3, 3) }]);
    const op = the(g, "operator"), cx = the(g, "carnifex", 1);
    let t = turn(g, op);
    rig(t, 1);
    t = play(t, shoot(0, op.id, "akimbo", cx.id)).g;
    t = apply(t, { kind: "end", side: 0 });
    t = turn(t, unit(t, op.id)!);
    expect(() => apply(t, shoot(0, op.id, "akimbo", cx.id))).toThrow("must reload");
    t = apply(t, { kind: "reload", side: 0, unit: op.id });
    expect(unit(t, op.id)!.tokens.strength).toBe(1);
    rig(t, 1);
    expect(() => play(t, shoot(0, op.id, "akimbo", cx.id))).not.toThrow();
  });
});
