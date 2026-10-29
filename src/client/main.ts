// The client: join a room, build a list, then play the battle on the board.
// The server's state is the truth; the client keeps only what the player is
// pointing at (the unit they're working with and the action they've chosen).

import "./style.css";
import { installContent } from "../content";
import { cellsOf } from "../rules/board";
import { unit } from "../rules/effects";
import { actsOf, apply } from "../rules/engine";
import type { Command, Game } from "../rules/state";
import type { ClientMsg, ServerMsg } from "../net/room";
import { BoardView, type Pick } from "./board";
import { abilityButton, logView, status, toast, unitCard } from "./hud";
import { el, joinForm, roomPanel } from "./lobby";
import { type Session, LocalSession } from "./local";
import { Connection, token } from "./net";
import { type Option, actOptions, canBoost, chosen, deployOptions, forecast, isThrall, moveOptions, readyUnits, refusal, requestOptions, soulAbilities, soulOptions } from "../rules/options";

installContent();

type State = Extract<ServerMsg, { t: "state" }>;
type Mode =
  | { readonly k: "none" }
  | { readonly k: "deploy"; readonly unit: string }
  | { readonly k: "pair"; readonly unit: string }
  | { readonly k: "act"; readonly unit: string; readonly ability: string }
  | { readonly k: "soul"; readonly ability: string };

const COLORS = { move: 0x4f9dff, target: 0xff5a36, armed: 0xffd23f, deploy: 0x9be564, asked: 0xffd166, pair: 0x8fe3ff };

const app = document.getElementById("app")!;
const stage = el("div", { id: "stage" });
const side = el("div", { id: "side" });
app.append(stage, side, el("div", { id: "toast" }));
app.classList.add("prebattle");

let session: Session | null = null;
let title = "";
let state: State | null = null;
let mode: Mode = { k: "none" };
/** The unit the player is looking at or working with. */
let focus: string | null = null;
/** A target picked for an ACT or SOUL ability, waiting for a second click to fire. */
let armed: Option | null = null;
let boost = false;
let activeKey = "";
let board: BoardView | null = null;
const forecastBox = el("div", { className: "forecast" });

function send(m: ClientMsg): void {
  session?.send(m);
}

/** Send `cmd`, activating the focused unit first if it hasn't started its turn. */
function issue(cmd: Command, pre: Command | null = null): void {
  mode = { k: "none" };
  armed = null;
  if (pre) send({ t: "cmd", cmd: pre });
  send({ t: "cmd", cmd });
}

side.append(joinForm((name, c) => {
  title = `Room ${c}`;
  location.hash = c;
  session = new Connection(c, name, receive, (online) => !online && toast("Reconnecting…"));
  side.replaceChildren();
}, (name) => {
  title = "Against the computer";
  session = new LocalSession({ token: token(), name }, receive);
}));

function receive(m: ServerMsg): void {
  if (m.t === "error") {
    console.warn("refused:", m.message);
    toast(m.message);
    return;
  }
  // An update that leaves the battle as it was (someone came or went) keeps the player's aim.
  const same = !!state?.game && !!m.game && JSON.stringify([state.game.log.length, state.game.seed, state.game.active, state.game.pending?.request, state.game.side]) === JSON.stringify([m.game.log.length, m.game.seed, m.game.active, m.game.pending?.request, m.game.side]);
  state = m;
  const g = m.game;
  if (g && focus && !unit(g, focus)) focus = null;
  // A new turn for the player's units brings the first of them into focus, and the camera to it.
  const turnKey = g ? g.active.map((a) => a.id).join() : "";
  if (g && turnKey !== activeKey) {
    activeKey = turnKey;
    const mine = g.active.map((a) => unit(g, a.id)).find((u) => u?.side === m.you);
    if (mine) {
      focus = mine.id;
      board?.focus(mine);
    }
  }
  const was = mode;
  if (g && was.k === "deploy" && !g.reserve.some((r) => r.id === was.unit)) mode = { k: "none" };
  if (!same) {
    armed = null;
    if (mode.k === "act" || mode.k === "soul") mode = { k: "none" };
  }
  render();
}

/**
 * The battle as the player will act in it: if they've picked a unit that
 * hasn't started its turn, the battle as it would be once it has, with the
 * activation to send first. Picking a unit and using it is one step.
 */
