// Offering triggered SOUL abilities (p20). When a trigger happens, each
// side whose necromancer has a matching ability, the SOUL to pay for it,
// the right timing, and no SOUL ability used yet this unit turn is asked
// whether to use it.

import { type Ability, type Ctx, type Gen, type Trigger, defOf } from "./content";
import type { Game } from "./state";
import type { Unit } from "./types";

/** Triggers only the acting side's necromancer can answer: they speak of what "you" did. */
const ACTOR_ONLY: readonly Trigger[] = ["hit", "headshot", "reducedToOne", "slay"];

export function necromancerOf(g: Game, side: number): Unit | undefined {
  return g.units.find((u) => u.side === side && defOf(u.kind).type === "necromancer");
}

/** A necromancer's SOUL abilities: its card's and the one it picked. */
export function soulsOf(u: Unit): Ability[] {
  const d = defOf(u.kind);
  return [...(d.souls ?? []), ...(d.picks?.souls ?? []).filter((a) => u.picks?.includes(a.id))];
}

/** Whether a SOUL ability's timing allows `side` to use it now. */
export function timely(g: Game, side: number, a: Ability): boolean {
  const necro = necromancerOf(g, side);
  if (!necro || !a.soul) return false;
  if (a.soul.when === "own") return g.active.some((x) => x.id === necro.id);
  if (a.soul.when === "allied") return g.side === side && g.active.length > 0;
  return true;
}

/** Offer the SOUL abilities `trigger` sets off; `subject` is the unit it happened to or by. */
export function* offer(x: Ctx, trigger: Trigger, subject: Unit): Gen {
  const { g } = x;
  for (let side = 0; side < g.sides; side++) {
    if (ACTOR_ONLY.includes(trigger) && side !== x.side) continue;
    if (g.soulUsed[side] || g.phase !== "battle") continue;
    const necro = necromancerOf(g, side);
    if (!necro) continue;
    for (const a of soulsOf(necro)) {
      if (a.soul?.trigger !== trigger || a.soul.cost > (g.soul[side] ?? 0) || !timely(g, side, a)) continue;
      const yes = yield { kind: "yesno", side, prompt: `Spend ${a.soul.cost} SOUL on ${a.name}?` };
      if (yes !== true) continue;
      g.soul[side] = (g.soul[side] ?? 0) - a.soul.cost;
      g.soulUsed[side] = true;
      const sub: Ctx = { g, actor: necro, side, ability: a, damaged: new Set(), retaliation: [], forced: new Set() };
      yield* a.resolve(sub, { kind: "unit", id: subject.id });
      break;
    }
  }
}
