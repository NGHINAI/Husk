import type { WatchEvent } from "./events.js";

export class WatchBus {
  private subs = new Map<string, Set<(e: WatchEvent) => void>>();

  subscribe(sessionId: string, fn: (e: WatchEvent) => void): () => void {
    if (!this.subs.has(sessionId)) this.subs.set(sessionId, new Set());
    this.subs.get(sessionId)!.add(fn);
    return () => {
      this.subs.get(sessionId)?.delete(fn);
      if (this.subs.get(sessionId)?.size === 0) this.subs.delete(sessionId);
    };
  }

  emit(sessionId: string, event: WatchEvent): void {
    const set = this.subs.get(sessionId);
    if (!set) return;
    for (const fn of set) {
      try { fn(event); } catch { /* isolate listener errors */ }
    }
  }
}
