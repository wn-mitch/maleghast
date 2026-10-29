// Before the battle: the title screen, and mustering a Black Mass laid out
// like the rulebook's own unit pages, with the necromancer's choices made in
// place on its card and units counted on theirs.

import { HOUSES } from "../content";
import { type UnitDef, defOf } from "../rules/content";
import { type SideSetup, listError } from "../rules/setup";
import type { ClientMsg, ServerMsg } from "../net/room";

type State = Extract<ServerMsg, { t: "state" }>;
type HouseId = keyof typeof HOUSES;

const NAME_KEY = "maleghast.name";
const LIST_KEY = "maleghast.list.";
const SLOTS = 5;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

function newCode(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from(crypto.getRandomValues(new Uint8Array(5)), (n) => letters[n % letters.length]).join("");
}

/** The title screen: play the computer, or join a friend's room by code. */
export function joinForm(join: (name: string, code: string) => void, solo: (name: string) => void): HTMLElement {
  const name = el("input", { placeholder: "Name", value: localStorage.getItem(NAME_KEY) ?? "", maxLength: 24 });
  const code = el("input", { placeholder: "Room", value: location.hash.slice(1).toUpperCase() || newCode(), maxLength: 12, className: "code" });
  const who = () => {
    const n = name.value.trim() || "Necromancer";
    localStorage.setItem(NAME_KEY, n);
    return n;
  };
  const go = () => {
    const c = code.value.trim().toUpperCase();
    if (/^[A-Z0-9]{4,12}$/.test(c)) join(who(), c);
  };
  code.onkeydown = (e) => e.key === "Enter" && go();
  return el("div", { className: "title" },
    el("h1", { textContent: "Maleghast" }),
    el("div", { className: "title-form" },
      name,
      el("button", { className: "big", textContent: "Play the computer", onclick: () => solo(who()) }),
      el("div", { className: "join-row" }, code, el("button", { textContent: "Join", onclick: go })),
    ),
  );
}

let draft: { house: HouseId; list: SideSetup } | null = null;
let sitting = false;

function saved(house: HouseId): SideSetup {
  try {
    const s = JSON.parse(localStorage.getItem(LIST_KEY + house) ?? "") as SideSetup;
    if (s.necromancer === HOUSES[house].necromancer.id) return s;
  } catch {
    // No list kept for this house yet.
  }
  const p = HOUSES[house].necromancer.picks!;
  return { necromancer: HOUSES[house].necromancer.id, picks: [p.traits[0]!.id, p.acts[0]!.id, p.souls[0]!.id], units: [] };
}

function keep(house: HouseId, list: SideSetup): void {
  draft = { house, list };
  localStorage.setItem(LIST_KEY + house, JSON.stringify(list));
}

/** The muster before the battle. Takes a free seat on arrival; the opponent's name sits in the footer. */
export function roomPanel(s: State, _title: string, send: (m: ClientMsg) => void): HTMLElement {
  if (s.you === null) {
    const free = s.seats.findIndex((x) => x === null);
    if (free >= 0 && !sitting) {
      sitting = true;
      send({ t: "sit", seat: free });
    }
    return el("div", { className: "title" }, el("h1", { textContent: "Maleghast" }), ...s.seats.map((x) => el("p", { className: "watcher", textContent: x?.name ?? "" })));
  }
  sitting = false;
  const ready = !!s.seats[s.you]?.ready;
  const foe = s.seats[1 - s.you];
  return muster(ready, foe?.name ?? null, (list) => send({ t: "list", list }));
}

/** What the muster is showing rules for, and which necromancer choice is open; kept across redraws. */
let inspected: string | null = null;
let choosing: 0 | 1 | 2 | null = null;

const FIGURE_HEIGHT: Record<string, number> = { thrall: 0.62, scion: 0.78, freak: 0.74, hunter: 0.8, horror: 0.84, tyrant: 1 };

