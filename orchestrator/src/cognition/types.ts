/**
 * Shared cognition types for v0.1 state graphs.
 *
 * These shapes are locked — downstream tasks (T2-T6) depend on them.
 * Do not rename or restructure without updating all consumers.
 */

import type { Evidence } from "./intention-types.js";

/** Unique identifier for a site-state. Format: "site::state_name" */
export type StateId = string; // e.g. "linkedin.com::home_feed"

/**
 * Predicate — discriminated union of 9 types used in identify_by and wait_for.
 * Evaluated deterministically (no LLM) by predicate.ts.
 */
export type Predicate =
  | { type: "url_pattern"; regex: string }
  | { type: "ax_role_name"; role: string; name?: string; name_regex?: string }
  | { type: "ax_text_match"; regex: string }
  | { type: "network_recent"; url_pattern: string; method?: string; status?: number }
  | { type: "cookies_contain"; name: string; value_regex?: string }
  | { type: "forms_present"; min_fields?: number; field_types?: string[] }
  | { type: "and"; all: Predicate[] }
  | { type: "or"; any: Predicate[] }
  | { type: "not"; not: Predicate };

/**
 * A recognized page-state for a site.
 * identified by AX-fingerprint predicates; carries affordance metadata.
 */
export interface SiteState {
  /** e.g. "linkedin.com" */
  site: string;
  /** e.g. "linkedin.com::home_feed" */
  state_id: StateId;
  /** Predicate that must hold for the current snapshot to match this state */
  identify_by: Predicate;
  /** Names of intentions valid (i.e. afforded) in this state */
  affordances: string[];
  /** How many times this state has been observed */
  observed_count: number;
  /** 0..1 confidence score */
  confidence: number;
  /** Unix ms of last observation */
  last_seen_at: number;
}

/**
 * A recorded transition between two site states, with reliability metadata.
 */
export interface Transition {
  site: string;
  from_state: StateId;
  to_state: StateId;
  /** Sequence of low-level actions that produced this transition */
  action_sequence: ActionStep[];
  success_count: number;
  failure_count: number;
  /** Running average of wall-clock time for this transition (ms) */
  avg_duration_ms: number;
  /** 0..1 confidence score; updated by confidence engine */
  confidence: number;
  /** Unix ms of last use */
  last_used_at: number;
}

/**
 * A single low-level action in a transition sequence.
 * Discriminated by `verb`.
 */
export type ActionStep =
  | { verb: "navigate"; url: string }
  | { verb: "click"; intent: string }
  | { verb: "click_stable_id"; stable_id: string }
  | { verb: "type"; intent: string; text_arg: string }
  | { verb: "press_key"; key: string }
  | { verb: "wait_for"; predicate: Predicate; timeout_ms?: number }
  | { verb: "snapshot" };

/**
 * A single observation recorded during an exploration session.
 * Forms a chronological log of state changes for offline graph synthesis.
 */
export interface Observation {
  site: string;
  /** Unix ms */
  ts: number;
  /** The state before the action (null at session start) */
  prev_state: StateId | null;
  current_state: StateId;
  url: string;
  snapshot_summary: string;
  /** The action that produced this observation; null at session start */
  action_taken: ActionStep | null;
  /** When the observation was triggered by an intention (Phase D). */
  intention_name?: string;
  /** Evidence collected during the intention run (Phase D). */
  evidence?: Evidence[];
}