function working(): { g: Game; pre: Command | null } {
  const g = state!.game!, you = state!.you;
  if (you !== null && focus && mode.k !== "pair" && readyUnits(g, you).some((u) => u.id === focus)) {
    const pre: Command = { kind: "activate", side: you, units: [focus] };
    try {
      const next = apply(g, pre);
      if (!next.pending) return { g: next, pre };
    } catch {
      // Not startable after all; offer nothing for it.
    }
  }
  return { g, pre: null };
}

/** The player's unit taking its turn (or about to): the focused one if it's theirs, else their first active one. */
function actorId(g: Game, you: number | null): string | null {
  if (you === null) return null;
  const mine = (id: string) => g.active.some((a) => a.id === id) && unit(g, id)?.side === you;
  if (focus && mine(focus)) return focus;
  return g.active.find((a) => mine(a.id))?.id ?? null;
}

/** The options the current mode offers, highlighted on the board. */
function options(g: Game, you: number): Option[] {
  if (g.pending) return requestOptions(g, you);
  const m = mode;
  switch (m.k) {
    case "deploy": return deployOptions(g, you, m.unit);
    case "act": return actOptions(g, you, m.unit, m.ability);
    case "soul": return soulOptions(g, you, m.ability);
    case "pair": return readyUnits(g, you).filter((u) => u.id !== m.unit && isThrall(u)).map((u) => ({ cells: cellsOf(u), cmd: { kind: "activate", side: you, units: [m.unit, u.id] } }));
    case "none": {
      const id = actorId(g, you);
      return id ? moveOptions(g, you, id, boost) : [];
    }
  }
}

function colorFor(g: Game): number {
  if (g.pending) return COLORS.asked;
  return mode.k === "none" ? COLORS.move : mode.k === "deploy" ? COLORS.deploy : mode.k === "pair" ? COLORS.pair : COLORS.target;
}

function render(): void {
  if (!state) return;
  const real = state.game;
  if (!real) {
    board = null;
    stage.replaceChildren();
    app.classList.add("prebattle");
    side.replaceChildren(roomPanel(state, title, send));
    return;
  }
  if (!board) {
    board = new BoardView(stage);
    board.onPick = pick;
    board.onHover = hover;
    board.onCancel = cancel;
  }
  const { g } = working();
  board.show(real, state.you);
  board.select(actorId(g, state.you) ?? focus);
  board.clearMarks();
  board.path(null);
  const you = state.you;
  if (you !== null) {
    const opts = options(g, you);
    board.mark(opts.flatMap((o) => o.cells), colorFor(g), mode.k === "none" ? 0.28 : 0.4);
    if (armed) board.mark(armed.cells, COLORS.armed, 0.6);
  }
  app.classList.remove("prebattle");
  side.replaceChildren(...panel(real, g, you));
}

/** The option under a pick: the square, or any square of the unit picked. */
function optionAt(p: Pick, g: Game, opts: readonly Option[]): Option | undefined {
  const cells = p.kind === "cell" ? [p.cell] : (unit(g, p.id) ? cellsOf(unit(g, p.id)!) : []);
  for (const c of cells) {
    const o = chosen(opts, c);
    if (o) return o;
  }
  return undefined;
}

/** Hovering previews: a MOVE's path, or an attack's odds. */
function hover(p: Pick | null): void {
  if (!state?.game || !board) return;
  const you = state.you;
  const { g } = working();
  const o = p && you !== null ? optionAt(p, g, options(g, you)) : undefined;
  board.hover(p?.kind === "cell" ? p.cell : p ? unit(g, p.id) ?? null : null, o ? 0xffffff : 0x888888);
  board.path(o?.cmd.kind === "move" ? o.cmd.path : null);
  if (!armed) showForecast(g, o ?? null);
}

function showForecast(g: Game, o: Option | null): void {
  const f = o && (o.cmd.kind === "act" || o.cmd.kind === "soul") ? forecast(g, o.cmd) : null;
  const target = o?.cmd.kind === "act" || o?.cmd.kind === "soul" ? (o.cmd.target.kind === "unit" ? unit(g, o.cmd.target.id) : undefined) : undefined;
  forecastBox.replaceChildren(...(f ? [
    el("strong", { textContent: `${Math.round(f.chance * 100)}%` }),
    el("span", { textContent: `${f.dice <= 0 ? "0" : f.dice}D vs ${f.needs}+${target ? ` · ${unitName(target.kind)}` : ""}` }),
  ] : []));
}