function muster(ready: boolean, foe: string | null, submit: (list: SideSetup) => void): HTMLElement {
  draft ??= { house: "carcass", list: saved("carcass") };
  const { house, list } = draft;
  const root = el("div", { className: `muster house-${house}` });
  const redraw = () => root.replaceWith(muster(ready, foe, submit));
  const set = (next: SideSetup) => {
    keep(house, next);
    redraw();
  };

  const houses = el("nav", { className: "houses" }, ...(Object.keys(HOUSES) as HouseId[]).map((id) =>
    el("button", { className: `house house-${id}${id === house ? " on" : ""}`, textContent: HOUSES[id].name.replace(/\./g, ""), onclick: () => {
      draft = { house: id, list: saved(id) };
      inspected = null;
      choosing = null;
      redraw();
    } })));

  // Thralls fill half a slot each.
  let used = 0;
  for (const k of list.units) used += defOf(k).type === "thrall" ? 0.5 : 1;
  const why = listError(list);
  const meter = el("div", { className: `slots${used > SLOTS ? " over" : ""}`, title: why && list.units.length ? why : "" },
    ...Array.from({ length: Math.max(SLOTS, Math.ceil(used)) }, (_, i) => el("span", { className: used >= i + 1 ? "full" : used > i ? "half" : "" })));
  const go = el("button", { className: "ready", textContent: ready ? "Waiting" : "Ready", disabled: why !== null || ready, onclick: () => submit(list) });
  const top = el("header", { className: "muster-top" }, houses, el("div", { className: "muster-go" }, foe ? el("span", { className: "foe", textContent: foe }) : "", meter, go));

  // The warband: the necromancer, then every unit standing in a line. Clicking a figure sends it away.
  const necro = defOf(list.necromancer);
  const p = necro.picks!;
  const groups = [p.traits, p.acts, p.souls] as const;
  const chips = el("div", { className: "chips" }, ...groups.map((g, i) => {
    const chosen = g.find((o) => o.id === list.picks[i]);
    return el("button", { className: `chip${choosing === i ? " open" : ""}`, textContent: chosen?.name ?? "", onclick: () => {
      choosing = choosing === i ? null : (i as 0 | 1 | 2);
      redraw();
    }, onmouseenter: () => show(chosen ?? null) });
  }));
  const picker = choosing === null ? "" : el("div", { className: "picker" }, ...groups[choosing].map((o) =>
    el("button", { className: `pick${o.id === list.picks[choosing!] ? " on" : ""}`, onclick: () => {
      const picks = [...list.picks];
      picks[choosing!] = o.id;
      choosing = null;
      set({ ...list, picks });
    }, onmouseenter: () => show(o) }, el("strong", { textContent: o.name }), el("span", { textContent: o.text }))));
  const leader = el("div", { className: "leader", onmouseenter: () => inspect(necro.id) },
    el("img", { src: `/art/portraits/${necro.id}.png`, alt: necro.name }),
    el("h2", { textContent: necro.name }), chips, picker);

  const line = el("div", { className: "line" }, ...list.units.map((k, i) => {
    const d = defOf(k);
    const fig = el("button", { className: "figure", ariaLabel: `Remove ${d.name}`, onmouseenter: () => inspect(k), onclick: () => {
      const u = [...list.units];
      u.splice(i, 1);
      set({ ...list, units: u });
    } }, el("img", { src: `/art/units/${k}.png`, alt: d.name }));
    fig.style.setProperty("--h", String(FIGURE_HEIGHT[d.type] ?? 0.75));
    return fig;
  }));

  // The house's units to call up.
  const tray = el("div", { className: "tray" }, ...HOUSES[house].units.map((d) => {
    const n = list.units.filter((k) => k === d.id).length;
    return el("button", { className: `tile${n ? " in" : ""}`, onmouseenter: () => inspect(d.id), onclick: () => {
      inspected = d.id;
      set({ ...list, units: [...list.units, d.id] });
    } }, el("img", { src: `/art/portraits/${d.id}.png`, alt: "" }), el("span", { textContent: d.name }), n ? el("b", { textContent: String(n) }) : "");
  }));

  const info = el("aside", { className: "inspect" });
  const show = (x: { name: string; text: string } | null) => {
    info.replaceChildren(...(x ? [el("h3", { textContent: x.name }), el("p", { textContent: x.text })] : []));
  };
  const inspect = (kind: string) => {
    inspected = kind;
    info.replaceChildren(...unitInfo(defOf(kind)));
  };
  if (inspected) inspect(inspected);

  root.append(top, el("main", { className: "field" }, leader, line, info), tray);
  return root;
}

/** A unit's rules, briefly: its numbers, then each trait and ability in a line. */
function unitInfo(d: UnitDef): HTMLElement[] {
  const stat = (label: string, v: string) => el("div", { className: "stat" }, el("b", { textContent: v }), el("small", { textContent: label }));
  const rows: [string, string][] = [
    ...d.traits.map((t): [string, string] => [t.name, t.text]),
    ...d.acts.map((a): [string, string] => [a.name, `${a.tags}. ${a.text}`]),
    ...(d.souls ?? []).map((a): [string, string] => [a.name, `${a.tags}. ${a.text}`]),
  ];
  return [
    el("h3", { textContent: d.name }),
    el("div", { className: "stats" }, stat("MV", String(d.mv)), stat("HP", String(d.hp)), stat("DF", `${d.df}+`), stat("ARM", d.armor === "none" ? "-" : "ARM")),
    ...rows.map(([n, t]) => el("p", {}, el("strong", { textContent: `${n}. ` }), t)),
  ];
}
