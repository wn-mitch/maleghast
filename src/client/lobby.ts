// Before the battle: joining a room by code, taking a seat, and choosing a
// Black Mass (necromancer picks and units) with the list checked as it's built.

import { HOUSES } from "../content";
import { defOf } from "../rules/content";
import { type SideSetup, listError } from "../rules/setup";
import type { ServerMsg } from "../net/room";
import type { ClientMsg } from "../net/room";

type State = Extract<ServerMsg, { t: "state" }>;
type HouseId = keyof typeof HOUSES;

const NAME_KEY = "maleghast.name";
const LIST_KEY = "maleghast.list.";

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

function newCode(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from(crypto.getRandomValues(new Uint8Array(5)), (n) => letters[n % letters.length]).join("");
}

/** The join form; calls `join` with a name and room code. */
export function joinForm(join: (name: string, code: string) => void): HTMLElement {
  const name = el("input", { placeholder: "Your name", value: localStorage.getItem(NAME_KEY) ?? "", maxLength: 24 });
  const code = el("input", { placeholder: "Room code", value: location.hash.slice(1).toUpperCase() || newCode(), maxLength: 12 });
  const go = el("button", { textContent: "Join" });
  const submit = () => {
    const n = name.value.trim(), c = code.value.trim().toUpperCase();
    if (!n || !/^[A-Z0-9]{4,12}$/.test(c)) return;
    localStorage.setItem(NAME_KEY, n);
    join(n, c);
  };
  go.onclick = submit;
  for (const i of [name, code]) i.onkeydown = (e) => e.key === "Enter" && submit();
  return el("div", { className: "panel join" }, el("h1", { textContent: "Maleghast" }), name, code, go,
    el("p", { className: "hint", textContent: "Share the room code with your opponent." }));
}

/** The room before the battle: seats, and the list builder once seated. */
export function roomPanel(s: State, code: string, send: (m: ClientMsg) => void): HTMLElement {
  const seats = s.seats.map((seat, i) => {
    const who = seat ? `${seat.name}${seat.online ? "" : " (away)"}${seat.ready ? " — ready" : ""}` : "empty";
    const row = el("div", { className: `seat side${i}` }, el("strong", { textContent: `Side ${i + 1}: ` }), who);
    if (!seat && s.you !== i) row.append(" ", el("button", { textContent: "Sit here", onclick: () => send({ t: "sit", seat: i }) }));
    if (s.you === i) row.append(" ", el("button", { textContent: "Stand", onclick: () => send({ t: "stand" }) }));
    return row;
  });
  const panel = el("div", { className: "panel room" }, el("h2", { textContent: `Room ${code}` }), ...seats);
  if (s.you !== null) panel.append(listBuilder(!!s.seats[s.you]?.ready, (list) => send({ t: "list", list })));
  else panel.append(el("p", { className: "hint", textContent: "Take a seat to play, or stay to watch." }));
  return panel;
}

function saved(house: HouseId): SideSetup {
  try {
    const s = JSON.parse(localStorage.getItem(LIST_KEY + house) ?? "") as SideSetup;
    if (s.necromancer === HOUSES[house].necromancer.id) return s;
  } catch {
    // No saved list for this house yet.
  }
  const p = HOUSES[house].necromancer.picks!;
  return { necromancer: HOUSES[house].necromancer.id, picks: [p.traits[0]!.id, p.acts[0]!.id, p.souls[0]!.id], units: [] };
}

function listBuilder(ready: boolean, submit: (list: SideSetup) => void): HTMLElement {
  const box = el("div", { className: "builder" });
  let house: HouseId = "carcass";
  let list = saved(house);
  const draw = () => {
    const necro = defOf(list.necromancer), p = necro.picks!;
    const houses = el("select", { onchange: () => { house = houses.value as HouseId; list = saved(house); draw(); } },
      ...Object.entries(HOUSES).map(([id, h]) => el("option", { value: id, textContent: h.name, selected: id === house })));
    const pick = (i: number, options: readonly { id: string; name: string }[], label: string) => {
      const sel = el("select", { onchange: () => { const picks = [...list.picks]; picks[i] = sel.value; list = { ...list, picks }; draw(); } },
        ...options.map((o) => el("option", { value: o.id, textContent: o.name, selected: list.picks[i] === o.id })));
      return el("label", {}, `${label} `, sel);
    };
    const units = HOUSES[house].units.map((d) => {
      const n = list.units.filter((k) => k === d.id).length;
      const add = el("button", { textContent: "+", onclick: () => { list = { ...list, units: [...list.units, d.id] }; draw(); } });
      const drop = el("button", { textContent: "−", disabled: n === 0, onclick: () => { const u = [...list.units]; u.splice(u.lastIndexOf(d.id), 1); list = { ...list, units: u }; draw(); } });
      return el("div", { className: "unit-row" }, drop, el("span", { className: "count", textContent: String(n) }), add,
        el("span", { textContent: ` ${d.name}` }), el("span", { className: "hint", textContent: ` ${d.type}, ${d.hp} hp` }));
    });
    const why = listError(list);
    const go = el("button", { className: "primary", textContent: ready ? "Update list" : "Ready", disabled: why !== null,
      onclick: () => { localStorage.setItem(LIST_KEY + house, JSON.stringify(list)); submit(list); } });
    box.replaceChildren(
      el("h3", { textContent: "Your Black Mass" }), houses,
      el("p", { className: "hint", textContent: `${necro.name} leads. Thralls take half a slot each; 5 slots.` }),
      pick(0, p.traits, "Trait"), pick(1, p.acts, "ACT"), pick(2, p.souls, "SOUL"),
      ...units,
      el("p", { className: why ? "error" : "hint", textContent: why ?? "Legal list." }), go,
    );
  };
  draw();
  return box;
}
