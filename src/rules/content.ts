// What a unit card says, as data and code: stats, traits and abilities. The
// houses' cards live in src/content; this module holds their shape and the
// registry the engine looks them up in.

import type { Answer, Game, Request, Target } from "./state";
import type { Unit } from "./types";

/** An ability's resolution: it may stop to ask for choices, which the engine answers. */
export type Gen<T = void> = Generator<Request, T, Answer>;

export type Armor = "none" | "arm" | "ward" | "super";
export type UnitType = "thrall" | "scion" | "freak" | "horror" | "hunter" | "tyrant" | "necromancer";
export type DamageType = "physical" | "fire" | "toxic" | "curse" | "holy" | "devil";

/** What an ability may be aimed at. Ranges count spaces, diagonals included (p16). */
export type Targeting =
  | { readonly kind: "self" }
  | {
      readonly kind: "unit";
      /** Nearest and furthest spaces; melee is 1 to 1. */
      readonly min: number;
      readonly max: number;
      /** Which units: any other unit, foes only, allies only, or the user too. */
      readonly who: "other" | "foe" | "ally" | "any";
      /** Whether a wall may be aimed at as well (attacks may target walls, p19). */
      readonly walls?: boolean;
    }
  /** A line's first space, beside the user, which fixes its lane and direction (p17). */
  | { readonly kind: "line" }
  /** A compass direction, for straight-line moves. */
  | { readonly kind: "direction" };

/** When a SOUL ability may be used (p20). */
export interface SoulTiming {
  readonly cost: number;
  /** During the necromancer's own turn, any of its side's unit turns, or any turn at all. */
  readonly when: "own" | "allied" | "any";
  /** For a triggered ability, the event that offers it; otherwise the player uses it at will. */
  readonly trigger?: Trigger;
}

export type Trigger = "moved" | "acted" | "hit" | "headshot" | "reducedToOne" | "slain" | "slay";

export interface Ability {
  readonly id: string;
  readonly name: string;
  /** The card's tags, for display: "Attack, range 2-3, reload". */
  readonly tags: string;
  /** A short summary of its effect, for display. */
  readonly text: string;
  readonly target: Targeting;
  readonly attack?: boolean;
  readonly melee?: boolean;
  readonly curse?: boolean;
  readonly reload?: boolean;
  readonly soul?: SoulTiming;
  resolve(x: Ctx, t: Target): Gen;
}

/** A passive ability, by name; the engine and abilities test for it with `hasTrait`. */
export interface Trait {
  readonly id: string;
  readonly name: string;
  readonly text: string;
}

export interface UnitDef {
  readonly id: string;
  readonly name: string;
  readonly house: string;
  readonly type: UnitType;
  readonly mv: number;
  readonly hp: number;
  /** The roll an attack needs to hit it. */
  readonly df: number;
  readonly armor: Armor;
  readonly size: 1 | 2;
  readonly traits: readonly Trait[];
  readonly acts: readonly Ability[];
  /** A necromancer's base SOUL abilities. */
  readonly souls?: readonly Ability[];
  /** A necromancer's options for its one extra trait, ACT and SOUL ability (p21). */
  readonly picks?: { readonly traits: readonly Trait[]; readonly acts: readonly Ability[]; readonly souls: readonly Ability[] };
}

/** What an ability's code works with while it resolves. */
export interface Ctx {
  readonly g: Game;
  /** The unit using the ability. */
  readonly actor: Unit;
  /** The side choosing where the rules leave a choice. */
  readonly side: number;
  readonly ability: Ability | null;
  /** Units that took damage from the ability, for berserk and retaliation (p32). */
  readonly damaged: Set<string>;
  /** Retaliation owed once the ability resolves: who strikes back at whom. */
  readonly retaliation: { readonly from: string; readonly to: string }[];
  /** Units the ability pushed or pulled. */
  readonly forced: Set<string>;
}

const registry = new Map<string, UnitDef>();

export function register(...defs: UnitDef[]): void {
  for (const d of defs) registry.set(d.id, d);
}

export function defOf(kind: string): UnitDef {
  const d = registry.get(kind);
  if (!d) throw new Error(`unknown unit kind ${kind}`);
  return d;
}

export function allDefs(): UnitDef[] {
  return [...registry.values()];
}

/**
 * Rules that react to play rather than being used: content registers them
 * here. `enter` runs as a unit enters a space by its own movement and
 * returns true to stop that movement (Overwatch, p30); `range` adds to an
 * ability's maximum range (Brace, Transform to Gun, p27-p28).
 */
export const hooks: {
  enter: ((x: Ctx, mover: Unit, cell: { col: number; row: number }) => Gen<boolean>)[];
  range: ((g: Game, u: Unit, a: Ability) => number)[];
  /** Traits a unit has only while something holds, such as Blood Rush at 3 hp or lower (p36). */
  trait: ((g: Game, u: Unit, id: string) => boolean)[];
  /** Changes to the roll an attack needs, such as Nerve Twitch (p36). */
  df: ((g: Game, u: Unit, df: number) => number)[];
  /** Squares that give `target` cover as a wall would, such as Siege Shield (p29). */
  cover: ((g: Game, target: Unit) => { col: number; row: number }[])[];
  /** Rules that run once an ACT ability resolves, such as Bone Shards (p28). */
  after: ((x: Ctx) => Gen)[];
} = { enter: [], range: [], trait: [], df: [], cover: [], after: [] };
