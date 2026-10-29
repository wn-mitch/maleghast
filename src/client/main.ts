// The client: join a room, build a list, then play the battle on the board.
// The server's state is the truth; the client keeps only what the player is
// pointing at (the unit they're working with and the action they've chosen).

import "./style.css";
import { installContent } from "../content";
import { cellsOf } from "../rules/board";
import { unit } from "../rules/effects";
import { actsOf } from "../rules/engine";
import type { Command, Game } from "../rules/state";
import type { ClientMsg, ServerMsg } from "../net/room";
import { BoardView, type Pick } from "./board";
import { abilityButton, logView, status, toast, unitCard } from "./hud";
import { el, joinForm, roomPanel } from "./lobby";
import { Connection } from "./net";
import { type Option, actOptions, canBoost, chosen, deployOptions, isThrall, moveOptions, readyUnits, refusal, requestOptions, soulAbilities, soulOptions } from "./play";

installContent();

type State = Extract<ServerMsg, { t: "state" }>;
type Mode =
  | { readonly k: "none" }
  | { readonly k: "deploy"; readonly unit: string }
  | { readonly k: "pair"; readonly unit: string }
  | { readonly k: "act"; readonly unit: string; readonly ability: string }
  | { readonly k: "soul"; readonly ability: string };

const app = document.getElementById("app")!;
const stage = el("div", { id: "stage" });
const side = el("div", { id: "side" });
app.append(stage, side, el("div", { id: "toast" }));

let conn: Connection | null = null;
let code = "";
let state: State | null = null;
let mode: Mode = { k: "none" };
let focus: string | null = null;
let boost = false;
let activeKey = "";
let board: BoardView | null = null;

function send(m: ClientMsg): void {
  conn?.send(m);
}

function command(cmd: Command): void {
  mode = { k: "none" };
  send({ t: "cmd", cmd });
}

side.append(joinForm((name, c) => {
  code = c;
  location.hash = c;
  conn = new Connection(c, name, receive, (online) => !online && toast("Reconnecting…"));
  side.replaceChildren(el("p", { className: "hint", textContent: "Connecting…" }));
}));

function receive(m: ServerMsg): void {
  if (m.t === "error") {
    toast(m.message);
    return;
  }
  state = m;
  const g = m.game;
  // Drop a focus or mode the new state has made stale.
  if (g && focus && !unit(g, focus)) focus = null;
  // A new turn for the player's units brings the first of them into focus.
  const turnKey = g ? g.active.map((a) => a.id).join() : "";
  if (g && turnKey !== activeKey) {
    activeKey = turnKey;
    const mine = g.active.find((a) => unit(g, a.id)?.side === m.you);
    if (mine) focus = mine.id;
  }
  const was = mode;
  if (g && was.k === "deploy" && !g.reserve.some((r) => r.id === was.unit)) mode = { k: "none" };
  render();
}

/** The options the current mode offers, highlighted on the board. */
function options(g: Game, you: number): Option[] {
  const asked = requestOptions(g, you);
  if (g.pending) return asked;
  const m = mode;
  switch (m.k) {
    case "deploy": return deployOptions(g, you, m.unit);
    case "act": return actOptions(g, you, m.unit, m.ability);
    case "soul": return soulOptions(g, you, m.ability);
    case "pair": return readyUnits(g, you).filter((u) => u.id !== m.unit && isThrall(u)).map((u) => ({ cells: cellsOf(u), cmd: { kind: "activate", side: you, units: [m.unit, u.id] } }));
    case "none": return focus && g.active.some((a) => a.id === focus) ? moveOptions(g, you, focus, boost) : [];
  }
}

function render(): void {
  if (!state) return;
  const g = state.game;
  if (!g) {
    board = null;
    stage.replaceChildren();
    side.replaceChildren(roomPanel(state, code, send));
    return;
  }
  if (!board) {
    board = new BoardView(stage);
    board.onPick = pick;
  }
  board.show(g, state.you);
  board.select(focus);
  board.clearMarks();
  const you = state.you;
  if (you !== null) {
    const opts = options(g, you);
    const color = g.pending ? 0xffd166 : mode.k === "none" ? 0x4fb3bf : mode.k === "deploy" ? 0x9be564 : 0xe8622c;
    board.mark(opts.flatMap((o) => o.cells), color);
  }
  side.replaceChildren(...panel(g, you));
}

