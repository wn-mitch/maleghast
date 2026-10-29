import { describe, expect, it } from "vitest";
import { decide, evaluate } from "../src/ai/ai";
import { AI_LISTS } from "../src/ai/lists";
import { emptyBoard } from "../src/rules/board";
import { unit } from "../src/rules/effects";
import { apply } from "../src/rules/engine";
import { listError, newGame } from "../src/rules/setup";
import type { Game } from "../src/rules/state";
import { at, battle, the, turn } from "./play";

/** A seeded stand-in for Math.random. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** Both sides played by the AI until the battle ends; every command must be one the engine takes. */
function selfPlay(seed: number): { g: Game; commands: number } {
  let g = newGame({ board: emptyBoard(8), sides: [AI_LISTS.carcass!, AI_LISTS.goregrinders!], seed });
  const r = rng(seed);
  let commands = 0;
  while (g.phase !== "over" && commands < 2000) {
    const side = g.pending ? g.pending.request.side : g.side;
    const cmd = decide(g, side, r, { samples: 2, beam: 3 });
    if (!cmd) throw new Error(`side ${side} has no move in ${g.phase}`);
    g = apply(g, cmd);
    commands++;
  }
  return { g, commands };
}

describe("ai", () => {
  it("fields legal lists", () => {
    for (const l of Object.values(AI_LISTS)) expect(listError(l)).toBeNull();
  });

  it("plays a whole battle against itself without an illegal command", () => {
    const { g, commands } = selfPlay(11);
    expect(g.phase).toBe("over");
    expect(commands).toBeLessThan(2000);
    // It fights: units fall over six rounds.
    expect(g.fallen.length).toBeGreaterThan(0);
  }, 120_000);

  it("closes in and shoots a necromancer that the next damage slays", () => {
    const g = battle([{ kind: "operator", side: 0, at: at(3, 7) }, { kind: "warlord", side: 1, at: at(3, 1) }]);
    // In its blood rage at 0 hp: any damage slays it and wins the battle.
    Object.assign(unit(g, the(g, "warlord", 1).id)!, { hp: 0, raging: true });
    let t = turn(g, the(g, "operator"));
    // Akimbo reaches 4; the Warlord is 6 away, so it must MOVE first.
    const first = decide(t, 0, rng(5))!;
    expect(first.kind).toBe("move");
    t = apply(t, first);
    const second = decide(t, 0, rng(6))!;
    expect(second).toMatchObject({ kind: "act", ability: "akimbo" });
  });

  it("decides without reading the game's own dice", () => {
    // At every decision of a self-played battle, a different upcoming roll must not change the choice.
    let g = newGame({ board: emptyBoard(8), sides: [AI_LISTS.carcass!, AI_LISTS.goregrinders!], seed: 3 });
    const fast = { samples: 2, beam: 2 };
    let differ = 0;
    for (let i = 0; i < 120 && g.phase !== "over"; i++) {
      const side = g.pending ? g.pending.request.side : g.side;
      const cmd = decide(g, side, rng(i), fast)!;
      if (JSON.stringify(decide({ ...g, seed: (g.seed ^ 0x5bd1e995) >>> 0 }, side, rng(i), fast)) !== JSON.stringify(cmd)) differ++;
      g = apply(g, cmd);
    }
    expect(differ).toBe(0);
  }, 120_000);

  it("scores a won battle above any position, and a lost one below", () => {
    const g = battle([{ kind: "gunwight", side: 0, at: at(3, 6) }]);
    g.soul = [2, 0];
    const base = evaluate(g, 0);
    expect(evaluate({ ...g, phase: "over", winner: 0 }, 0)).toBeGreaterThan(base + 1000);
    expect(evaluate({ ...g, phase: "over", winner: 1 }, 0)).toBeLessThan(base - 1000);
    // Zero-sum: what is good for one side is as bad for the other.
    expect(evaluate(g, 1)).toBeCloseTo(-base);
  });
});
