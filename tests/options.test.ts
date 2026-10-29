import { describe, expect, it } from "vitest";
import { actOptions, chosen, deployOptions, moveOptions, readyUnits, refusal, requestOptions, soulOptions } from "../src/client/play";
import { apply } from "../src/rules/engine";
import { at, battle, the, turn } from "./play";

const key = (c: { col: number; row: number }) => `${c.col},${c.row}`;

describe("client options", () => {
  it("offers exactly the empty squares of the deploying side's zone", () => {
    let g = battle([{ kind: "gunwight", side: 0, at: at(0, 7) }]);
    // Back to deployment with one unit still in reserve.
    const gun = the(g, "gunwight");
    g = { ...g, phase: "deploy", side: 0, units: g.units.filter((u) => u.id !== gun.id), reserve: [gun] };
    g.units.push({ ...the(g, "warlord", 1), id: "blocker", side: 0, col: 3, row: 6 });
    const cells = deployOptions(g, 0, gun.id).map((o) => key(o.cells[0]!));
    expect(cells).toHaveLength(15);
    expect(cells).not.toContain("3,6");
    expect(cells.every((c) => ["6", "7"].includes(c.split(",")[1]!))).toBe(true);
    expect(deployOptions(g, 1, gun.id)).toEqual([]);
  });

  it("offers MOVE spaces only while the unit has a MOVE left, and each one is a move the engine takes", () => {
    const g = battle([{ kind: "gunwight", side: 0, at: at(3, 6) }, { kind: "carnifex", side: 1, at: at(3, 4) }]);
    const gun = the(g, "gunwight");
    let t = turn(g, gun);
    const opts = moveOptions(t, 0, gun.id, false);
    // MV 2 on open ground: the 11 squares within 2 orthogonal steps on the board, less the foe's.
    expect(opts.map((o) => key(o.cells[0]!))).not.toContain("3,4");
    expect(opts.length).toBe(10);
    for (const o of opts) expect(refusal(t, o.cmd)).toBeNull();
    t = apply(t, opts[0]!.cmd);
    t = apply(t, moveOptions(t, 0, gun.id, false)[0]!.cmd);
    expect(moveOptions(t, 0, gun.id, false)).toEqual([]);
    expect(moveOptions(t, 1, gun.id, false)).toEqual([]);
  });

  it("offers an attack's targets in range and sight, shown on the target's squares", () => {
    const g = battle([{ kind: "gunwight", side: 0, at: at(3, 6) }, { kind: "carnifex", side: 1, at: at(3, 3) }, { kind: "warhead", side: 1, at: at(3, 5) }, { kind: "warlord", side: 1, at: at(7, 0) }]);
    const gun = the(g, "gunwight"), cx = the(g, "carnifex", 1);
    const t = turn(g, gun);
    // OL45 is range 2-3: the Carnifex 3 away, not the Warhead 1 away.
    const opts = actOptions(t, 0, gun.id, "ol45");
    expect(opts.map((o) => o.cmd)).toEqual([{ kind: "act", side: 0, unit: gun.id, ability: "ol45", target: { kind: "unit", id: cx.id } }]);
    expect(chosen(opts, at(3, 3))).toBe(opts[0]);
    expect(chosen(opts, at(3, 5))).toBeUndefined();
  });

  it("offers a Charge as the four squares beside the unit, one per direction", () => {
    const g = battle([{ kind: "warhead", side: 1, at: at(0, 3) }]);
    const t = turn(g, the(g, "warhead", 1));
    const opts = actOptions(t, 1, the(g, "warhead", 1).id, "charge");
    // West is off the board.
    expect(opts.map((o) => key(o.cells[0]!)).sort()).toEqual(["0,2", "0,4", "1,3"]);
  });

  it("offers SOUL abilities only with the SOUL to pay, and the answers to a choice only to its side", () => {
    const g = battle([{ kind: "operator", side: 0, at: at(3, 5) }, { kind: "carnifex", side: 1, at: at(3, 2) }], { picks: { operator: ["boneWall", "grenadeJump", "overwatch"] } });
    const op = the(g, "operator");
    let t = turn(g, op);
    t.soul[0] = 0;
    expect(soulOptions(t, 0, "overwatch")).toEqual([]);
    t.soul[0] = 3;
    expect(soulOptions(t, 0, "overwatch")).toHaveLength(1);
    expect(readyUnits(t, 0)).toEqual([]);
    // A choice waiting on side 1, such as where to push.
    t = { ...t, pending: { before: t, command: { kind: "end", side: 0 }, answers: [], request: { kind: "cell", side: 1, prompt: "where?", options: [at(1, 1), at(2, 2)], optional: false } } };
    expect(requestOptions(t, 0)).toEqual([]);
    expect(requestOptions(t, 1).map((o) => o.cmd)).toEqual([{ kind: "answer", side: 1, answer: 0 }, { kind: "answer", side: 1, answer: 1 }]);
  });
});
