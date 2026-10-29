import { describe, expect, it } from "vitest";
import { emptyBoard, gap, inCover, index, sees, touches } from "../src/rules/board";
import { pool } from "../src/rules/dice";
import { reachable } from "../src/rules/movement";
import type { Board, Cell, Terrain, Unit } from "../src/rules/types";

const at = (col: number, row: number): Cell => ({ col, row });

function wall(b: Board, ...cells: Cell[]): Board {
  for (const c of cells) b.walls[index(b, c)] = 2;
  return b;
}

function ground(b: Board, t: Terrain, ...cells: Cell[]): Board {
  for (const c of cells) b.terrain[index(b, c)] = t;
  return b;
}

function unit(id: string, side: number, col: number, row: number, size: 1 | 2 = 1): Unit {
  return { id, side, kind: "test", col, row, size, hp: 3, tokens: {}, done: false, unloaded: false };
}

describe("dice", () => {
  it("keeps the highest of a pool and the lowest of two for an empty one", () => {
    const three = pool(42, 3), none = pool(42, 0);
    expect(three.rolls).toHaveLength(3);
    expect(three.result).toBe(Math.max(...three.rolls));
    expect(none.rolls).toHaveLength(2);
    expect(none.result).toBe(Math.min(...none.rolls));
  });
});

describe("line of sight", () => {
  it("counts a line that only grazes a wall's edge as blocked", () => {
    // From the top edge of (0,0) to the top edge of (2,0) runs along the wall's top edge.
    expect(touches({ x: 0, y: 0 }, { x: 3, y: 0 }, at(1, 0))).toBe(true);
    expect(touches({ x: 0, y: 0 }, { x: 3, y: 0 }, at(1, 1))).toBe(false);
  });

  it("is blocked by a wall squarely between, and found around a wall's corner", () => {
    const b = wall(emptyBoard(8), at(3, 3));
    expect(sees(b, [at(2, 3)], [at(4, 3)])).toBe(false);
    // Diagonally past the wall: the far corners clear it.
    expect(sees(b, [at(2, 2)], [at(4, 4)])).toBe(false);
    expect(sees(b, [at(2, 2)], [at(4, 2)])).toBe(true);
  });

  it("is blocked by a wall filling the row between", () => {
    const b = wall(emptyBoard(8), at(3, 2), at(3, 3), at(3, 4));
    expect(sees(b, [at(2, 3)], [at(5, 3)])).toBe(false);
    expect(sees(b, [at(2, 0)], [at(5, 0)])).toBe(true);
  });

  it("lets a unit see the wall it targets", () => {
    const b = wall(emptyBoard(8), at(3, 3));
    expect(sees(b, [at(1, 3)], [at(3, 3)])).toBe(true);
  });
});

describe("cover", () => {
  // A unit at (3,3) with a wall on its east at (4,3).
  const b = wall(emptyBoard(8), at(4, 3));
  const target = [at(3, 3)];

  it("counts against attackers past the line of the edge it shares with the wall", () => {
    expect(inCover(b, target, [at(6, 1)])).toBe(true);
    expect(inCover(b, target, [at(5, 5)])).toBe(true);
  });

  it("doesn't count against a flanker on its own side of that line", () => {
    expect(inCover(b, target, [at(3, 0)])).toBe(false);
    expect(inCover(b, target, [at(0, 3)])).toBe(false);
  });

  it("doesn't count against a big attacker straddling that line", () => {
    expect(inCover(b, target, [at(3, 0), at(4, 0), at(3, 1), at(4, 1)])).toBe(false);
    expect(inCover(b, target, [at(4, 0), at(5, 0), at(4, 1), at(5, 1)])).toBe(true);
  });

  it("comes from elevation only to a unit on the ground", () => {
    const hill = ground(emptyBoard(8), { elevated: true }, at(4, 3));
    expect(inCover(hill, target, [at(6, 3)])).toBe(true);
    const up = ground(emptyBoard(8), { elevated: true }, at(4, 3), at(3, 3));
    expect(inCover(up, target, [at(6, 3)])).toBe(false);
  });

  it("measures range diagonally", () => {
    expect(gap([at(0, 0)], [at(3, 2)])).toBe(3);
  });
});

describe("movement", () => {
  const ends = (b: Board, units: Unit[], mover: Unit, budget: number, maxSpaces?: number) =>
    new Map([...reachable(b, units, mover, budget, maxSpaces)].map(([k, r]) => [`${k % b.size},${Math.floor(k / b.size)}`, r.cost]));

  it("moves orthogonally, so a diagonal square costs two", () => {
    const m = unit("m", 0, 3, 3);
    const r = ends(emptyBoard(8), [m], m, 2);
    expect(r.get("4,4")).toBe(2);
    expect(r.has("5,5")).toBe(false);
    expect(r.get("3,5")).toBe(2);
  });

  it("passes through allies but can't end on them, and can't pass foes", () => {
    const m = unit("m", 0, 0, 0), ally = unit("a", 0, 1, 0), foe = unit("f", 1, 0, 1);
    const r = ends(emptyBoard(8), [m, ally, foe], m, 2);
    expect(r.has("1,0")).toBe(false);
    expect(r.get("2,0")).toBe(2);
    expect(r.has("0,1")).toBe(false);
    expect(r.has("0,2")).toBe(false);
  });

  it("pays one more to climb, unless stairs lead up, and one more to leave adverse ground", () => {
    const m = unit("m", 0, 0, 0);
    const hill = ground(emptyBoard(8), { elevated: true }, at(1, 0), at(2, 0));
    expect(ends(hill, [m], m, 4).get("2,0")).toBe(3);
    const stairs = ground(ground(emptyBoard(8), { elevated: true }, at(2, 0)), { stairs: true }, at(1, 0));
    expect(ends(stairs, [m], m, 4).get("2,0")).toBe(2);
    const mud = ground(emptyBoard(8), { adverse: true }, at(0, 0));
    expect(ends(mud, [m], m, 4).get("1,0")).toBe(2);
  });

  it("can always move one space, whatever it costs", () => {
    const m = unit("m", 0, 0, 0);
    const mud = ground(emptyBoard(8), { adverse: true }, at(0, 0));
    const r = ends(mud, [m], m, 1);
    expect(r.has("1,0")).toBe(true);
    expect(r.has("2,0")).toBe(false);
  });

  it("goes only one space when slowed", () => {
    const m = unit("m", 0, 3, 3);
    expect([...ends(emptyBoard(8), [m], m, 4, 1).keys()].sort()).toEqual(["2,3", "3,2", "3,4", "4,3"]);
  });

  it("moves a 2x2 unit only where its whole body fits", () => {
    const t = unit("t", 0, 0, 0, 2);
    const b = wall(emptyBoard(8), at(3, 1));
    const r = ends(b, [t], t, 3);
    expect(r.has("1,0")).toBe(true);
    expect(r.has("2,0")).toBe(false);
    expect(r.get("1,2")).toBe(3);
    const far = ends(b, [t], t, 20);
    expect(far.has("6,6")).toBe(true);
    expect(far.has("7,6")).toBe(false);
  });
});
