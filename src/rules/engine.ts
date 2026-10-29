// Applying commands to a game: deployment, turns and rounds (p11-p13), and
// the choices rules ask for along the way. A command runs as a generator;
// when it stops on a request, the game keeps the state before it and the
// answers so far, and each answer replays it from there. Dice are seeded
// by the game, so a replay rolls what the first run rolled.

import { cellsOf, footprint, gap, inBounds, isWall, sees, terrainAt } from "./board";
import { type Ability, type Ctx, type Gen, type UnitDef, defOf, hooks } from "./content";
import { around, damage, give, hasTrait, log, nameOf, spend, unit } from "./effects";
import { stepCost } from "./movement";
import { walk } from "./moves";
import type { Answer, Command, Game, Request, Target } from "./state";
import { offer, soulsOf, timely } from "./triggers";
import type { Cell, Unit } from "./types";

export class RuleError extends Error {}

function check(ok: unknown, why: string): asserts ok {
  if (!ok) throw new RuleError(why);
}

/** Apply `cmd` to `game`, returning the new game; throws RuleError if the rules forbid it. */
export function apply(game: Game, cmd: Command): Game {
  check(game.phase !== "over", "the battle is over");
  if (game.pending) {
    const p = game.pending;
    check(cmd.kind === "answer", "a choice is waiting");
    check(cmd.side === p.request.side, "the choice is the other side's");
    check(valid(p.request, cmd.answer), "not one of the options");
    return drive(p.before, p.command, [...p.answers, cmd.answer]);
  }
  check(cmd.kind !== "answer", "nothing to answer");
  return drive(game, cmd, []);
}

function valid(r: Request, a: Answer): boolean {
  if (r.kind === "yesno") return typeof a === "boolean";
  if (a === null) return r.optional;
  return typeof a === "number" && Number.isInteger(a) && a >= 0 && a < r.options.length;
}

function drive(before: Game, cmd: Command, answers: readonly Answer[]): Game {
  const g = structuredClone(before);
  g.pending = null;
  const it = run(g, cmd);
  let r = it.next();
  let i = 0;
  while (!r.done) {
    if (i >= answers.length) {
      g.pending = { before, command: cmd, answers, request: r.value };
      return g;
    }
    r = it.next(answers[i++]!);
  }
  return g;
}

function ctx(g: Game, actor: Unit, ability: Ability | null): Ctx {
  return { g, actor, side: actor.side, ability, damaged: new Set(), retaliation: [], forced: new Set() };
}

function* run(g: Game, cmd: Command): Gen {
  switch (cmd.kind) {
    case "deploy": return deploy(g, cmd.side, cmd.unit, cmd.at);
    case "activate": return yield* activate(g, cmd.side, cmd.units);
    case "move": return yield* move(g, cmd.side, cmd.unit, cmd.path, cmd.boost === true);
    case "reload": return reload(g, cmd.side, cmd.unit);
    case "revert": return revert(g, cmd.side, cmd.unit);
    case "act": return yield* act(g, cmd.side, cmd.unit, cmd.ability, cmd.target);
    case "soul": return yield* soul(g, cmd.side, cmd.ability, cmd.target);
    case "end": return yield* end(g, cmd.side);
    case "answer": throw new RuleError("nothing to answer");
  }
}

/** The rows a side deploys in: up to 2 spaces from its edge (p11). Side 0 holds the south edge, side 1 the north. */
export function deployRows(g: Game, side: number): [number, number] {
  return side === 0 ? [g.board.size - 2, g.board.size - 1] : [0, 1];
}

function deploy(g: Game, side: number, id: string, at: Cell): void {
  check(g.phase === "deploy", "deployment is over");
  check(side === g.side, "it is the other side's deployment");
  const u = g.reserve.find((r) => r.id === id && r.side === side);
  check(u, "no such unit to deploy");
  const [lo, hi] = deployRows(g, side);
  const cells = footprint(at, u.size);
  check(cells.every((c) => inBounds(g.board, c) && c.row >= lo && c.row <= hi), "outside the deployment zone");
  check(cells.every((c) => !isWall(g.board, c) && !g.units.some((v) => cellsOf(v).some((w) => w.col === c.col && w.row === c.row))), "the space is taken");
  u.col = at.col;
  u.row = at.row;
  g.reserve = g.reserve.filter((r) => r !== u);
  g.units.push(u);
  log(g, `${nameOf(u)} deploys`, u.id, [at]);
  if (g.reserve.some((r) => r.side === side)) return;
  const next = g.reserve.find((r) => r.side !== side);
  if (next) {
    g.side = next.side;
    return;
  }
  g.phase = "battle";
  g.round = 1;
  g.side = g.first;
  log(g, "Round 1");
}

