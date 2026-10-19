import type { ClientMessage, ServerMessage } from "@spacegame/shared";

type Handler = (msg: ServerMessage) => void;

/** WebSocket spojení se serverem s automatickým znovupřipojením a obnovou sezení. */
export class Net {
  private ws: WebSocket | null = null;
  private handlers: Handler[] = [];
  private retry = 0;
  private closedByUser = false;
  onStatus: (connected: boolean) => void = () => {};

  constructor(private getName: () => string) {}

  get sessionId(): string | undefined {
    try {
      return localStorage.getItem("spacegame.session") ?? undefined;
    } catch {
      return undefined;
    }
  }
  set sessionId(v: string | undefined) {
    try {
      if (v) localStorage.setItem("spacegame.session", v);
      else localStorage.removeItem("spacegame.session");
    } catch {
      /* ignore */
    }
  }

  connect() {
    this.closedByUser = false;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.onStatus(true);
      this.send({ type: "hello", name: this.getName(), sessionId: this.sessionId });
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "welcome") this.sessionId = msg.sessionId;
      for (const h of this.handlers) h(msg);
    };
    ws.onclose = () => {
      this.onStatus(false);
      if (this.closedByUser) return;
      const delay = Math.min(5000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }

  send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  on(handler: Handler) {
    this.handlers.push(handler);
  }
}
