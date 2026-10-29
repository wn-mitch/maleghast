// A battle against the computer, played entirely in the browser: the same
// room rules as online play, with the computer in the second seat. The room
// is saved as it changes, so a reload picks the battle up where it was.

import { AI_LISTS } from "../ai/lists";
import { type ClientMsg, type Player, type Room, type ServerMsg, emptyRoom, handle, view } from "../net/room";
import { defOf } from "../rules/content";
import type { AiAnswer, AiAsk } from "./aiWorker";

const SAVE_KEY = "maleghast.local";
const AI: Player = { token: "computer", name: "Computer" };
/** The least time between the computer's commands, so the player can follow them. */
const PACE_MS = 450;

export interface Session {
  send(m: ClientMsg): void;
  close(): void;
}

function seed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

function load(): Room | null {
  try {
    const r = JSON.parse(localStorage.getItem(SAVE_KEY) ?? "") as Room;
    return r.seats?.length === 2 ? r : null;
  } catch {
    return null;
  }
}

export class LocalSession implements Session {
  private room: Room;
  private readonly worker = new Worker(new URL("./aiWorker.ts", import.meta.url), { type: "module" });
  private asked = 0;
  private thinking = false;
  private last = 0;

  constructor(private readonly you: Player, private readonly onMsg: (m: ServerMsg) => void) {
    const saved = load();
    // A saved battle carries on, with the player in the seat they had.
    this.room = saved?.game && saved.game.phase !== "over"
      ? { ...saved, seats: saved.seats.map((s) => (s && s.token !== AI.token ? { ...s, token: you.token, name: you.name } : s)) }
      : handle(handle(emptyRoom(), you, { t: "sit", seat: 0 }, seed), AI, { t: "sit", seat: 1 }, seed);
    this.worker.onmessage = (e: MessageEvent<AiAnswer>) => this.computerPlays(e.data);
    queueMicrotask(() => this.changed());
  }

  send(m: ClientMsg): void {
    // The seats are fixed: the player and the computer.
    if (m.t === "sit" || m.t === "stand") return;
    try {
      this.room = handle(this.room, this.you, m, seed);
      // The computer answers the player's list with the other house's.
      if (m.t === "list" && !this.room.game) {
        const house = defOf(m.list.necromancer).house === "carcass" ? "goregrinders" : "carcass";
        this.room = handle(this.room, AI, { t: "list", list: AI_LISTS[house]! }, seed);
      }
    } catch (e) {
      this.onMsg({ t: "error", message: e instanceof Error ? e.message : String(e) });
      return;
    }
    this.changed();
  }

  close(): void {
    this.worker.terminate();
  }

  private changed(): void {
    localStorage.setItem(SAVE_KEY, JSON.stringify(this.room));
    this.onMsg(view(this.room, new Set([this.you.token, AI.token]), this.you.token));
    this.prompt();
  }

  /** Ask the computer for its command if the battle is waiting on it. */
  private prompt(): void {
    const g = this.room.game;
    if (!g || g.phase === "over" || this.thinking) return;
    const side = g.pending ? g.pending.request.side : g.side;
    if (side !== 1) return;
    this.thinking = true;
    this.worker.postMessage({ id: ++this.asked, game: g, side } satisfies AiAsk);
  }

  private computerPlays(a: AiAnswer): void {
    if (a.id !== this.asked) return;
    const wait = Math.max(0, this.last + PACE_MS - performance.now());
    setTimeout(() => {
      this.thinking = false;
      this.last = performance.now();
      const g = this.room.game;
      if (!g || !a.cmd) return;
      try {
        this.room = handle(this.room, AI, { t: "cmd", cmd: a.cmd }, seed);
      } catch (e) {
        // A refused command would stall the battle; the computer ends its unit's turn instead.
        console.error("computer's command refused", a.cmd, e);
        if (g.active.length) this.room = handle(this.room, AI, { t: "cmd", cmd: { kind: "end", side: 1 } }, seed);
      }
      this.changed();
    }, wait);
  }
}
