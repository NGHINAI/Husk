/**
 * event-emitters.ts — M22 Phase E Task 3.
 *
 * Typed helper functions that build well-formed CognitionEvent objects and
 * publish them to a CognitionBus.  Each helper is a no-op when `bus` is
 * undefined, so callers can guard with a single optional parameter rather
 * than scattering `if (bus)` checks everywhere.
 *
 * Additional emitters (network_idle, captcha_detected, error_appeared,
 * user_intervention_required) will be added in T4-T6.
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
