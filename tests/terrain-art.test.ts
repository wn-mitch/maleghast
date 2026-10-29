import { describe, expect, it } from "vitest";
import { corpsePlacement, piecesAt } from "../src/client/board";
import { emptyBoard, index, isWall, sees } from "../src/rules/board";
import { hurtWall } from "../src/rules/effects";
import { reachable } from "../src/rules/movement";
import { at, battle, the } from "./play";

describe("terrain art state", () => {
  it("keeps rubble across serialization without blocking movement or sight", () => {
    const g = battle([{ kind: "gunwight", at: at(2, 3), side: 0 }]);
    const c = at(3, 3), i = index(g.board, c);
    g.board.walls[i] = 2;
    expect(piecesAt(g.board, c).at(-1)).toBe("wall");
    hurtWall(g, c, 1);
    expect(piecesAt(g.board, c).at(-1)).toBe("wall_damaged");
    expect(g.board.terrain[i]?.rubble).toBeUndefined();
    hurtWall(g, c, 9);
    const b = JSON.parse(JSON.stringify(g.board));
    expect(piecesAt(b, c).at(-1)).toBe("rubble");
    expect(isWall(b, c)).toBe(false);
    expect(sees(b, [at(2, 3)], [at(4, 3)])).toBe(true);
    expect(reachable(b, g.units, the(g, "gunwight"), 1).get(i)?.cost).toBe(1);
    b.walls[i] = 2;
    expect(piecesAt(b, c).at(-1)).toBe("wall");
  });

  it("preserves underlying terrain and does not invent rubble on empty ground", () => {
    const g = battle([]), c = at(3, 3), i = index(g.board, c);
    hurtWall(g, c, 2);
    expect(g.board.terrain[i]?.rubble).toBeUndefined();
    g.board.walls[i] = 1;
    g.board.terrain[i] = { elevated: true, hazard: true };
    hurtWall(g, c, 1);
    expect(g.board.terrain[i]).toEqual({ elevated: true, hazard: true, rubble: true });
    expect(piecesAt(g.board, c)).toEqual(["elevated", "rubble"]);
  });

  it("places corpse piles above ground details and within one stair tread", () => {
    const b = emptyBoard(6), c = at(1, 1), i = index(b, c);
    expect(corpsePlacement(b, c).y).toBe(.005);
    b.terrain[i] = { elevated: true };
    expect(corpsePlacement(b, c).y).toBe(.505);
    b.terrain[i] = { hazard: true };
    expect(corpsePlacement(b, c).y).toBe(.055);
    b.terrain[i] = { stairs: true, elevated: true };
    const p = corpsePlacement(b, c);
    expect(p.y).toBe(.105);
    expect(p.z - .25*p.depth).toBeGreaterThan(.3);
    expect(p.z + .25*p.depth).toBeLessThan(.5);
  });
});
