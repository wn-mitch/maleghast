// The effects abilities are built from: tokens, damage, slaying, attack
// rolls, and forced movement (p14-p19, glossary p61-p62). Each that can
// stop for a choice is a generator; abilities run them with `yield*`.

import { cellsOf, elevated, footprint, gap, inBounds, inCover, index, isWall, terrainAt } from "./board";
import { type Ctx, type DamageType, type Gen, defOf, hooks } from "./content";
import { pool } from "./dice";
import type { Game } from "./state";
import { offer } from "./triggers";
import type { Cell, Token, Unit } from "./types";

const OPPOSITE: Partial<Record<Token, Token>> = {
  strength: "weak", weak: "strength", vitality: "vulnerable", vulnerable: "vitality", speed: "slow", slow: "speed",
};
/** Tokens that count as negative; berserk counts as both (p32). */
export const NEGATIVE: readonly Token[] = ["weak", "vulnerable", "slow", "berserk"];

export function log(g: Game, text: string, unit?: string, cells?: Cell[]): void {
  g.log.push({ kind: "note", text, ...(unit ? { unit } : {}), ...(cells ? { cells } : {}) });
}

export function unit(g: Game, id: string): Unit | undefined {
  return g.units.find((u) => u.id === id);
}

export function nameOf(u: Unit): string {
  return defOf(u.kind).name;
}

/** Whether `u` has a trait, from its card, its necromancer picks, or a lasting effect on it. */
export function hasTrait(g: Game, u: Unit, id: string): boolean {
  if (defOf(u.kind).traits.some((t) => t.id === id)) return true;
  if (u.picks?.includes(id)) return true;
  if (g.lasting.some((l) => l.on === u.id && l.name === id)) return true;
  return hooks.trait.some((h) => h(g, u, id));
}

export function tokens(u: Unit, t: Token): number {
  return u.tokens[t] ?? 0;
}

/** Give `u` `n` tokens of `t`; each first cancels one of its opposite (p18). */
export function give(g: Game, u: Unit, t: Token, n = 1): void {
  const opp = OPPOSITE[t];
  let left = n;
  while (left > 0 && opp && tokens(u, opp) > 0) {
    u.tokens[opp] = tokens(u, opp) - 1;
    left--;
  }
  if (left > 0) u.tokens[t] = tokens(u, t) + left;
  log(g, `${nameOf(u)} gains ${n} ${t}`, u.id);
}

/** Discard one `t` token, if it has one; whether it did. */
export function spend(u: Unit, t: Token): boolean {
  if (tokens(u, t) <= 0) return false;
  u.tokens[t] = tokens(u, t) - 1;
  return true;
}

/** Clear up to `max` negative tokens; how many it cleared. */
export function clearNegative(u: Unit, max = Infinity): number {
  let cleared = 0;
  for (const t of NEGATIVE) {
    while (cleared < max && spend(u, t)) cleared++;
  }
  return cleared;
}

export function isAlly(a: Unit, b: Unit): boolean {
  return a.side === b.side;
}

/** Units adjacent to any square of `cells`, diagonals included, other than those standing on them (splash, p17). */
export function around(g: Game, cells: readonly Cell[]): Unit[] {
  const own = new Set(cells.map((c) => `${c.col},${c.row}`));
  return g.units.filter((u) => !cellsOf(u).some((c) => own.has(`${c.col},${c.row}`)) && gap(cellsOf(u), cells) === 1);
}

export interface Hurt {
  readonly type?: DamageType;
  readonly ignoreArmor?: boolean;
  /** The damage can't take it below 1 hp. */
  readonly cannotSlay?: boolean;
  /** Not a blow from the ability's user: strength doesn't add, and it isn't struck back at. */
  readonly sourceless?: boolean;
}

const MAGICAL: readonly DamageType[] = ["fire", "toxic", "curse", "holy"];