function ready(g: Game, side: number): Unit[] {
  return g.units.filter((u) => u.side === side && !u.done);
}

function* activate(g: Game, side: number, ids: readonly string[]): Gen {
  check(g.phase === "battle", "the battle hasn't started");
  check(side === g.side, "it is the other side's turn");
  check(g.active.length === 0, "units are already taking their turn");
  const us = ids.map((id) => unit(g, id));
  check(us.length >= 1 && us.length <= 2 && new Set(ids).size === ids.length, "activate one unit, or two thralls");
  for (const u of us) check(u && u.side === side && !u.done, "that unit can't take a turn");
  if (us.length === 2) check(us.every((u) => defOf(u!.kind).type === "thrall"), "only thralls activate two at a time");
  g.active = us.map((u) => ({ id: u!.id, moves: 0, acted: false }));
  g.activations++;
  g.soulUsed = g.soulUsed.map(() => false);
  for (const u of us) yield* startTurn(g, u!);
}

/** A unit's turn begins: lasting effects end, hazards bite, start-of-turn traits fire (p18-p19). */
function* startTurn(g: Game, u: Unit): Gen {
  const n = (g.turns[u.id] ?? 0) + 1;
  g.turns[u.id] = n;
  g.lasting = g.lasting.filter((l) => !(l.owner === u.id && l.at === "start" && l.turn <= n));
  log(g, `${nameOf(u)}'s turn`, u.id);
  if (cellsOf(u).some((c) => terrainAt(g.board, c).hazard)) yield* damage(ctx(g, u, null), u, 1, { ignoreArmor: true, sourceless: true });
  if (hasTrait(g, u, "fueledByRage")) give(g, u, "berserk");
}

function activeOf(g: Game, side: number, id: string): { id: string; moves: number; acted: boolean } {
  check(g.phase === "battle", "the battle hasn't started");
  check(side === g.side, "it is the other side's turn");
  const a = g.active.find((x) => x.id === id);
  check(a && unit(g, id), "that unit isn't taking its turn");
  return a;
}

/** A unit may MOVE then ACT, or forgo ACT to MOVE twice (p11, p13): two actions, at most one an ACT. */
function canMove(a: { moves: number; acted: boolean }): boolean {
  return a.moves + (a.acted ? 1 : 0) < 2;
}

/** The movement a MOVE has: MV, +2 with speed; a slowed unit goes one space (p18). */
export function moveBudget(g: Game, u: Unit): { budget: number; maxSpaces: number } {
  const free = hasTrait(g, u, "freeMovement");
  return { budget: defOf(u.kind).mv + (u.tokens.speed ? 2 : 0), maxSpaces: !free && u.tokens.slow ? 1 : Infinity };
}

function* move(g: Game, side: number, id: string, path: readonly Cell[], boost: boolean): Gen {
  const a = activeOf(g, side, id);
  check(canMove(a), "no MOVE left this turn");
  const u = unit(g, id)!;
  check(!hasTrait(g, u, "rooted"), `${nameOf(u)} can't MOVE`);
  check(path.length >= 1, "an empty path");
  check(!boost || (hasTrait(g, u, "fueledByRage") && (u.tokens.berserk ?? 0) > 0), "no berserk to spend as speed");
  const { budget: base, maxSpaces } = moveBudget(g, u);
  // Fueled by Rage spends a berserk token as a speed token (p35).
  const budget = boost && !u.tokens.speed ? base + 2 : base;
  check(path.length <= maxSpaces, "slowed: one space only");
  let at: Cell = { col: u.col, row: u.row }, cost = 0;
  for (const [i, c] of path.entries()) {
    check(Math.abs(c.col - at.col) + Math.abs(c.row - at.row) === 1, "moves go one orthogonal space at a time");
    check(footprint(c, u.size).every((p) => inBounds(g.board, p) && !isWall(g.board, p)), "a wall or the edge is in the way");
    const through = hasTrait(g, u, "passThrough");
    check(through || !footprint(c, u.size).some((p) => g.units.some((v) => v !== u && v.side !== u.side && cellsOf(v).some((w) => w.col === p.col && w.row === p.row))), "a foe is in the way");
    cost += stepCost(g.board, at, c, u.size);
    check(cost <= budget || (i === 0 && path.length === 1), "not enough movement");
    at = c;
  }
  check(!footprint(at, u.size).some((p) => g.units.some((v) => v !== u && cellsOf(v).some((w) => w.col === p.col && w.row === p.row))), "can't end on another unit");
  a.moves++;
  if (boost) spend(u, "berserk");
  spend(u, "speed");
  spend(u, "slow");
  yield* walk(ctx(g, u, null), u, path);
  if (unit(g, id)) yield* offer(ctx(g, u, null), "moved", u);
}

