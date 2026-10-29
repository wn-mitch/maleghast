// A computer opponent. It plans a unit's turn by trying its MOVEs, ACT
// abilities and SOUL abilities on copies of the game, up to two steps
// ahead, and scoring where each leaves the battle. Dice in those trials
// come from its own random seeds, never the game's, so it plays the odds
// rather than reading the rolls to come.

import { cellsOf, gap } from "../rules/board";
import { defOf } from "../rules/content";
import { unit } from "../rules/effects";
import { actsOf, apply, deployRows } from "../rules/engine";
import { actOptions, deployOptions, isThrall, moveOptions, readyUnits, refusal, soulAbilities, soulOptions } from "../rules/options";
import type { Answer, Command, Game, Request } from "../rules/state";
import type { Token, Unit } from "../rules/types";

export type Rng = () => number;

export interface Settings {
  /** Dice samples per random step. */
  readonly samples: number;
  /** First steps followed up with a second. */
  readonly beam: number;
}

export const DEFAULT: Settings = { samples: 3, beam: 6 };

const WIN = 1e6;

const TOKEN_WORTH: Record<Token, number> = { strength: 1, vitality: 1, speed: 0.5, weak: -1, vulnerable: -1.5, slow: -0.5, berserk: -0.3 };

/** The range band a unit attacks from: its widest attack's, or null if it has none. */
function band(u: Unit): { min: number; max: number } | null {
  let best: { min: number; max: number } | null = null;
  for (const a of actsOf(u)) {
    if (!a.attack || a.target.kind !== "unit") continue;
    if (!best || a.target.max > best.max) best = { min: a.target.min, max: a.target.max };
  }
  return best;
}

/** How much `u` is worth to its side where it stands. */
function unitScore(g: Game, u: Unit): number {
  const d = defOf(u.kind);
  const necro = d.type === "necromancer";
  const health = u.raging ? 0.15 : u.hp / d.hp;
  let s = (necro ? 30 : 4 + d.hp * 2 + (d.type === "tyrant" ? 4 : 0)) * (0.35 + 0.65 * health);
  // Each of a necromancer's hit points is a step toward losing the battle.
  if (necro) s += u.hp * 3;
  for (const [t, n] of Object.entries(u.tokens) as [Token, number][]) s += TOKEN_WORTH[t] * n;
  if (u.unloaded) s -= 0.8;
  const foes = g.units.filter((f) => f.side !== u.side);
  if (!foes.length) return s;
  const mine = cellsOf(u);
  const near = Math.min(...foes.map((f) => gap(mine, cellsOf(f))));
  if (necro) s += 0.4 * Math.min(near, 4);
  else {
    const b = band(u);
    if (b) s -= 0.6 * (near < b.min ? b.min - near : near > b.max ? near - b.max : 0);
  }
  // Foes that could reach it next turn.
  const threats = foes.filter((f) => {
    const b = band(f);
    return b && gap(mine, cellsOf(f)) <= defOf(f.kind).mv + b.max;
  }).length;
  s -= (necro ? 1.2 : 0.3) * threats;
  return s;
}

/** How good `g` is for `side`: won or lost outright, else units, SOUL and position. */
export function evaluate(g: Game, side: number): number {
  if (g.winner === side) return WIN;
  if (g.winner !== null && g.winner !== "draw") return -WIN;
  let s = 0;
  for (const u of g.units) s += (u.side === side ? 1 : -1) * unitScore(g, u);
  for (let i = 0; i < g.sides; i++) s += (i === side ? 1.5 : -1.5) * (g.soul[i] ?? 0);
  return s;
}

/** A copy without the log, which no rule reads and which slows every trial. */
function bare(g: Game): Game {
  return { ...g, log: [], pending: g.pending && { ...g.pending, before: { ...g.pending.before, log: [] } } };
}

function defaultAnswer(r: Request): Answer {
  return r.kind === "yesno" ? true : 0;
}

/** `cmd` played on a copy with dice from `seed`, any choices that follow answered by default; null if illegal. */
function trial(g: Game, cmd: Command, seed: number): Game | null {
  try {
    let s = apply({ ...g, seed }, cmd);
    for (let i = 0; s.pending && i < 20; i++) s = apply(s, { kind: "answer", side: s.pending.request.side, answer: defaultAnswer(s.pending.request) });
    return s.pending ? null : s;
  } catch {
    return null;
  }
}

const random = (cmd: Command) => cmd.kind === "act" || cmd.kind === "soul" || cmd.kind === "answer";

/** The mean score of `cmd` over the seeds (one seed for a step without dice), and the first outcome. */
function score(g: Game, cmd: Command, side: number, seeds: readonly number[]): { value: number; next: Game } | null {
  let total = 0, n = 0, next: Game | null = null;
  for (const seed of random(cmd) ? seeds : seeds.slice(0, 1)) {
    const t = trial(g, cmd, seed);
    if (!t) return null;
    next ??= t;
    total += evaluate(t, side);
    n++;
  }
  return next && { value: total / n, next };
}