/**
 * Deal `amount` damage to `target` (p17-p18): the user's strength adds 1
 * and weak takes 1, armor of the matching kind takes 1, vitality takes 1
 * and vulnerable adds 1, each token discarded as it counts. Devil damage
 * ignores all of that and obliterates. What it dealt.
 */
export function* damage(x: Ctx, target: Unit, amount: number, how: Hurt = {}): Gen<number> {
  const { g } = x;
  const type = how.type ?? "physical";
  if (target.hp <= 0 && !target.raging) return 0;
  if (type === "curse" && hasTrait(g, target, "curseproof")) {
    log(g, `${nameOf(target)} is curseproof`, target.id);
    return 0;
  }
  let n = amount;
  if (type !== "devil") {
    if (!how.sourceless) {
      if (spend(x.actor, "strength")) n += 1;
      if (spend(x.actor, "weak")) n -= 1;
    }
    const armor = armorOf(g, target);
    if (!how.ignoreArmor && (armor === "super" || (armor === "arm" && type === "physical") || (armor === "ward" && MAGICAL.includes(type)))) n -= 1;
    if (spend(target, "vitality")) n -= 1;
    if (spend(target, "vulnerable")) n += 1;
  }
  n = Math.max(0, n);
  if (n === 0) {
    log(g, `${nameOf(target)} takes no damage`, target.id);
    return 0;
  }
  x.damaged.add(target.id);
  if (!how.sourceless && x.actor.id !== target.id && hasTrait(g, target, "retaliation")) x.retaliation.push({ from: target.id, to: x.actor.id });
  if (target.raging) {
    log(g, `${nameOf(target)} takes ${n} ${type} damage at 0 hp`, target.id);
    yield* slay(x, target, false);
    if (!how.sourceless) yield* offer(x, "slay", target);
    return n;
  }
  const before = target.hp;
  target.hp -= n;
  if (how.cannotSlay && before >= 1) target.hp = Math.max(1, target.hp);
  log(g, `${nameOf(target)} takes ${n} ${type} damage (${Math.max(0, target.hp)} hp left)`, target.id);
  yield* steam(x, target);
  if (target.hp <= 0) {
    if (type !== "devil" && hasTrait(g, target, "bloodRage")) {
      target.hp = 0;
      target.raging = true;
      give(g, target, "strength");
      log(g, `${nameOf(target)} fights on in a blood rage`, target.id);
    } else {
      yield* slay(x, target, type === "devil");
      if (!how.sourceless) yield* offer(x, "slay", target);
    }
  } else if (target.hp === 1 && !how.sourceless) {
    yield* offer(x, "reducedToOne", target);
  }
  return n;
}

/** The Berserker's Steaming Rage: taking damage grants 1 berserk and 1 strength, once a round (p35). */
function* steam(x: Ctx, u: Unit): Gen {
  if (!hasTrait(x.g, u, "steamingRage") || u.marks?.steam === x.g.round) return;
  u.marks = { ...u.marks, steam: x.g.round };
  give(x.g, u, "berserk");
  give(x.g, u, "strength");
}

export function armorOf(g: Game, u: Unit): string {
  if (hasTrait(g, u, "superArmor")) return "super";
  return defOf(u.kind).armor;
}

/**
 * Remove a slain unit (p14): it leaves a corpse unless obliterated, and its
 * side harvests 1 SOUL the first time (p20). A slain necromancer loses the
 * battle for its side (p11).
 */