function pick(p: Pick): void {
  if (!state?.game) return;
  const you = state.you;
  const { g, pre } = working();
  const opts = you !== null ? options(g, you) : [];
  const o = optionAt(p, g, opts);
  if (o) {
    // ACT and SOUL abilities aim first and fire on a second click; everything else is one click.
    if (o.cmd.kind === "act" || o.cmd.kind === "soul") {
      if (armed && JSON.stringify(armed.cmd) === JSON.stringify(o.cmd)) return issue(o.cmd, pre);
      armed = o;
      render();
      showForecast(g, o);
      return;
    }
    return issue(o.cmd, o.cmd.kind === "move" ? pre : null);
  }
  // Not an option: put down the ability in hand, or look at the unit there.
  if (mode.k === "act" || mode.k === "soul" || mode.k === "pair" || armed) return cancel();
  const there = p.kind === "unit" ? p.id : state.game.units.find((u) => cellsOf(u).some((c) => c.col === p.cell.col && c.row === p.cell.row))?.id;
  if (there) focus = there;
  boost = false;
  render();
}

/** Back out one step: the aimed target, then the ability in hand, then the picked unit. */
function cancel(): void {
  if (armed) armed = null;
  else if (mode.k !== "none") mode = { k: "none" };
  else if (focus && !state?.game?.active.some((a) => a.id === focus)) focus = null;
  showForecast(state!.game!, null);
  render();
}

window.addEventListener("keydown", (e) => {
  if (!state?.game || e.target instanceof HTMLInputElement) return;
  if (e.key === "Escape") cancel();
  else if (e.key === "Enter" && armed) issue(armed.cmd, working().pre);
  else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && state.undo) {
    e.preventDefault();
    send({ t: "undo" });
  } else if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey) {
    const b = side.querySelectorAll<HTMLButtonElement>(".ability-btn")[Number(e.key) - 1];
    if (b && !b.disabled) b.click();
  }
});

function panel(real: Game, g: Game, you: number | null): HTMLElement[] {
  const names = state!.seats.map((s, i) => s?.name ?? `Side ${i + 1}`);
  const out: HTMLElement[] = [
    el("div", { className: "topline" },
      el("span", { textContent: real.phase === "battle" ? `Round ${real.round}` : real.phase === "deploy" ? "Deployment" : "Over" }),
      ...names.map((n, i) => el("span", { className: i === you ? "mine" : "theirs", textContent: `${n} ${real.soul[i] ?? 0}` }))),
    el("div", { className: "status", textContent: status(real, { names, you }) }),
  ];
  if (real.phase === "over" && you !== null) out.push(el("button", { className: "primary", textContent: "Rematch", onclick: () => send({ t: "rematch" }) }));
  const r = real.pending?.request;
  if (r && r.side === you) {
    const row = el("div", { className: "request" });
    if (r.kind === "yesno") row.append(el("button", { className: "primary", textContent: "Yes", onclick: () => issue({ kind: "answer", side: you, answer: true }) }), el("button", { textContent: "No", onclick: () => issue({ kind: "answer", side: you, answer: false }) }));
    else if (r.optional) row.append(el("button", { textContent: "Decline", onclick: () => issue({ kind: "answer", side: you, answer: null }) }));
    out.push(row);
  }
  if (you !== null && real.phase === "deploy" && real.side === you && !real.pending) {
    out.push(el("div", { className: "reserve" }, ...real.reserve.filter((u) => u.side === you).map((u) =>
      el("button", { className: mode.k === "deploy" && mode.unit === u.id ? "chosen" : "", onclick: () => { mode = { k: "deploy", unit: u.id }; render(); } },
        el("img", { src: `/art/portraits/${u.kind}.png`, alt: "" }), el("span", { textContent: unitName(u.kind) })))));
  }
  const { pre } = working();
  const acting = actorId(g, you);
  if (you !== null && real.phase === "battle" && real.side === you && !real.pending && (acting || state!.undo)) {
    out.push(el("div", { className: "row turn" },
      el("button", { textContent: "Undo", disabled: !state!.undo, title: "Ctrl+Z", onclick: () => send({ t: "undo" }) }),
      acting ? el("button", { className: "primary", textContent: "End turn", onclick: () => issue({ kind: "end", side: you }, pre) }) : ""));
  }
  const actor = acting ? unit(g, acting) : undefined;
  if (actor && you !== null) out.push(unitCard(g, actor, actions(g, you, actor.id)));
  const f = focus && focus !== acting ? unit(g, focus) : undefined;
  if (f) out.push(unitCard(g, f, null));
  if (mode.k === "act" || mode.k === "soul") {
    out.push(forecastBox);
    if (armed) out.push(el("button", { className: "primary fire", textContent: "Fire", title: "Enter, or click the target again", onclick: () => issue(armed!.cmd, working().pre) }));
  }
  if (you !== null && real.phase === "battle") out.push(soulPanel(g, you));
  out.push(logView(real));
  return out;
}

