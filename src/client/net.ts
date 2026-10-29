// The socket to a game room. It reconnects on its own; the browser keeps a
// token so a reload or a dropped connection takes back the same seat.

import type { ClientMsg, ServerMsg } from "../net/room";

const TOKEN_KEY = "maleghast.token";

function token(): string {
  let t = localStorage.getItem(TOKEN_KEY);
  if (!t) {
    t = crypto.randomUUID();
    localStorage.setItem(TOKEN_KEY, t);
  }
  return t;
}

export class Connection {
  private ws: WebSocket | null = null;
  private retry = 500;
  private closed = false;

  constructor(
    private readonly code: string,
    private readonly name: string,
    private readonly onMsg: (m: ServerMsg) => void,
    private readonly onStatus: (online: boolean) => void,
  ) {
    this.open();
  }

  private open(): void {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const q = new URLSearchParams({ token: token(), name: this.name });
    const ws = new WebSocket(`${scheme}://${location.host}/api/room/${encodeURIComponent(this.code)}?${q}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 500;
      this.onStatus(true);
    };
    ws.onmessage = (e) => this.onMsg(JSON.parse(String(e.data)) as ServerMsg);
    ws.onclose = () => {
      this.onStatus(false);
      if (this.closed) return;
      setTimeout(() => this.open(), this.retry);
      this.retry = Math.min(this.retry * 2, 5000);
    };
  }

  send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }
}
