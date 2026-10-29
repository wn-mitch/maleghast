import { describe, expect, it } from "vitest";
import { installContent } from "../src/content";
import { type ClientMsg, type Player, type Room, emptyRoom, handle, view } from "../src/net/room";
import type { SideSetup } from "../src/rules/setup";
import { at, battle, the, turn } from "./play";

installContent();

const ann: Player = { token: "ann-token", name: "Ann" };
const bo: Player = { token: "bo-token", name: "Bo" };
const cy: Player = { token: "cy-token", name: "Cy" };

const CARCASS: SideSetup = { necromancer: "operator", picks: ["boneWall", "grenadeJump", "doubleTap"], units: ["gunwight", "gunwight", "enforcer"] };
const GORE: SideSetup = { necromancer: "warlord", picks: ["nerveTwitch", "quench", "hellriderKick"], units: ["warhead", "carnifex"] };

function send(room: Room, ...steps: [Player, ClientMsg][]): Room {
  return steps.reduce((r, [who, msg]) => handle(r, who, msg, () => 7), room);
}

/** Both players seated with lists in: the battle has begun. */
function started(): Room {
  return send(emptyRoom(), [ann, { t: "sit", seat: 0 }], [bo, { t: "sit", seat: 1 }], [ann, { t: "list", list: CARCASS }], [bo, { t: "list", list: GORE }]);
}

describe("room", () => {
  it("seats players, lets one move seats, and won't let anyone take a held seat", () => {
    let r = send(emptyRoom(), [ann, { t: "sit", seat: 0 }]);
    expect(() => send(r, [bo, { t: "sit", seat: 0 }])).toThrow("Ann is sitting there");
    r = send(r, [ann, { t: "sit", seat: 1 }]);
    expect(r.seats.map((s) => s?.name ?? null)).toEqual([null, "Ann"]);
    r = send(r, [bo, { t: "sit", seat: 0 }], [ann, { t: "stand" }]);
    expect(r.seats.map((s) => s?.name ?? null)).toEqual(["Bo", null]);
  });

  it("refuses an illegal Black Mass, and starts the battle only once both lists are in", () => {
    let r = send(emptyRoom(), [ann, { t: "sit", seat: 0 }], [bo, { t: "sit", seat: 1 }]);
    expect(() => send(r, [ann, { t: "list", list: { ...CARCASS, units: ["warhead"] } }])).toThrow("serves another house");
    expect(() => send(r, [cy, { t: "list", list: CARCASS }])).toThrow("take a seat");
    r = send(r, [ann, { t: "list", list: CARCASS }]);
    expect(r.game).toBeNull();
    expect(view(r, new Set([ann.token]), bo.token)).toMatchObject({ seats: [{ name: "Ann", ready: true, online: true }, { name: "Bo", ready: false, online: false }], you: 1 });
    r = send(r, [bo, { t: "list", list: GORE }]);
    expect(r.game?.phase).toBe("deploy");
    expect(r.game?.reserve.filter((u) => u.side === 1).map((u) => u.kind).sort()).toEqual(["carnifex", "warhead", "warlord"]);
    expect(() => send(r, [cy, { t: "sit", seat: 0 }])).toThrow("battle has started");
  });

  it("only lets a player command their own side, and plays their commands", () => {
    const r = started();
    const g = r.game!;
    const side = g.side, player = side === 0 ? ann : bo, other = side === 0 ? bo : ann;
    const u = g.reserve.find((v) => v.side === side)!;
    const at = { col: 0, row: side === 0 ? 7 : 0 };
    const cmd = { kind: "deploy", side, unit: u.id, at } as const;
    expect(() => send(r, [other, { t: "cmd", cmd }])).toThrow("your own side");
    expect(() => send(r, [cy, { t: "cmd", cmd }])).toThrow("watching");
    const next = send(r, [player, { t: "cmd", cmd }]);
    expect(next.game!.units.find((v) => v.id === u.id)).toMatchObject(at);
    // The room before is untouched: rooms are values.
    expect(r.game!.units).toHaveLength(0);
  });

  it("takes back moves that rolled nothing, one at a time, and only for the player who made them", () => {
    let r = started();
    // Deploy everything; deployment is never taken back.
    while (r.game!.phase === "deploy") {
      const g = r.game!, side = g.side, u = g.reserve.find((v) => v.side === side)!;
      const rows = side === 0 ? [7, 6] : [0, 1];
      const at = rows.flatMap((row) => Array.from({ length: 8 }, (_, col) => ({ col, row }))).find((c) => !g.units.some((v) => v.col === c.col && v.row === c.row))!;
      r = send(r, [side === 0 ? ann : bo, { t: "cmd", cmd: { kind: "deploy", side, unit: u.id, at } }]);
    }
    expect(r.undo ?? null).toBeNull();
    const side = r.game!.side, me = side === 0 ? ann : bo, them = side === 0 ? bo : ann;
    const u = r.game!.units.find((v) => v.side === side && v.kind !== "operator" && v.kind !== "warlord")!;
    const start = r.game!;
    r = send(r, [me, { t: "cmd", cmd: { kind: "activate", side, units: [u.id] } }]);
    const activated = r.game!;
    const step = { col: u.col, row: side === 0 ? u.row - 1 : u.row + 1 };
    r = send(r, [me, { t: "cmd", cmd: { kind: "move", side, unit: u.id, path: [step] } }]);
    expect(view(r, new Set(), me.token)).toMatchObject({ undo: true });
    expect(view(r, new Set(), them.token)).toMatchObject({ undo: false });
    expect(() => send(r, [them, { t: "undo" }])).toThrow("nothing to take back");
    r = send(r, [me, { t: "undo" }]);
    expect(r.game).toEqual(activated);
    r = send(r, [me, { t: "undo" }]);
    expect(r.game).toEqual(start);
    expect(() => send(r, [me, { t: "undo" }])).toThrow("nothing to take back");
  });

  it("won't take back a command that rolled dice, nor anything before it", () => {
    const g = battle([{ kind: "gunwight", side: 0, at: at(3, 6) }, { kind: "carnifex", side: 1, at: at(3, 3) }]);
    const gun = the(g, "gunwight"), cx = the(g, "carnifex", 1);
    const t = turn(g, gun);
    const seats = [{ token: ann.token, name: ann.name, list: CARCASS }, { token: bo.token, name: bo.name, list: GORE }];
    const room: Room = { seats, game: t, undo: { seat: 0, stack: [g] } };
    const shot = send(room, [ann, { t: "cmd", cmd: { kind: "act", side: 0, unit: gun.id, ability: "ol45", target: { kind: "unit", id: cx.id } } }]);
    expect(shot.game!.seed).not.toBe(t.seed);
    expect(shot.undo).toBeNull();
    expect(() => send(shot, [ann, { t: "undo" }])).toThrow("nothing to take back");
  });

  it("clears the battle and both lists for a rematch, but only once it is over", () => {
    const r = started();
    expect(() => send(r, [ann, { t: "rematch" }])).toThrow("isn't over");
    const over: Room = { ...r, game: { ...r.game!, phase: "over" } };
    const again = send(over, [bo, { t: "rematch" }]);
    expect(again.game).toBeNull();
    expect(again.seats.map((s) => [s?.name, s?.list])).toEqual([["Ann", null], ["Bo", null]]);
  });
});
