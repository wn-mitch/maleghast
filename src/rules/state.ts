// A game in progress, the commands players send, and the choices the rules
// ask them for. All plain data: the server stores it and clients receive it.

import type { Board, Cell, Unit } from "./types";

/** A choice the rules need before a command can finish. */
export type Request =
  | { readonly kind: "cell"; readonly side: number; readonly prompt: string; readonly options: readonly Cell[]; readonly optional: boolean }
  | { readonly kind: "unit"; readonly side: number; readonly prompt: string; readonly options: readonly string[]; readonly optional: boolean }
  | { readonly kind: "yesno"; readonly side: number; readonly prompt: string };

/** An answer to a request: an index into its options, true or false for yes/no, or null to decline an optional one. */
export type Answer = number | boolean | null;

export type Target =
  | { readonly kind: "self" }
  | { readonly kind: "unit"; readonly id: string }
  | { readonly kind: "cell"; readonly cell: Cell }
  | { readonly kind: "direction"; readonly d: Cell };

export type Command =
  /** Place a unit during deployment. */
  | { readonly kind: "deploy"; readonly side: number; readonly unit: string; readonly at: Cell }
  /** Start a side's turn with one unit, or two thralls together. */
  | { readonly kind: "activate"; readonly side: number; readonly units: readonly string[] }
  /** MOVE an active unit along `path` (orthogonal steps, the start left out); `boost` spends berserk as speed (Fueled by Rage). */
  | { readonly kind: "move"; readonly side: number; readonly unit: string; readonly path: readonly Cell[]; readonly boost?: boolean }
  /** Use an ACT ability. */
  | { readonly kind: "act"; readonly side: number; readonly unit: string; readonly ability: string; readonly target: Target }
  /** Sacrifice a MOVE to reload. */
  | { readonly kind: "reload"; readonly side: number; readonly unit: string }
  /** Sacrifice a MOVE to end a stance such as Transform to Gun. */
  | { readonly kind: "revert"; readonly side: number; readonly unit: string }
  /** Spend SOUL on one of the side's necromancer's SOUL abilities. */
  | { readonly kind: "soul"; readonly side: number; readonly ability: string; readonly target: Target }
  /** End the active units' turn. */
  | { readonly kind: "end"; readonly side: number }
  /** Answer the pending request. */
  | { readonly kind: "answer"; readonly side: number; readonly answer: Answer };

/** Something that happened, for the log and for animation. */
export interface Event {
  readonly kind: string;
  readonly text: string;
  readonly unit?: string;
  readonly cells?: readonly Cell[];
}

/** An effect lasting until a point in its owner's turns (p27 onward: "until the start of this unit's next turn"). */
export interface Lasting {
  readonly name: string;
  /** The unit whose turns it is measured by. */
  readonly owner: string;
  /** The unit it is on. */
  readonly on: string;
  /** It ends at the start or the end of the owner's turn numbered `turn`. */
  readonly at: "start" | "end";
  readonly turn: number;
}

export interface Pending {
  /** The game before the command, to replay it with each answer. */
  readonly before: Game;
  readonly command: Command;
  readonly answers: readonly Answer[];
  readonly request: Request;
}

export type Phase = "deploy" | "battle" | "over";

export interface Game {
  board: Board;
  /** Units on the battlefield. */
  units: Unit[];
  /** Units still to deploy. */
  reserve: Unit[];
  /** Units slain or obliterated, kept for the record and for SOUL harvest. */
  fallen: Unit[];
  sides: number;
  phase: Phase;
  round: number;
  /** The side to act: deploy, activate, or command its active units. */
  side: number;
  /** The side that acts first each round. */
  first: number;
  /** The units taking this turn, with what each has spent. */
  active: { readonly id: string; moves: number; acted: boolean }[];
  soul: number[];
  /** Whether each side has used a SOUL ability during the current unit turn. */
  soulUsed: boolean[];
  /** Activations so far in the battle, for once-a-turn effects. */
  activations: number;
  /** Each unit's count of turns started, for lasting effects. */
  turns: Record<string, number>;
  lasting: Lasting[];
  seed: number;
  log: Event[];
  pending: Pending | null;
  winner: number | "draw" | null;
}