/** Sacrifice a MOVE to end a lasting stance such as Transform to Gun, losing what it gave (p28). */
function revert(g: Game, side: number, id: string): void {
  const a = activeOf(g, side, id);
  check(canMove(a), "no MOVE left to sacrifice");
  const u = unit(g, id)!;
  const stance = g.lasting.find((l) => l.on === u.id && l.name === "transformed");
  check(stance, `${nameOf(u)} has nothing to end`);
  a.moves++;
  g.lasting = g.lasting.filter((l) => !(l.on === u.id && l.owner === stance.owner && (l.name === "transformed" || l.name === "rooted")));
  u.tokens.strength = 0;
  log(g, `${nameOf(u)} unfolds`, u.id);
}

function reload(g: Game, side: number, id: string): void {
  const a = activeOf(g, side, id);
  check(canMove(a), "no MOVE left to sacrifice");
  const u = unit(g, id)!;
  check(u.unloaded || hooks.reloadable.some((h) => h(g, u)), `${nameOf(u)} has nothing to reload`);
  a.moves++;
  u.unloaded = false;
  for (const h of hooks.reload) h(g, u);
  log(g, `${nameOf(u)} reloads`, u.id);
  if (hasTrait(g, u, "hotClip")) give(g, u, "strength");
}

/** A unit's ACT abilities: its card's, and for a necromancer the one it picked. */
export function actsOf(u: Unit): Ability[] {
  const d: UnitDef = defOf(u.kind);
  return [...d.acts, ...(d.picks?.acts ?? []).filter((x) => u.picks?.includes(x.id))];
}

/** Whether `t` is a legal target for `a` used by `u`, and why not. */
export function targetError(g: Game, u: Unit, a: Ability, t: Target): string | null {
  const tg = a.target;
  if (tg.kind === "self") return t.kind === "self" ? null : "it targets its user";
  if (tg.kind === "direction") return t.kind === "direction" && Math.abs(t.d.col) + Math.abs(t.d.row) === 1 ? null : "pick a compass direction";
  if (tg.kind === "line") {
    if (t.kind !== "cell" || !inBounds(g.board, t.cell)) return "pick the line's first space";
    return cellsOf(u).some((c) => Math.abs(c.col - t.cell.col) + Math.abs(c.row - t.cell.row) === 1) && !cellsOf(u).some((c) => c.col === t.cell.col && c.row === t.cell.row) ? null : "a line starts beside its user";
  }
  const max = tg.max + hooks.range.reduce((s, h) => s + h(g, u, a), 0);
  const min = hooks.minRange.reduce((m, h) => h(g, u, a, m), tg.min);
  let cells: Cell[];
  if (t.kind === "unit") {
    const v = unit(g, t.id);
    if (!v) return "no such unit";
    if (tg.who === "foe" && v.side === u.side) return "it targets foes";
    if (tg.who === "ally" && v.side !== u.side) return "it targets allies";
    if (tg.who !== "any" && v.id === u.id) return "it can't target its user";
    cells = cellsOf(v);
  } else if (t.kind === "cell" && tg.walls && inBounds(g.board, t.cell) && isWall(g.board, t.cell)) {
    cells = [t.cell];
  } else return "pick a unit";
  const d = gap(cellsOf(u), cells);
  if (d < min || d > max) return `out of range (${min}-${max})`;
  if (d > 0 && !sees(g.board, cellsOf(u), cells)) return "no line of sight";
  return null;
}

