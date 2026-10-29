import { describe, expect, it } from "vitest";
import { forecast, hitChance } from "../src/rules/options";
import { at, battle, the, turn, wall } from "./play";
import { emptyBoard } from "../src/rules/board";

const shoot = (g: ReturnType<typeof battle>, ability: string) =>
  ({ kind: "act", side: 0, unit: the(g, "barrelform").id, ability, target: { kind: "unit", id: the(g, "carnifex", 1).id } }) as const;

describe("attack forecast", () => {
  it("knows the odds of a die pool", () => {
    expect(hitChance(1, 4)).toBeCloseTo(0.5);
    expect(hitChance(2, 4)).toBeCloseTo(0.75);
    // 0D: the worse of two dice.
    expect(hitChance(0, 4)).toBeCloseTo(0.25);
    expect(hitChance(-1, 4)).toBeCloseTo(0.25);
    expect(hitChance(3, 1)).toBe(1);
  });

  it("counts cover exactly as the roll will", () => {
    const open = battle([{ kind: "barrelform", side: 0, at: at(6, 7) }, { kind: "carnifex", side: 1, at: at(4, 3) }]);
    const covered = battle([{ kind: "barrelform", side: 0, at: at(6, 7) }, { kind: "carnifex", side: 1, at: at(4, 3) }], { board: wall(emptyBoard(8), at(4, 4)) });
    const a = turn(open, the(open, "barrelform")), b = turn(covered, the(covered, "barrelform"));
    expect(forecast(a, shoot(a, "snipe"))).toMatchObject({ dice: 1, needs: 3 });
    expect(forecast(b, shoot(b, "snipe"))).toMatchObject({ dice: 0, needs: 3 });
  });

  it("has nothing to say about an ability that rolls no attack, or an illegal one", () => {
    const g = battle([{ kind: "barrelform", side: 0, at: at(6, 7) }, { kind: "carnifex", side: 1, at: at(4, 3) }]);
    const t = turn(g, the(g, "barrelform"));
    expect(forecast(t, { kind: "act", side: 0, unit: the(g, "barrelform").id, ability: "transformToGun", target: { kind: "self" } })).toBeNull();
    expect(forecast(t, { ...shoot(t, "snipe"), side: 1 })).toBeNull();
  });
});
