import { connect } from "websocket";

type Handler = (...args: any[]) => void;

export default class WS {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = 0;
  private handlers: Record<string, Handler[]> = {};
  private conn: any = null;
  private queue: any[] = [];
  private closing = false;

  constructor(url: string, options?: { headers?: Record<string, string> }) {
    connect(url, options?.headers ? { headers: options.headers } : undefined)
      .then(async (conn: any) => {
        this.conn = conn;
        if (this.closing) {
          await conn.close().catch(() => {});
          return;
        }
        this.readyState = WS.OPEN;
        this.emit("open");
        for (const data of this.queue.splice(0)) {
          try { await conn.write(data); } catch (e) { this.emit("error", e); }
        }
        try {
          for (;;) {
            const message = await conn.read();
            if (message === null) break;
            this.emit("message", message);
          }
        } catch (e) {
          this.emit("error", e);
        }
        this.readyState = WS.CLOSED;
        this.emit("close");
      })
      .catch((e: any) => {
        this.readyState = WS.CLOSED;
        this.emit("error", e);
        this.emit("close");
      });
  }

  on(event: string, handler: Handler) {
    (this.handlers[event] ??= []).push(handler);
    return this;
  }

  off(event: string, handler: Handler) {
    const list = this.handlers[event];
    if (list) this.handlers[event] = list.filter((h) => h !== handler);
    return this;
  }

  private emit(event: string, ...args: any[]) {
    for (const handler of this.handlers[event] ?? []) handler(...args);
  }

  send(data: any) {
    if (this.conn && this.readyState === WS.OPEN) {
      this.conn.write(data).catch((e: any) => this.emit("error", e));
    } else {
      this.queue.push(data);
    }
  }

  close() {
    if (this.closing) return;
    this.closing = true;
    this.readyState = WS.CLOSING;
    if (this.conn) this.conn.close().catch(() => {});
  }
}
