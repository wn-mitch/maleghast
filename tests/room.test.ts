import { describe, expect, it } from "vitest";
import { installContent } from "../src/content";
import { type ClientMsg, type Player, type Room, emptyRoom, handle, view } from "../src/net/room";
import type { SideSetup } from "../src/rules/setup";

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

  it("clears the battle and both lists for a rematch, but only once it is over", () => {
    const r = started();
    expect(() => send(r, [ann, { t: "rematch" }])).toThrow("isn't over");
    const over: Room = { ...r, game: { ...r.game!, phase: "over" } };
    const again = send(over, [bo, { t: "rematch" }]);
    expect(again.game).toBeNull();
    expect(again.seats.map((s) => [s?.name, s?.list])).toEqual([["Ann", null], ["Bo", null]]);
  });
});
