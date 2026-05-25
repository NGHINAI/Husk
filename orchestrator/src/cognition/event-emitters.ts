/**
 * event-emitters.ts — M22 Phase E Tasks 3-4.
 *
 * Typed helper functions that build well-formed CognitionEvent objects and
 * publish them to a CognitionBus.  Each helper is a no-op when `bus` is
 * undefined, so callers can guard with a single optional parameter rather
 * than scattering `if (bus)` checks everywhere.
 *
 * Additional emitters (captcha_detected, error_appeared,
 * user_intervention_required) will be added in T5-T6.
 */

import { randomUUID } from "node:crypto";
import type { CognitionBus } from "./cognition-bus.js";
import type { CognitionEvent } from "./events.js";

/**
 * Emit a `state_change` event into the bus.
 *
 * Callers are responsible for comparing from/to before calling — this
 * function publishes unconditionally (it does not skip from === to).
 */
export function emitStateChange(
  bus: CognitionBus,
  session_id: string,
  site: string,
  from_state: string | null,
  to_state: string,
  confidence?: number,
): void {
  const ev: CognitionEvent = {
    id: randomUUID(),
    ts: Date.now(),
    session_id,
    site,
    type: "state_change",
    payload: {
      from_state,
      to_state,
      ...(confidence !== undefined && { confidence }),
    },
  };
  bus.publish(ev);
}

// ---------------------------------------------------------------------------
// T4 — network_idle emitter
// ---------------------------------------------------------------------------

/**
 * Minimal interface that wireNetworkIdle requires from a session.
 * Session must expose:
 *   - `id`          — stable session identifier
 *   - `currentSite()` — current hostname (best-effort; may return "")
 *   - `networkBuffer` — NetworkBuffer public API surface needed here
 */
export interface NetworkIdleSession {
  readonly id: string;
  currentSite(): string;
  networkBuffer: {
    inFlightCount(): number;
    onResponseComplete(fn: () => void): () => void;
  };
}

/**
 * Wire a debounced network-idle detector into `session.networkBuffer`.
 *
 * After each response completes:
 *   - If in-flight count is 0, start a `debounce_ms` timer.
 *   - If a new response fires before the timer, restart the timer.
 *   - When the timer fires and in-flight is still 0, publish `network_idle`.
 *
 * Returns a cleanup function — call it from Session.close() to cancel any
 * pending timer and remove the response-complete listener.
 */
export function wireNetworkIdle(
  bus: CognitionBus,
  session: NetworkIdleSession,
  debounce_ms = 500,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const onComplete = (): void => {
    cancel();
    if (session.networkBuffer.inFlightCount() === 0) {
      timer = setTimeout(() => {
        timer = null;
        if (session.networkBuffer.inFlightCount() === 0) {
          const now = Date.now();
          const ev: CognitionEvent = {
            id: randomUUID(),
            ts: now,
            session_id: session.id,
            site: session.currentSite(),
            type: "network_idle",
            payload: { idle_since: now - debounce_ms, in_flight_count: 0 },
          };
          bus.publish(ev);
        }
      }, debounce_ms);
    }
  };

  const unsub = session.networkBuffer.onResponseComplete(onComplete);

  return (): void => {
    cancel();
    unsub();
  };
}