export function* slay(x: Ctx, u: Unit, obliterate: boolean): Gen {
  const { g } = x;
  if (!g.units.includes(u)) return;
  u.hp = 0;
  u.raging = false;
  g.units = g.units.filter((v) => v !== u);
  g.fallen.push(u);
  if (!obliterate) {
    g.board.corpses[index(g.board, { col: u.col, row: u.row })] = (g.board.corpses[index(g.board, { col: u.col, row: u.row })] ?? 0) + 1;
    if (!u.marks?.harvested) {
      u.marks = { ...u.marks, harvested: 1 };
      g.soul[u.side] = Math.min(6, (g.soul[u.side] ?? 0) + 1);
    }
  }
  log(g, `${nameOf(u)} is ${obliterate ? "obliterated" : "slain"}`, u.id);
  if (defOf(u.kind).type === "necromancer" && g.winner === null) {
    const rest = [...new Set(g.units.filter((v) => defOf(v.kind).type === "necromancer").map((v) => v.side))];
    if (rest.length === 1) {
      g.winner = rest[0]!;
      g.phase = "over";
      log(g, `Side ${rest[0]! + 1} wins: the enemy necromancer is slain`);
    }
  }
}

/** Damage to a wall: it falls at 0 hp. Walls take no other effects (p19). */
export function hurtWall(g: Game, c: Cell, n: number): void {
  const i = index(g.board, c);
  g.board.walls[i] = Math.max(0, (g.board.walls[i] ?? 0) - n);
  log(g, g.board.walls[i] === 0 ? "The wall falls" : `The wall takes ${n} damage`, undefined, [c]);
}

/** Whether `target` has cover against an attacker on `from`: from terrain, or from what rules let it use as cover (p16). */
export function covered(g: Game, target: Unit, from: readonly Cell[]): boolean {
  if (hasTrait(g, target, "coverAll")) return true;
  const extra = new Set(hooks.cover.flatMap((h) => h(g, target)).map((c) => index(g.board, c)));
  return inCover(g.board, cellsOf(target), from, extra);
}

export interface Roll {
  readonly hit: boolean;
  readonly headshot: boolean;
  readonly result: number;
}

/**
 * Roll an attack by `x.actor` at `target` (p15-p19): 1 die, +1 with
 * Formation beside an ally, -1 for a ranged attack at a unit in cover, +1
 * attacking down from elevation and -1 attacking up, then `extra`. At or
 * over the target's defense hits; a miss grazes for 1 damage of `type`.
 */
export function* attack(x: Ctx, target: Unit, type: DamageType = "physical", extra = 0): Gen<Roll> {
  const { g, actor } = x;
  const melee = x.ability?.melee === true;
  if (!melee && hasTrait(g, target, "bulletTime")) {
    log(g, `${nameOf(target)}'s bullet time turns the shot aside`, target.id);
    yield* damage(x, target, 1, { type });
    return { hit: false, headshot: false, result: 0 };
  }
  const from = cellsOf(actor), at = cellsOf(target);
  let dice = 1 + extra;
  if (hasTrait(g, actor, "formation") && g.units.some((u) => u !== actor && isAlly(u, actor) && gap(cellsOf(u), from) === 1)) dice += 1;
  if (!melee && covered(g, target, from)) dice -= 1;
  const up = elevated(g.board, from), down = elevated(g.board, at);
  if (up && !down) dice += 1;
  if (down && !up) dice -= 1;
  const r = pool(g.seed, dice);
  g.seed = r.seed;
  const df = hooks.df.reduce((d, h) => h(g, target, d), defOf(target.kind).df);
  const hit = r.result >= df;
  log(g, `${nameOf(actor)} rolls ${r.rolls.join(", ")} (${dice}D) against ${nameOf(target)}'s ${df}+: ${hit ? "hit" : "graze"}`, actor.id);
  if (!hit) yield* damage(x, target, 1, { type });
  const headshot = hit && r.result === 6;
  if (hit) yield* offer(x, "hit", target);
  if (headshot) yield* offer(x, "headshot", target);
  return { hit, headshot, result: r.result };
}

/** An effect die (p15): whether a d6 comes up `n` or more. */
export function effect(g: Game, n: number): boolean {
  const r = pool(g.seed, 1);
  g.seed = r.seed;
  log(g, `Effect die: ${r.result} (needs ${n}+)`);
  return r.result >= n;
}

