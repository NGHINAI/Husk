import { randomUUID } from "node:crypto";
import type { CognitionEvent, EventFilter, EventType, Subscription } from "./events.js";

/**
 * In-process pub/sub for cognition events.
 *
 * Subscribers register a (event_type, filter) tuple; the bus invokes their
 * handler when a matching event is published. Optional per-subscription
 * debounce coalesces same-type events from the same session_id.
 */
export class CognitionBus {
  private readonly subscriptions = new Map<
    string,
    Subscription & { handler: (e: CognitionEvent) => void }
  >();

  subscribe(
    event_type: EventType,
    filter: EventFilter,
    handler: (e: CognitionEvent) => void,
  ): string {
    const id = randomUUID();
    this.subscriptions.set(id, {
      id,
      event_type,
      filter,
      created_at: Date.now(),
      handler,
      last_emit_ts: filter.debounce_ms !== undefined ? new Map() : undefined,
    });
    return id;
  }

  unsubscribe(id: string): boolean {
    return this.subscriptions.delete(id);
  }

  publish(event: CognitionEvent): void {
    for (const sub of this.subscriptions.values()) {
      if (!this.matches(sub, event)) continue;
      if (sub.filter.debounce_ms !== undefined && sub.last_emit_ts !== undefined) {
        const last = sub.last_emit_ts.get(event.session_id) ?? 0;
        if (event.ts - last < sub.filter.debounce_ms) continue;
        sub.last_emit_ts.set(event.session_id, event.ts);
      }
      try {
        sub.handler(event);
      } catch {
        // Subscriber errors must not break the bus.
      }
    }
  }

  /**
   * Replace the handler for an existing subscription.
   * Used by the SSE endpoint (T7) to wire a stream writer after subscribe.
   * Returns true on success, false when subscription_id is not found.
   */
  setHandler(subscription_id: string, handler: (e: CognitionEvent) => void): boolean {
    const sub = this.subscriptions.get(subscription_id);
    if (!sub) return false;
    sub.handler = handler;
    return true;
  }

  /** For testing / inspection — strips the handler reference. */
  listSubscriptions(): Subscription[] {
    return Array.from(this.subscriptions.values()).map(({ handler: _h, ...s }) => s);
  }

  private matches(sub: Subscription, event: CognitionEvent): boolean {
    if (sub.event_type !== event.type) return false;
    const sid = sub.filter.session_id;
    if (sid !== undefined && sid !== "*" && sid !== event.session_id) return false;
    const site = sub.filter.site;
    if (site !== undefined && event.site !== site) return false;
    return true;
  }
}
