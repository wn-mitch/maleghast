// Starting a battle: checking each side's Black Mass (p21-p22), rolling
// initiative (p11), and putting every unit in reserve to deploy.

import { type UnitType, defOf } from "./content";
import { d6 } from "./dice";
import type { Game } from "./state";
import type { Board, Unit } from "./types";

export interface SideSetup {
  readonly necromancer: string;
  /** The necromancer's extra trait, ACT ability and SOUL ability, by id. */
  readonly picks: readonly string[];
  readonly units: readonly string[];
}

export interface Setup {
  readonly board: Board;
  readonly sides: readonly SideSetup[];
  readonly seed: number;
  /** Unit slots besides the necromancer: 5 in a duel, 4 in larger games (p22). */
  readonly slots?: number;
}

/** The most of each unit type a Black Mass may take (p22); thralls are unlimited. */
export const CAPS: Partial<Record<UnitType, number>> = { scion: 3, freak: 2, horror: 2, hunter: 2, tyrant: 1 };

/** What's wrong with a side's Black Mass, or null if it's legal. */
export function listError(s: SideSetup, slots = 5): string | null {
  const necro = defOf(s.necromancer);
  if (necro.type !== "necromancer") return "lead with a necromancer";
  const p = necro.picks;
  if (p) {
    const count = (ids: readonly { id: string }[]) => s.picks.filter((id) => ids.some((x) => x.id === id)).length;
    if (count(p.traits) !== 1 || count(p.acts) !== 1 || count(p.souls) !== 1 || s.picks.length !== 3) return "pick one more trait, ACT ability and SOUL ability";
  }
  let thralls = 0, used = 0;
  const seen: Partial<Record<UnitType, number>> = {};
  for (const k of s.units) {
    const d = defOf(k);
    if (d.house !== necro.house) return `${d.name} serves another house`;
    if (d.type === "necromancer") return "one necromancer per side";
    if (d.type === "thrall") thralls++;
    else used++;
    seen[d.type] = (seen[d.type] ?? 0) + 1;
    const cap = CAPS[d.type];
    if (cap !== undefined && (seen[d.type] ?? 0) > cap) return `at most ${cap} ${d.type}s`;
  }
  // Two thralls fill one slot (p22).
  if (used + Math.ceil(thralls / 2) > slots) return `at most ${slots} unit slots`;
  return null;
}

/** A battle ready to deploy, initiative rolled: each side rolls a d6, re-rolling ties, and the winner acts first. */
export function newGame(s: Setup): Game {
  s.sides.forEach((side, i) => {
    const why = listError(side, s.slots);
    if (why) throw new Error(`side ${i + 1}: ${why}`);
  });
  let seed = s.seed >>> 0, first = 0;
  const log: Game["log"] = [];
  for (;;) {
    const rolls = s.sides.map(() => {
      const r = d6(seed);
      seed = r.seed;
      return r.roll;
    });
    const top = Math.max(...rolls);
    log.push({ kind: "note", text: `Initiative: ${rolls.map((r, i) => `side ${i + 1} rolls ${r}`).join(", ")}` });
    if (rolls.filter((r) => r === top).length === 1) {
      first = rolls.indexOf(top);
      break;
    }
  }
  log.push({ kind: "note", text: `Side ${first + 1} acts and deploys first` });
  const reserve: Unit[] = s.sides.flatMap((side, i) =>
    [side.necromancer, ...side.units].map((kind, n) => {
      const d = defOf(kind);
      const u: Unit = { id: `${i}.${n}.${kind}`, side: i, kind, col: -1, row: -1, size: d.size, hp: d.hp, tokens: {}, done: false, unloaded: false };
      if (d.type === "necromancer") u.picks = [...side.picks];
      return u;
    }));
  return {
    board: structuredClone(s.board), units: [], reserve, fallen: [], sides: s.sides.length,
    phase: "deploy", round: 0, side: first, first, active: [],
    soul: s.sides.map(() => 0), soulUsed: s.sides.map(() => false), activations: 0, turns: {}, lasting: [],
    seed, log, pending: null, winner: null,
  };
}
