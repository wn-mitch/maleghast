// The Worker: routes /api/room/<code> to that room's Durable Object, which
// holds the game and its players' sockets. Everything else is the client.

import { DurableObject } from "cloudflare:workers";
import { installContent } from "../src/content";
import { type ClientMsg, type Player, type Room, emptyRoom, handle, view } from "../src/net/room";

installContent();

interface Env {
  ROOMS: DurableObjectNamespace<GameRoom>;
}

/**
 * One room. Sockets hibernate between messages, so each carries its player
 * as an attachment and the room lives in storage.
 */
export class GameRoom extends DurableObject<Env> {
  private room: Room | null = null;

  private async load(): Promise<Room> {
    this.room ??= (await this.ctx.storage.get<Room>("room")) ?? emptyRoom();
    return this.room;
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected a websocket", { status: 426 });
    const url = new URL(request.url);
    const token = url.searchParams.get("token") ?? "", name = (url.searchParams.get("name") ?? "").trim().slice(0, 24);
    if (token.length < 8 || !name) return new Response("token and name required", { status: 400 });
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ token, name } satisfies Player);
    await this.load();
    this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const who = ws.deserializeAttachment() as Player;
    const room = await this.load();
    let next: Room;
    try {
      const msg = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data)) as ClientMsg;
      next = handle(room, who, msg, () => crypto.getRandomValues(new Uint32Array(1))[0]!);
    } catch (e) {
      ws.send(JSON.stringify({ t: "error", message: e instanceof Error ? e.message : String(e) }));
      return;
    }
    this.room = next;
    await this.ctx.storage.put("room", next);
    this.broadcast();
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    await this.load();
    this.broadcast(ws);
  }

  /** Send everyone the room as they see it; `gone` is a socket that is closing. */
  private broadcast(gone?: WebSocket): void {
    const sockets = this.ctx.getWebSockets().filter((s) => s !== gone);
    const online = new Set(sockets.map((s) => (s.deserializeAttachment() as Player).token));
    for (const s of sockets) {
      try {
        s.send(JSON.stringify(view(this.room!, online, (s.deserializeAttachment() as Player).token)));
      } catch {
        // A socket closing mid-send misses this update; it gets the next one when it reconnects.
      }
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const m = /^\/api\/room\/([A-Za-z0-9]{4,12})$/.exec(new URL(request.url).pathname);
    if (!m) return new Response("not found", { status: 404 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1]!.toUpperCase())).fetch(request);
  },
} satisfies ExportedHandler<Env>;
