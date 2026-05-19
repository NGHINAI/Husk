/**
 * The verbs the watchdog gates. Matches the HTTP method names
 * exposed at /v1/jsonrpc.
 */
export type Verb = "click" | "type" | "scroll" | "press_key" | "upload";

/** One candidate returned alongside an `element_not_found` rejection. */
export interface Candidate {
  stable_id: string;
  role: string;
  name: string;
  /** Jaro-Winkler score in [0, 1]. Higher is better. */
  score: number;
}

/**
 * Rejection envelope returned when the watchdog blocks an action.
 * Always sets `ok: false` so the HTTP layer can JSON-RPC-error it.
 * Spec §5.3.
 */
export interface RejectionEnvelope {
  ok: false;
  /** Machine-readable failure code. */
  reason: RejectionReason;
  /** The stable_id the agent asked to act on (may be missing from snapshot). */
  stable_id_attempted: string | null;
  /** Verb that was attempted. */
  verb: Verb;
  /** Top-3 alternative selectors the agent could try instead. Empty when no near matches. */
  candidates: Candidate[];
  /** Snapshot tree captured at attempt time, for the agent to re-plan against. */
  snapshot_at_attempt: import("../snapshot/types.js").Snapshot;
  /** Optional human-readable hint (used by `severity: warn` rules that escalated to hard). */
  message?: string;
}

export type RejectionReason =
  | "element_not_found"
  | "element_not_visible"
  | "element_disabled"
  | "wrong_role_for_action"
  | "policy_forbidden"
  | "policy_required_before"
  | "policy_domain_denied"
  | "session_paused";

/**
 * Soft notice returned alongside `ok: true` when a `warn`-severity rule fires
 * or a post-action assertion is informative but non-blocking.
 */
export interface Warning {
  reason: WarningReason;
  message: string;
}

export type WarningReason =
  | "no_mutation_observed"
  | "error_alert_appeared"
  | "unexpected_navigation"
  | "policy_warn";

// ----- Policy types (used by Task 9 + Task 10) -----

export interface PolicyDocument {
  flow?: string;
  forbidden?: ForbiddenRule[];
  required_before?: RequiredBeforeRule[];
  allow_domains?: string[];
  deny_domains?: string[];
}

export type Severity = "hard" | "warn";

export interface ForbiddenRule {
  /** Match by ARIA role (combined with name_matches). */
  role?: string;
  /** JS regex source (no flags — case-insensitivity is per-rule via `(?i)` prefix or inline). */
  name_matches?: string;
  /** Alternative to role+name_matches: raw CSS selector (matched against `current_css` if present). */
  selector?: string;
  /** Restrict to a single verb. Omitted = all verbs. */
  on?: Verb;
  severity: Severity;
  /** Optional message surfaced in the rejection envelope. */
  message?: string;
}

export interface PrereqClause {
  role: string;
  name_matches: string;
  /** One of the snapshot state flags: e/v/c/f/d, or the compound `checked`. */
  state: "checked" | "enabled" | "visible" | "focused" | "disabled";
}

export interface RequiredBeforeRule {
  /** The verb gated by these prerequisites. v0 only supports `click`. */
  action: Verb | "submit_form";
  prereq: PrereqClause[];
}
