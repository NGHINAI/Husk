import WebSocket from "ws";

export interface CdpErrorPayload {
  code: number;
  message: string;
  data?: unknown;
}

export class CdpError extends Error {
  readonly code: number;
  readonly data: unknown;
  constructor(payload: CdpErrorPayload) {
    super(`${payload.code}: ${payload.message}`);
    this.name = "CdpError";
    this.code = payload.code;
    this.data = payload.data;
  }
}

type PendingEntry = {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
};

type EventHandler = (params: unknown) => void;

/**
 * Minimal Chrome DevTools Protocol client over a single WebSocket.
 *
 * Uses JSON-RPC 2.0-like envelopes (`{id, method, params, sessionId?}`)
 * matching lightpanda's CDP server. All sessions multiplex over one
 * socket via the `flatten: true` attach pattern.
 */
export class CdpClient {
  private readonly ws: WebSocket;
  private nextId = 0;
  private readonly pending = new Map<number, PendingEntry>();
  private readonly eventListeners = new Map<string, Set<EventHandler>>();
  readonly ready: Promise<void>;

  constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl);
    this.ws.on("message", (data: WebSocket.RawData) => this.onMessage(data));
    this.ws.on("close", () => this.onClose());
    this.ready = new Promise<void>((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", (err) => reject(err));
    });
  }

  /**
   * Send a CDP method call and await the response.
   * @param method CDP method name, e.g. `"Page.navigate"`.
   * @param params Method parameters object.
   * @param sessionId Optional session id (omit for browser-level methods).
   */
  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<unknown> {
    if (this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`CdpClient: socket not open (state=${this.ws.readyState})`));
    }
    const id = ++this.nextId;
    const envelope: Record<string, unknown> = { id, method, params };
    if (sessionId) envelope.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(envelope), (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  /**
   * Convenience helper: create a fresh target for `url` and attach to it
   * with `flatten: true`. Returns the sessionId for subsequent calls.
   */
  async createAndAttachTarget(url: string): Promise<string> {
    const createRes = (await this.send("Target.createTarget", { url })) as { targetId: string };
    const attachRes = (await this.send("Target.attachToTarget", {
      targetId: createRes.targetId,
      flatten: true,
    })) as { sessionId: string };
    return attachRes.sessionId;
  }

  /**
   * Subscribe to CDP event notifications (messages without an `id`).
   * The `event` string is the CDP method name, e.g. `"Page.loadEventFired"`.
   * Matches the `CdpLike` interface expected by `waitForPageReady`.
   */
  on(event: string, fn: EventHandler): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(fn);
  }

  /** Unsubscribe a previously registered event handler. */
  off(event: string, fn: EventHandler): void {
    this.eventListeners.get(event)?.delete(fn);
  }

  /** Close the underlying socket. Pending requests are rejected. */
  close(): Promise<void> {
    if (
      this.ws.readyState === WebSocket.CLOSED ||
      this.ws.readyState === WebSocket.CLOSING
    ) {
      return Promise.resolve();
    }
    const closed = new Promise<void>((resolve) => this.ws.once("close", () => resolve()));
    this.ws.close();
    return closed;
  }

  private onMessage(data: WebSocket.RawData): void {
    const text = typeof data === "string" ? data : data.toString();
    let msg: { id?: number; method?: string; params?: unknown; result?: unknown; error?: CdpErrorPayload };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.id == null) {
      // CDP event notification — dispatch to registered listeners.
      if (msg.method) {
        const listeners = this.eventListeners.get(msg.method);
        if (listeners) {
          for (const fn of listeners) fn(msg.params ?? {});
        }
      }
      return;
    }
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    if (msg.error) entry.reject(new CdpError(msg.error));
    else entry.resolve(msg.result ?? null);
  }

  private onClose(): void {
    for (const [, entry] of this.pending) {
      entry.reject(new Error("CdpClient: connection closed"));
    }
    this.pending.clear();
  }
}