function panel(g: Game, you: number | null): HTMLElement[] {
  const names = state!.seats.map((s, i) => s?.name ?? `Side ${i + 1}`);
  const out: HTMLElement[] = [
    el("div", { className: "topline" },
      el("span", { textContent: `Room ${code}` }),
      el("span", { textContent: g.phase === "battle" ? `Round ${g.round}` : g.phase === "deploy" ? "Deployment" : "Over" }),
      ...names.map((n, i) => el("span", { className: `side${i}`, textContent: `${n}: ${g.soul[i] ?? 0} SOUL` }))),
    el("div", { className: "status", textContent: status(g, { names, you }) }),
  ];
  if (g.phase === "over" && you !== null) out.push(el("button", { className: "primary", textContent: "Rematch", onclick: () => send({ t: "rematch" }) }));
  const r = g.pending?.request;
  if (r && r.side === you) {
    const row = el("div", { className: "request" });
    if (r.kind === "yesno") row.append(el("button", { className: "primary", textContent: "Yes", onclick: () => command({ kind: "answer", side: you, answer: true }) }), el("button", { textContent: "No", onclick: () => command({ kind: "answer", side: you, answer: false }) }));
    else if (r.optional) row.append(el("button", { textContent: "Decline", onclick: () => command({ kind: "answer", side: you, answer: null }) }));
    out.push(row);
  }
  if (you !== null && g.phase === "deploy" && g.side === you && !g.pending) {
    out.push(el("div", { className: "reserve" }, ...g.reserve.filter((u) => u.side === you).map((u) =>
      el("button", { className: mode.k === "deploy" && mode.unit === u.id ? "chosen" : "", onclick: () => { mode = { k: "deploy", unit: u.id }; render(); } },
        el("img", { src: `/art/portraits/${u.kind}.png`, alt: "" }), el("span", { textContent: unitName(u.kind) })))));
  }
  if (you !== null && g.phase === "battle" && g.side === you && g.active.length && !g.pending) {
    const units = g.active.map((a) => unit(g, a.id)).filter((u) => u !== undefined);
    out.push(el("div", { className: "row" },
      ...units.map((u) => el("button", { className: focus === u.id ? "chosen" : "", textContent: unitName(u.kind), onclick: () => { focus = u.id; mode = { k: "none" }; render(); } })),
      el("button", { className: "primary", textContent: "End turn", onclick: () => command({ kind: "end", side: you }) })));
  }
  const f = focus ? unit(g, focus) : undefined;
  if (f) out.push(unitCard(g, f, you !== null ? actions(g, you, f.id) : null));
  if (you !== null && g.phase === "battle") out.push(soulPanel(g, you));
  out.push(logView(g));
  return out;
}

function unitName(kind: string): string {
  return kind.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

/** The buttons for a unit the player can act with: activate it, or use its turn. */
function actions(g: Game, you: number, id: string): HTMLElement | null {
  const u = unit(g, id)!;
  if (g.pending) return null;
  if (readyUnits(g, you).some((v) => v.id === id)) {
    const row = el("div", { className: "actions" }, el("button", { className: "primary", textContent: "Activate", onclick: () => command({ kind: "activate", side: you, units: [id] }) }));
    if (isThrall(u) && readyUnits(g, you).some((v) => v.id !== id && isThrall(v))) {
      row.append(el("button", { className: mode.k === "pair" ? "chosen" : "", textContent: "Activate with another thrall", onclick: () => { mode = { k: "pair", unit: id }; render(); } }));
    }
    return row;
  }
  if (!g.active.some((a) => a.id === id) || u.side !== you) return null;
  const box = el("div", { className: "actions" });
  for (const a of actsOf(u)) {
    const opts = actOptions(g, you, id, a.id);
    const why = opts.length ? null : refusal(g, { kind: "act", side: you, unit: id, ability: a.id, target: a.target.kind === "self" ? { kind: "self" } : { kind: "unit", id } }) ?? "no target in range";
    const picked = mode.k === "act" && mode.unit === id && mode.ability === a.id;
    box.append(abilityButton(a, why, picked, () => {
      if (a.target.kind === "self") return command(opts[0]!.cmd);
      mode = picked ? { k: "none" } : { k: "act", unit: id, ability: a.id };
      render();
    }));
  }
  const row = el("div", { className: "row" });
  for (const [label, cmd] of [["Reload", { kind: "reload", side: you, unit: id }], ["Revert", { kind: "revert", side: you, unit: id }]] as const) {
    if (refusal(g, cmd) === null) row.append(el("button", { textContent: label, title: "Sacrifices a MOVE", onclick: () => command(cmd) }));
  }
  if (canBoost(g, u)) row.append(el("label", {}, el("input", { type: "checkbox", checked: boost, onchange: (e: Event) => { boost = (e.target as HTMLInputElement).checked; render(); } }), " Berserk as speed"));
  if (row.childElementCount) box.append(row);
  return box;
}

function soulPanel(g: Game, you: number): HTMLElement {
  const box = el("div", { className: "souls" }, el("h3", { textContent: `SOUL abilities (${g.soul[you] ?? 0} SOUL)` }));
  for (const a of soulAbilities(g, you)) {
    const opts = g.pending ? [] : soulOptions(g, you, a.id);
    const picked = mode.k === "soul" && mode.ability === a.id;
    const why = opts.length ? null : `${a.soul!.cost} SOUL, ${a.soul!.when === "own" ? "necromancer's turn" : a.soul!.when === "allied" ? "your turns" : "any turn"}`;
    box.append(abilityButton(a, why, picked, () => {
      if (a.target.kind === "self") return command(opts[0]!.cmd);
      mode = picked ? { k: "none" } : { k: "soul", ability: a.id };
      render();
    }));
  }
  return box;
}

function pick(p: Pick): void {
  if (!state?.game) return;
  const g = state.game, you = state.you;
  const cells = p.kind === "cell" ? [p.cell] : (() => { const u = unit(g, p.id); return u ? cellsOf(u) : []; })();
  if (you !== null) {
    const opts = options(g, you);
    for (const c of cells) {
      const o = chosen(opts, c);
      if (o) return command(o.cmd);
    }
  }
  // Not an option: look at whatever unit is there instead.
  const there = p.kind === "unit" ? p.id : g.units.find((u) => cellsOf(u).some((c) => c.col === p.cell.col && c.row === p.cell.row))?.id;
  if (mode.k !== "none" && mode.k !== "deploy") mode = { k: "none" };
  focus = there ?? (g.active.find((a) => unit(g, a.id)?.side === you)?.id ?? null);
  boost = false;
  render();
}

// A handle for the browser tests: what's on offer, and clicking without aiming at the canvas.
Object.assign(window, {
  maleghast: {
    state: () => state,
    options: () => (state?.game && state.you !== null ? options(state.game, state.you).map((o) => o.cells) : []),
    pick,
  },
});
