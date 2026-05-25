import type { Predicate, ActionStep, StateId } from "./types.js";

/** Retry policy for a verify check. */
export interface RetryOptions {
  /** Total budget (default 5000). */
  timeout_ms?: number;
  /** Wait between attempts (default 250). */
  interval_ms?: number;
  /** Hard cap on attempts regardless of timeout (default 20). */
  max_attempts?: number;
}

/** A verification check that runs after intention steps complete. */
export type VerifyCheck =
  | {
      type: "predicate";
      predicate: Predicate;
      description: string;
      retry?: RetryOptions;
    }
  | {
      type: "network";
      method?: "GET" | "POST" | "PUT" | "DELETE";
      url_pattern: string;
      status_min?: number;
      status_max?: number;
      description: string;
      retry?: RetryOptions;
    }
  | {
      type: "url";
      pattern: string;
      description: string;
      retry?: RetryOptions;
    }
  | {
      type: "text_present";
      /** Regex (case-insensitive by default) to match against collapsed text content. */
      pattern: string;
      description: string;
      retry?: RetryOptions;
    }
  | {
      type: "text_absent";
      /** Regex (case-insensitive by default). Passes when the pattern is NOT found. */
      pattern: string;
      description: string;
      retry?: RetryOptions;
    }
  | {
      type: "ax_state";
      role: string;
      /** Exact match on accessible name (case-insensitive). When omitted, matches any. */
      name?: string;
      /** State name to check (e.g., "disabled", "checked"). */
      state: string;
      /** Expected value (defaults to true). */
      expected?: boolean;
      description: string;
      retry?: RetryOptions;
    };

/** A pattern matched against a runtime error to classify failure into a typed reason. */
export interface FailureModePattern {
  reason: FailureReason;
  match: VerifyCheck;  // when this predicate matches, the failure is classified as `reason`
}

/** Reference to an element by intent rather than stable_id.
 *  Resolved at runtime against the current snapshot. */
export type IntentRef =
  | { button: string }
  | { link: string }
  | { textbox: string }
  | { combobox: string }
  | { heading: string }
  | { role: string; name: string };

/** A single step within an intention's `steps` array. */
export type IntentionStep =
  | { verb: "click"; target: IntentRef }
  | { verb: "type"; target: IntentRef; value: string }  // value may be a template like "{{args.email}}"
  | { verb: "press_key"; key: string }
  | { verb: "scroll"; direction: "up" | "down" | "into_view"; target?: IntentRef; amount_px?: number }
  | { verb: "wait_for"; predicate: Predicate; timeout_ms?: number }
  | { verb: "navigate"; url: string }  // url may be templated
  | { verb: "snapshot" };

export interface Intention {
  site: string;
  name: string;
  /** JSON Schema describing the args this intention accepts. Stored as JSON in DB. */
  args_schema: Record<string, unknown>;
  /** State the intention requires to begin. May reference args via "{{args.X}}". */
  requires_state?: StateId;
  steps: IntentionStep[];
  verify: VerifyCheck[];
  failure_modes: FailureModePattern[];
  /** Optional comment for humans reading the YAML. */
  description?: string;
  created_at: number;
  updated_at: number;
}

/** Finite vocabulary of why an intention failed. */
export type FailureReason =
  // State-machine reasons
  | "unknown_site"
  | "unknown_state"
  | "no_path_to_target"
  | "state_drift_mid_execution"
  | "verify_failed"
  // Step execution reasons
  | "element_not_found"
  | "element_not_interactive"
  | "watchdog_rejected"
  | "timeout"
  // Network reasons
  | "network_failure"
  | "network_timeout"
  | "network_throttled"
  | "rate_limited"
  // Site-side reasons
  | "account_locked"
  | "bot_challenge"
  | "two_factor_required"
  | "permission_denied"
  | "content_not_found"
  | "feature_unavailable"
  // Human reasons
  | "needs_human"
  | "needs_credentials"
  | "needs_2fa_code"
  | "needs_payment_confirmation"
  | "human_declined"
  | "human_timeout"
  // Engine reasons
  | "engine_unsupported"
  | "engine_crashed"
  | "out_of_memory"
  | "pool_exhausted"
  // Unknown
  | "unknown_error";

/** A single recorded verification check + result. */
export interface Evidence {
  predicate: string; // human-readable description
  passed: boolean;
  observed_value?: unknown;
  /** Unix ms when this check ran (or the last attempt if polled). */
  ts?: number;
  /** Where the data came from: which subsystem produced it. */
  source?: "url" | "network" | "ax" | "predicate" | "text";
  /** Severity tag — defaults to "block" for hard verify; "warn" for softer signals. */
  severity?: "info" | "warn" | "block";
  /** When retrying, how many attempts were made. Absent for single-shot. */
  attempts?: number;
}

/** Log entry for a single transition executed mid-intention. */
export interface TransitionLog {
  from_state: StateId;
  to_state: StateId;
  actions: ActionStep[];
  duration_ms: number;
  ok: boolean;
}

/** The result envelope returned to the agent. */
export interface Outcome<T = unknown> {
  ok: boolean;
  intention: string;
  args: unknown;
  state_before: StateId | null;
  state_after?: StateId;
  result?: T;
  evidence: Evidence[];
  duration_ms: number;
  reason?: FailureReason;
  reason_detail?: string;
  recovery_options?: Array<{
    label: string;
    intention?: string;
    needs_human?: boolean;
  }>;
  steps_observed: TransitionLog[];
}