function unitName(kind: string): string {
  return kind.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

/** The buttons for a unit the player can act with: its abilities, and pairing a thrall. */
function actions(g: Game, you: number, id: string): HTMLElement | null {
  const u = unit(g, id)!;
  if (g.pending || u.side !== you || !g.active.some((a) => a.id === id)) return null;
  const { pre } = working();
  const box = el("div", { className: "actions" });
  for (const a of actsOf(u)) {
    const opts = actOptions(g, you, id, a.id);
    const why = opts.length ? null : refusal(g, { kind: "act", side: you, unit: id, ability: a.id, target: a.target.kind === "self" ? { kind: "self" } : { kind: "unit", id } }) ?? "no target in range";
    const picked = mode.k === "act" && mode.unit === id && mode.ability === a.id;
    box.append(abilityButton(a, why, picked, () => {
      armed = null;
      if (a.target.kind === "self") {
        // A self ability has one target; aim it at once and fire on a second press.
        mode = { k: "act", unit: id, ability: a.id };
        armed = opts[0] ?? null;
        render();
        if (armed) showForecast(g, armed);
        return;
      }
      mode = picked ? { k: "none" } : { k: "act", unit: id, ability: a.id };
      render();
    }));
  }
  const row = el("div", { className: "row" });
  for (const [label, cmd] of [["Reload", { kind: "reload", side: you, unit: id }], ["Revert", { kind: "revert", side: you, unit: id }]] as const) {
    if (refusal(g, cmd) === null) row.append(el("button", { textContent: label, title: "Sacrifices a MOVE", onclick: () => issue(cmd, pre) }));
  }
  if (pre && isThrall(u) && readyUnits(state!.game!, you).some((v) => v.id !== id && isThrall(v))) {
    row.append(el("button", { className: mode.k === "pair" ? "chosen" : "", textContent: "With a thrall", onclick: () => { mode = { k: "pair", unit: id }; render(); } }));
  }
  if (canBoost(g, u)) row.append(el("label", {}, el("input", { type: "checkbox", checked: boost, onchange: (e: Event) => { boost = (e.target as HTMLInputElement).checked; render(); } }), " Berserk as speed"));
  if (row.childElementCount) box.append(row);
  return box;
}

function soulPanel(g: Game, you: number): HTMLElement {
  const box = el("div", { className: "souls" }, el("h3", { textContent: `SOUL ${g.soul[you] ?? 0}` }));
  for (const a of soulAbilities(g, you)) {
    const opts = g.pending ? [] : soulOptions(g, you, a.id);
    const picked = mode.k === "soul" && mode.ability === a.id;
    const why = opts.length ? null : `${a.soul!.cost} SOUL, ${a.soul!.when === "own" ? "necromancer's turn" : a.soul!.when === "allied" ? "your turns" : "any turn"}`;
    box.append(abilityButton(a, why, picked, () => {
      armed = null;
      if (a.target.kind === "self") {
        mode = { k: "soul", ability: a.id };
        armed = opts[0] ?? null;
      } else mode = picked ? { k: "none" } : { k: "soul", ability: a.id };
      render();
    }));
  }
  return box;
}

// A handle for the browser tests: what's on offer, and clicking without aiming at the canvas.
Object.assign(window, {
  maleghast: {
    state: () => state,
    options: () => (state?.game && state.you !== null ? options(working().g, state.you).map((o) => o.cells) : []),
    pick,
    hover,
  },
});