/** Everything the active units of `side` could do next. */
function steps(g: Game, side: number): Command[] {
  if (g.phase !== "battle" || g.side !== side || g.pending) return [];
  const out: Command[] = [];
  for (const a of g.active) {
    const u = unit(g, a.id);
    if (!u || u.side !== side) continue;
    out.push(...moveOptions(g, side, u.id, false).map((o) => o.cmd));
    for (const ab of actsOf(u)) out.push(...actOptions(g, side, u.id, ab.id).map((o) => o.cmd));
    for (const cmd of [{ kind: "reload", side, unit: u.id }, { kind: "revert", side, unit: u.id }] as const) if (refusal(g, cmd) === null) out.push(cmd);
  }
  if (!g.soulUsed[side]) for (const ab of soulAbilities(g, side)) out.push(...soulOptions(g, side, ab.id).map((o) => o.cmd));
  return out;
}

/** The best next step for the units taking their turn, and the score it leads to; ending the turn if nothing beats standing still. */
function plan(g: Game, side: number, seeds: readonly number[], s: Settings): { cmd: Command; value: number } {
  let best: { cmd: Command; value: number } = { cmd: { kind: "end", side }, value: evaluate(g, side) };
  const first: { cmd: Command; value: number; next: Game; at: number }[] = [];
  for (const cmd of steps(g, side)) {
    const r = score(g, cmd, side, seeds);
    if (!r) continue;
    first.push({ cmd, value: r.value, next: r.next, at: evaluate(r.next, side) });
    if (r.value > best.value) best = { cmd, value: r.value };
  }
  first.sort((p, q) => q.value - p.value);
  // Every first step is followed up with the ACT and SOUL abilities it sets up; the
  // most promising also with a second MOVE or a reload.
  for (const [i, f] of first.entries()) {
    for (const cmd of steps(f.next, side)) {
      if (i >= s.beam && !random(cmd)) continue;
      const r = score(f.next, cmd, side, seeds);
      // What the second step adds, on top of the first step's average outcome.
      if (r && f.value + (r.value - f.at) > best.value) best = { cmd: f.cmd, value: f.value + (r.value - f.at) };
    }
  }
  return best;
}

/** The activations `side` could start: each ready unit, and each ready thrall paired with another. */
function activations(g: Game, side: number): Command[] {
  const ready = readyUnits(g, side);
  const out: Command[] = ready.map((u) => ({ kind: "activate", side, units: [u.id] }));
  const thralls = ready.filter(isThrall);
  for (let i = 0; i < thralls.length; i++) for (let j = i + 1; j < thralls.length; j++) out.push({ kind: "activate", side, units: [thralls[i]!.id, thralls[j]!.id] });
  return out;
}

/** Where to deploy: melee units forward, the rest back, necromancers last. */
function deployment(g: Game, side: number, rng: Rng): Command | null {
  const reserve = g.reserve.filter((u) => u.side === side);
  const order = [...reserve].sort((a, b) => Number(defOf(a.kind).type === "necromancer") - Number(defOf(b.kind).type === "necromancer"));
  const u = order[0];
  if (!u) return null;
  const [lo, hi] = deployRows(g, side);
  const front = side === 0 ? lo : hi;
  const b = band(u);
  const forward = defOf(u.kind).type !== "necromancer" && (!b || b.max <= 1);
  let best: { cmd: Command; value: number } | null = null;
  for (const o of deployOptions(g, side, u.id)) {
    const c = o.cells[0]!;
    const centre = -Math.abs(c.col + (u.size - 1) / 2 - (g.board.size - 1) / 2) * 0.3;
    const value = (c.row === front) === forward ? 1 : 0;
    const v = value + centre + rng() * 0.5;
    if (!best || v > best.value) best = { cmd: o.cmd, value: v };
  }
  return best?.cmd ?? null;
}

/** The command `side` plays now, or null if it isn't theirs to play. */
export function decide(game: Game, side: number, rng: Rng, s: Settings = DEFAULT): Command | null {
  if (game.phase === "over") return null;
  const g = bare(game);
  const seeds = Array.from({ length: s.samples }, () => Math.floor(rng() * 2 ** 32));
  const r = g.pending?.request;
  if (r) {
    if (r.side !== side) return null;
    const answers: Answer[] = r.kind === "yesno" ? [true, false] : r.options.map((_, i) => i);
    if (r.kind !== "yesno" && r.optional) answers.push(null);
    let best: { cmd: Command; value: number } | null = null;
    for (const answer of answers) {
      const cmd: Command = { kind: "answer", side, answer };
      const v = score(g, cmd, side, seeds);
      if (v && (!best || v.value > best.value)) best = { cmd, value: v.value };
    }
    return best?.cmd ?? { kind: "answer", side, answer: defaultAnswer(r) };
  }
  if (g.side !== side) return null;
  if (g.phase === "deploy") return deployment(g, side, rng);
  if (g.active.length) return plan(g, side, seeds, s).cmd;
  // Pick the activation whose best plan leaves the battle in the best shape.
  let best: { cmd: Command; value: number } | null = null;
  for (const cmd of activations(g, side)) {
    const next = trial(g, cmd, seeds[0]!);
    if (!next) continue;
    const v = next.active.length ? plan(next, side, seeds, { ...s, beam: Math.min(s.beam, 3) }).value : evaluate(next, side);
    if (!best || v > best.value) best = { cmd, value: v };
  }
  return best?.cmd ?? null;
}