function* act(g: Game, side: number, id: string, abilityId: string, t: Target): Gen {
  const a = activeOf(g, side, id);
  check(!a.acted && canMove(a), "no ACT left this turn");
  const u = unit(g, id)!;
  const ab = actsOf(u).find((x) => x.id === abilityId);
  check(ab, "no such ability");
  check(!(ab.reload && u.unloaded), `${nameOf(u)} must reload first`);
  const why = targetError(g, u, ab, t);
  check(why === null, why ?? "");
  check(!ab.usable || ab.usable(g, u), `${ab.name} isn't ready`);
  a.acted = true;
  // A reload ability is spent as it fires, so its own effects can reload it (Clutch Reload, p30).
  if (ab.reload) u.unloaded = true;
  log(g, `${nameOf(u)} uses ${ab.name}`, u.id);
  const x = ctx(g, u, ab);
  yield* ab.resolve(x, t);
  yield* afterAct(x);
}

/** Once an ability resolves: berserk bites (p32), retaliation strikes back (p32), and ACT triggers fire. */
function* afterAct(x: Ctx): Gen {
  const { g, actor } = x;
  if (unit(g, actor.id) && spend(actor, "berserk")) {
    let hit = false;
    for (const v of around(g, cellsOf(actor))) if ((yield* damage(x, v, 1, { sourceless: true })) > 0) hit = true;
    if (!hit && unit(g, actor.id)) yield* damage(x, actor, 1, { ignoreArmor: true, sourceless: true });
  }
  for (const r of x.retaliation) {
    const from = g.units.concat(g.fallen).find((v) => v.id === r.from), to = unit(g, r.to);
    if (from && to) yield* damage({ ...x, actor: from, side: from.side, retaliation: [] }, to, 1, { sourceless: true });
  }
  for (const h of hooks.after) yield* h(x);
  if (unit(g, actor.id) && x.ability && !x.ability.soul) yield* offer(x, "acted", actor);
}

function* soul(g: Game, side: number, abilityId: string, t: Target): Gen {
  check(g.phase === "battle", "the battle hasn't started");
  const necro = g.units.find((u) => u.side === side && defOf(u.kind).type === "necromancer");
  check(necro, "no necromancer");
  const ab = soulsOf(necro).find((x) => x.id === abilityId);
  check(ab?.soul, "no such SOUL ability");
  check(!ab.soul.trigger, "that ability waits for its trigger");
  check(!g.soulUsed[side], "one SOUL ability per unit turn");
  check(ab.soul.cost <= (g.soul[side] ?? 0), "not enough SOUL");
  check(timely(g, side, ab), "not now");
  const why = targetError(g, necro, ab, t);
  check(why === null, why ?? "");
  g.soul[side] = (g.soul[side] ?? 0) - ab.soul.cost;
  g.soulUsed[side] = true;
  log(g, `Side ${side + 1} spends ${ab.soul.cost} SOUL on ${ab.name}`, necro.id);
  yield* ab.resolve({ g, actor: necro, side, ability: ab, damaged: new Set(), retaliation: [], forced: new Set() }, t);
}

/** End the active units' turn; the other side acts next if it can, and a round ends when no one can (p11). */
function* end(g: Game, side: number): Gen {
  check(g.phase === "battle", "the battle hasn't started");
  check(side === g.side, "it is the other side's turn");
  check(g.active.length > 0, "no unit is taking its turn");
  for (const a of g.active) {
    const u = unit(g, a.id);
    if (!u) continue;
    u.done = true;
    for (const h of hooks.endTurn) yield* h(ctx(g, u, null), u);
    if (!unit(g, u.id)) continue;
    const n = g.turns[u.id] ?? 0;
    g.lasting = g.lasting.filter((l) => !(l.owner === u.id && l.at === "end" && l.turn <= n));
  }
  g.active = [];
  for (let k = 1; k <= g.sides; k++) {
    const s = (side + k) % g.sides;
    if (ready(g, s).length) {
      g.side = s;
      return;
    }
  }
  yield* newRound(g);
}

function* newRound(g: Game): Gen {
  g.round++;
  if (g.round > 6) {
    g.phase = "over";
    g.winner = "draw";
    log(g, "Six rounds without a victor: a draw");
    return;
  }
  for (const u of g.units) u.done = false;
  g.soul = g.soul.map((s) => Math.min(6, s + 1));
  g.side = g.first;
  log(g, `Round ${g.round}`);
}
