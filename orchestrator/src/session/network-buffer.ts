/**
 * NetworkBuffer — bounded ring buffer for CDP Network events.
 *
 * Collects request/response pairs from CDP `Network.requestWillBeSent`,
 * `Network.responseReceived`, and `Network.loadingFailed` events.
 * Stores up to `maxSize` entries; oldest are evicted FIFO when the cap
 * is exceeded. Consumed by Session.snapshot() to populate
 * `snapshot.network.recent[]`.
 */

export interface NetworkEntry {
  url: string;
  method: string;
  /** HTTP status code, or 0 for failed requests. Absent for in-flight requests. */
  status?: number;
  /** MIME type from the response. Absent for in-flight / failed requests. */
  content_type?: string;
  /** Round-trip time in milliseconds. Absent for in-flight requests. */
  duration_ms?: number;
  /** When the request was initiated (ms, converted from CDP seconds). */
  started_at: number;
}

export class NetworkBuffer {
  private entries = new Map<string, NetworkEntry>();
  private order: string[] = [];
  /** Tracks requestIds for in-flight (started but not yet completed) requests. */
  private inFlight = new Set<string>();
  /** Listeners invoked whenever a response (success or failure) completes. */
  private responseCompleteListeners: Array<() => void> = [];

  constructor(private maxSize: number = 100) {}

  onRequest(requestId: string, info: { url: string; method: string; startedAt: number }): void {
    this.entries.set(requestId, {
      url: info.url,
      method: info.method,
      started_at: info.startedAt,
    });
    this.order.push(requestId);
    this.inFlight.add(requestId);
    while (this.order.length > this.maxSize) {
      const evict = this.order.shift()!;
      this.entries.delete(evict);
      this.inFlight.delete(evict);
    }
  }

  onResponse(requestId: string, info: { status: number; mimeType: string; completedAt: number }): void {
    const e = this.entries.get(requestId);
    if (!e) return;
    e.status = info.status;
    e.content_type = info.mimeType;
    e.duration_ms = info.completedAt - e.started_at;
    this.inFlight.delete(requestId);
    this._notifyResponseComplete();
  }

  onFailed(requestId: string, info: { completedAt: number }): void {
    const e = this.entries.get(requestId);
    if (!e) return;
    e.status = 0;
    e.duration_ms = info.completedAt - e.started_at;
    this.inFlight.delete(requestId);
    this._notifyResponseComplete();
  }

  /** Returns the number of requests that have started but not yet completed. */
  inFlightCount(): number {
    return this.inFlight.size;
  }

  /**
   * Register a callback to be invoked whenever a response (success or failure)
   * completes. Returns an unsubscribe function.
   */
  onResponseComplete(fn: () => void): () => void {
    this.responseCompleteListeners.push(fn);
    return () => {
      const idx = this.responseCompleteListeners.indexOf(fn);
      if (idx !== -1) this.responseCompleteListeners.splice(idx, 1);
    };
  }

  private _notifyResponseComplete(): void {
    for (const fn of this.responseCompleteListeners) {
      try { fn(); } catch { /* listener errors must not break the buffer */ }
    }
  }

  recent(): NetworkEntry[] {
    return this.order.map((id) => this.entries.get(id)).filter((e): e is NetworkEntry => !!e);
  }

  urls(): string[] {
    return this.recent().map((e) => e.url);
  }
}