function centre(cells: readonly Cell[]): { x: number; y: number } {
  const xs = cells.map((c) => c.col + 0.5), ys = cells.map((c) => c.row + 0.5);
  return { x: xs.reduce((a, b) => a + b) / xs.length, y: ys.reduce((a, b) => a + b) / ys.length };
}

/** Whether `u` could be set down with its north-west square at `at`. */
function fits(g: Game, u: Unit, at: Cell): boolean {
  return footprint(at, u.size).every((c) => inBounds(g.board, c) && !isWall(g.board, c) && !g.units.some((v) => v !== u && cellsOf(v).some((w) => w.col === c.col && w.row === c.row)));
}

export type Blocked = "wall" | "unit" | "edge" | "elevation" | null;

export interface Forced {
  readonly moved: number;
  /** What stopped it short, if anything did. */
  readonly blocked: Blocked;
}

const NEIGHBOURS: readonly Cell[] = [-1, 0, 1].flatMap((dc) => [-1, 0, 1].map((dr) => ({ col: dc, row: dr }))).filter((d) => d.col !== 0 || d.row !== 0);

/**
 * Push (`away`) or pull `u` up to `n` spaces from or toward `source`
 * (p18, p62): each space must be further from (or closer to) it than the
 * last. It can't be forced up onto elevation (p19), through walls or into
 * other units; where more than one space would do, the acting side picks.
 */
export function* force(x: Ctx, u: Unit, n: number, source: readonly Cell[], away: boolean): Gen<Forced> {
  const { g } = x;
  if (hasTrait(g, u, "anchored")) {
    log(g, `${nameOf(u)} holds its ground`, u.id);
    return { moved: 0, blocked: null };
  }
  let moved = 0;
  for (; moved < n; moved++) {
    // "Further away" and "closer" count spaces as range does, diagonals as one (p16).
    const here = { col: u.col, row: u.row }, was = cellsOf(u), d0 = gap(was, source);
    const better = NEIGHBOURS.map((d) => ({ col: here.col + d.col, row: here.row + d.row }))
      .filter((c) => (away ? gap(footprint(c, u.size), source) > d0 : gap(footprint(c, u.size), source) < d0));
    const open = better.filter((c) => fits(g, u, c) && !(elevated(g.board, footprint(c, u.size)) && !elevated(g.board, was)));
    if (!open.length) return { moved, blocked: blockedBy(g, u, better, source, away) };
    let to = open[0]!;
    if (open.length > 1) {
      const pick = yield { kind: "cell", side: x.side, prompt: `${away ? "Push" : "Pull"} ${nameOf(u)} where?`, options: open, optional: false };
      to = open[typeof pick === "number" ? pick : 0] ?? to;
    }
    u.col = to.col;
    u.row = to.row;
    x.forced.add(u.id);
    log(g, `${nameOf(u)} is ${away ? "pushed" : "pulled"}`, u.id, [to]);
  }
  return { moved, blocked: null };
}

/** Why a forced move stopped: whatever lies on the straightest line it would have taken. */
function blockedBy(g: Game, u: Unit, better: readonly Cell[], source: readonly Cell[], away: boolean): Blocked {
  if (!better.length) return null;
  const s = centre(source), c = centre(cellsOf(u));
  const ideal = better.slice().sort((a, b) => {
    const score = (p: Cell) => { const q = centre(footprint(p, u.size)); return (away ? -1 : 1) * Math.hypot(q.x - s.x, q.y - s.y) + 0.01 * Math.hypot(q.x - c.x, q.y - c.y); };
    return score(a) - score(b);
  })[0]!;
  const cells = footprint(ideal, u.size);
  if (cells.some((p) => !inBounds(g.board, p))) return "edge";
  if (cells.some((p) => isWall(g.board, p))) return "wall";
  if (cells.some((p) => terrainAt(g.board, p).elevated) && !elevated(g.board, cellsOf(u))) return "elevation";
  return "unit";
}
