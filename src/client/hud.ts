// The battle panel: whose turn it is, choices waiting on the player, unit
// cards with their actions, SOUL, and the battle log.

import { defOf } from "../rules/content";
import type { Ability } from "../rules/content";
import { actsOf } from "../rules/engine";
import type { Game } from "../rules/state";
import type { Unit } from "../rules/types";
import { el } from "./lobby";

export interface Seats {
  readonly names: readonly string[];
  readonly you: number | null;
}

/** The status line: whose turn, and what is waiting. */
export function status(g: Game, s: Seats): string {
  const name = (side: number) => (side === s.you ? "You" : s.names[side] ?? `Side ${side + 1}`);
  if (g.phase === "over") return g.winner === "draw" ? "The battle is a draw." : `${name(g.winner as number)} won.`;
  if (g.pending) {
    const r = g.pending.request;
    return r.side === s.you ? r.prompt : `Waiting for ${name(r.side)}: ${r.prompt}`;
  }
  if (g.phase === "deploy") return g.side === s.you ? "Deploy a unit: pick one from your reserve." : `${name(g.side)} is deploying.`;
  if (g.side !== s.you) return `${name(g.side)}'s turn.`;
  return g.active.length ? "Your unit's turn: MOVE, ACT, then end the turn." : "Your turn: pick a unit to activate.";
}

const TOKEN_ORDER = ["strength", "weak", "vitality", "vulnerable", "speed", "slow", "berserk"] as const;

/** A unit's card: stats, tokens, traits, and its ACT abilities. */
export function unitCard(g: Game, u: Unit, actions: HTMLElement | null): HTMLElement {
  const d = defOf(u.kind);
  const toks = TOKEN_ORDER.filter((t) => (u.tokens[t] ?? 0) > 0).map((t) => `${t} ${u.tokens[t]}`);
  const lasting = [...new Set(g.lasting.filter((l) => l.on === u.id).map((l) => l.name))];
  const traits = [...d.traits, ...(d.picks?.traits ?? []).filter((t) => u.picks?.includes(t.id))];
  return el("div", { className: `card side${u.side}` },
    el("div", { className: "card-head" },
      el("img", { src: `/art/portraits/${u.kind}.png`, alt: "" }),
      el("div", {},
        el("strong", { textContent: d.name }),
        el("div", { className: "hint", textContent: `${d.type} · ${u.raging ? "BLOOD RAGE" : `${u.hp}/${d.hp} hp`} · MV ${d.mv} · DF ${d.df}+ · ${d.armor === "none" ? "no armor" : d.armor}${u.unloaded ? " · unloaded" : ""}` }),
        toks.length ? el("div", { className: "tokens", textContent: toks.join(" · ") }) : "",
        lasting.length ? el("div", { className: "hint", textContent: lasting.join(", ") }) : "",
      ),
    ),
    ...traits.map((t) => el("div", { className: "trait" }, el("strong", { textContent: `${t.name}. ` }), t.text)),
    actions ?? el("div", {}, ...actsOf(u).map((a) => abilityLine(a))),
  );
}

export function abilityLine(a: Ability): HTMLElement {
  return el("div", { className: "ability" }, el("strong", { textContent: a.name }), el("span", { className: "hint", textContent: ` ${a.tags}` }), el("div", { textContent: a.text }));
}

/** An ability as a button, disabled with the engine's reason if it can't be used. */
export function abilityButton(a: Ability, why: string | null, chosen: boolean, onclick: () => void): HTMLElement {
  return el("button", { className: `ability-btn${chosen ? " chosen" : ""}`, disabled: why !== null, title: why ?? a.text, onclick },
    el("strong", { textContent: a.name }), el("span", { className: "hint", textContent: ` ${a.tags}` }), el("div", { className: "small", textContent: why ?? a.text }));
}

export function logView(g: Game): HTMLElement {
  const box = el("div", { className: "log" }, ...g.log.slice(-60).map((e) => el("div", { className: e.text.startsWith("Round ") ? "round" : "", textContent: e.text })));
  requestAnimationFrame(() => (box.scrollTop = box.scrollHeight));
  return box;
}

let toastTimer = 0;
export function toast(text: string): void {
  const t = document.getElementById("toast")!;
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), 3500);
}
