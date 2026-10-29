// Runs the computer opponent off the page's thread, so the board stays responsive while it thinks.

import { decide } from "../ai/ai";
import { installContent } from "../content";
import type { Game } from "../rules/state";

installContent();

const scope = globalThis as unknown as { onmessage: ((e: MessageEvent<AiAsk>) => void) | null; postMessage(m: AiAnswer): void };

export interface AiAsk {
  readonly id: number;
  readonly game: Game;
  readonly side: number;
}

export interface AiAnswer {
  readonly id: number;
  readonly cmd: ReturnType<typeof decide>;
}

scope.onmessage = (e) => scope.postMessage({ id: e.data.id, cmd: decide(e.data.game, e.data.side, Math.random) });
