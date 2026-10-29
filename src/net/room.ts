// A game room: two seats, each side's Black Mass, and the battle. Shared by
// the Durable Object that holds it and the client that shows it. Players are
// known by a token their browser keeps, so a reload takes back the same seat.

import { emptyBoard } from "../rules/board";
import { apply } from "../rules/engine";
import { type SideSetup, listError, newGame } from "../rules/setup";
import type { Command, Game } from "../rules/state";

export interface Seat {
  readonly token: string;
  readonly name: string;
  /** The Black Mass this player will field, once chosen. */
  readonly list: SideSetup | null;
}

export interface Room {
  readonly seats: readonly (Seat | null)[];
  readonly game: Game | null;
  /** The battle before each of one seat's latest commands, newest last, while none of them rolled dice or asked anyone anything. */
  readonly undo?: { readonly seat: number; readonly stack: readonly Game[] } | null;
}

export interface Player {
  readonly token: string;
  readonly name: string;
}

export type ClientMsg =
  /** Take an empty seat (0 or 1) before the battle. */
  | { readonly t: "sit"; readonly seat: number }
  /** Give up your seat before the battle. */
  | { readonly t: "stand" }
  /** Choose your Black Mass; the battle starts when both seats have one. */
  | { readonly t: "list"; readonly list: SideSetup }
  /** Play a command as your side. */
  | { readonly t: "cmd"; readonly cmd: Command }
  /** Take back your last command, if it rolled no dice and asked no one anything. */
  | { readonly t: "undo" }
  /** After the battle, clear it and both lists to play again. */
  | { readonly t: "rematch" };

export interface SeatView {
  readonly name: string;
  readonly ready: boolean;
  readonly online: boolean;
}

export type ServerMsg =
  | { readonly t: "state"; readonly seats: readonly (SeatView | null)[]; readonly game: Game | null; readonly you: number | null; readonly undo: boolean }
  | { readonly t: "error"; readonly message: string };

export const emptyRoom = (): Room => ({ seats: [null, null], game: null });

/** The seat a player holds, or null. */
export function seatOf(room: Room, token: string): number | null {
  const i = room.seats.findIndex((s) => s?.token === token);
  return i < 0 ? null : i;
}

/** The room after `who` sends `msg`; throws with a reason the player can read if it isn't allowed. */
export function handle(room: Room, who: Player, msg: ClientMsg, seed: () => number): Room {
  const mine = seatOf(room, who.token);
  switch (msg.t) {
    case "sit": {
      if (room.game) throw new Error("the battle has started");
      if (msg.seat !== 0 && msg.seat !== 1) throw new Error("no such seat");
      const taken = room.seats[msg.seat];
      if (taken && taken.token !== who.token) throw new Error(`${taken.name} is sitting there`);
      const seats = room.seats.map((s) => (s?.token === who.token ? null : s));
      seats[msg.seat] = { token: who.token, name: who.name, list: null };
      return { ...room, seats };
    }
    case "stand": {
      if (room.game) throw new Error("the battle has started");
      return { ...room, seats: room.seats.map((s) => (s?.token === who.token ? null : s)) };
    }
    case "list": {
      if (mine === null) throw new Error("take a seat first");
      if (room.game) throw new Error("the battle has started");
      const why = listError(msg.list);
      if (why) throw new Error(why);
      const seats = room.seats.map((s, i) => (i === mine && s ? { ...s, list: msg.list } : s));
      const lists = seats.map((s) => s?.list ?? null);
      if (lists.every((l): l is SideSetup => l !== null)) {
        return { seats, game: newGame({ board: emptyBoard(8), sides: lists, seed: seed() }), undo: null };
      }
      return { ...room, seats };
    }
    case "cmd": {
      if (mine === null) throw new Error("you are watching");
      if (!room.game) throw new Error("the battle hasn't started");
      if (msg.cmd.side !== mine) throw new Error("you can only command your own side");
      const game = apply(room.game, msg.cmd);
      return { ...room, game, undo: undoAfter(room, mine, room.game, game, msg.cmd) };
    }
    case "undo": {
      const u = room.undo;
      if (mine === null || !u || u.seat !== mine || !u.stack.length) throw new Error("nothing to take back");
      const stack = u.stack.slice(0, -1);
      return { ...room, game: u.stack[u.stack.length - 1]!, undo: stack.length ? { seat: mine, stack } : null };
    }
    case "rematch": {
      if (mine === null) throw new Error("you are watching");
      if (room.game?.phase !== "over") throw new Error("the battle isn't over");
      return { seats: room.seats.map((s) => s && { ...s, list: null }), game: null, undo: null };
    }
  }
}

const TAKEBACK: ReadonlySet<Command["kind"]> = new Set(["activate", "move", "reload", "revert"]);

/**
 * The take-backs after `seat` plays `cmd`: it can be taken back if it is a
 * kind without dice, rolled none, and left no choice waiting, so undoing it
 * reveals nothing. Anything else clears them.
 */
function undoAfter(room: Room, seat: number, before: Game, after: Game, cmd: Command): Room["undo"] {
  if (!TAKEBACK.has(cmd.kind) || after.seed !== before.seed || after.pending || after.phase !== "battle") return null;
  const prior = room.undo?.seat === seat ? room.undo.stack : [];
  return { seat, stack: [...prior, before] };
}

/** What a player sees: names, who is ready and online, and the battle. */
export function view(room: Room, online: ReadonlySet<string>, token: string): ServerMsg {
  return {
    t: "state",
    seats: room.seats.map((s) => s && { name: s.name, ready: s.list !== null, online: online.has(s.token) }),
    game: room.game,
    you: seatOf(room, token),
    undo: !!room.undo && room.undo.seat === seatOf(room, token) && room.undo.stack.length > 0,
  };
}
