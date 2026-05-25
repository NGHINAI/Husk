/**
 * Cognition event types — what agents can subscribe to.
 *
 * Each event has a `type`, `session_id`, `ts`, `site?`, and a typed `payload`.
 */

export type EventType =
  | "state_change"
  | "network_idle"
  | "error_appeared"
  | "captcha_detected"
  | "user_intervention_required";

export interface BaseEvent {
  /** Globally unique event id (uuid). */
  id: string;
  /** Unix ms. */
  ts: number;
  /** Which session produced this event. */
  session_id: string;
  /** Hostname when known. */
  site?: string;
}

export type CognitionEvent =
  | (BaseEvent & {
      type: "state_change";
      payload: { from_state: string | null; to_state: string; confidence?: number };
    })
  | (BaseEvent & {
      type: "network_idle";
      payload: { idle_since: number; in_flight_count: number };
    })
  | (BaseEvent & {
      type: "error_appeared";
      payload: { kind: "banner" | "console" | "dialog"; text: string };
    })
  | (BaseEvent & {
      type: "captcha_detected";
      payload: { kind: string; reasons: string[] };
    })
  | (BaseEvent & {
      type: "user_intervention_required";
      payload: { reason: "ask_human" | "handoff" | "needs_credentials" | "needs_2fa_code"; question_id?: string };
    });

/** Filter applied at subscription time. */
export interface EventFilter {
  /** When set, only events matching this session_id are delivered. "*" matches all. */
  session_id?: string;
  /** When set, only events from this site (hostname) are delivered. */
  site?: string;
  /** Optional debounce in ms — coalesces same-type events from the same session_id. */
  debounce_ms?: number;
}

/** Subscription record stored on the bus. */
export interface Subscription {
  id: string;
  event_type: EventType;
  filter: EventFilter;
  created_at: number;
  /** Last-emit ts for debounce purposes (per session_id). */
  last_emit_ts?: Map<string, number>;
}
