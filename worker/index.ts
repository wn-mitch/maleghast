// The Worker: routes /api/room/<code> to that room's Durable Object, which
// holds the game and its players' sockets. Everything else is the client.

import { DurableObject } from "cloudflare:workers";

interface Env {
  ROOMS: DurableObjectNamespace<GameRoom>;
}

export class GameRoom extends DurableObject<Env> {
  override async fetch(_request: Request): Promise<Response> {
    return new Response("room", { status: 501 });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const m = /^\/api\/room\/([A-Za-z0-9]{4,12})$/.exec(new URL(request.url).pathname);
    if (!m) return new Response("not found", { status: 404 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1]!.toUpperCase())).fetch(request);
  },
} satisfies ExportedHandler<Env>;
