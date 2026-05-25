/**
 * Wire types for the Husk JSON-RPC v1 API. These mirror what
 * `orchestrator/src/http/methods.ts` returns — kept in sync by tests,
 * not via shared imports (the SDK has no orchestrator dependency).
 */

export type Verb = "click" | "type" | "scroll" | "press_key";

export type SnapshotStateFlag = "e" | "v" | "c" | "f" | "d";

export interface SnapshotNode {
  /** Stable ID — `{role}:{blake3 base64}[16]`. */
  i: string;
  /** ARIA role. */
  r: string;
  /** Accessible name (raw, not normalized). */
  n: string;
  /** State flags. */
  s: SnapshotStateFlag[];
  /** Optional raw text (only present for r === "text"). */
  t?: string;
  /** Children. */
  c?: SnapshotNode[];
}

export interface Snapshot {
  v: 1;
  url: string;
  count: number;
  root: SnapshotNode;
  /** Other session ids in the same tab group (sharing cookie profile). Empty for solo sessions. */
  sibling_sessions: string[];
  /** Engine that produced this snapshot. M17. */
  engine?: "lightpanda" | "chrome";
}

export interface SnapshotDiff {
  added: SnapshotNode[];
  removed: string[];
  changed: Array<{ id: string; before: SnapshotNode; after: SnapshotNode }>;
}

export interface Candidate {
  stable_id: string;
  role: string;
  name: string;
  score: number;
}

export type RejectionReason =
  | "element_not_found"
  | "element_not_visible"
  | "element_disabled"
  | "wrong_role_for_action"
  | "policy_forbidden"
  | "policy_required_before"
  | "policy_domain_denied"
  | "no_match"
  | "ambiguous_intent"
  | "missing_target"
  | "session_paused"
  | "engine_unsupported";

export interface RejectionEnvelope {
  ok: false;
  reason: RejectionReason;
  verb: Verb;
  stable_id_attempted: string | null;
  candidates: Candidate[];
  snapshot_at_attempt: Snapshot;
  message?: string;
}

export type WarningReason =
  | "no_mutation_observed"
  | "error_alert_appeared"
  | "unexpected_navigation"
  | "policy_warn";

export interface Warning {
  reason: WarningReason;
  message: string;
}

export interface OpenedModal {
  /** The dialog's stable_id. Pass to husk_click to interact with the modal. */
  stable_id: string;
  role: "dialog" | "alertdialog" | "menu";
  /** First heading child, or aria-label of the dialog. Null when not determinable. */
  title: string | null;
  /** All button-role (and link-role) descendants of the modal. */
  buttons: Array<{ stable_id: string; name: string }>;
}

export type ActionResult = { ok: true; warnings: Warning[]; diff: SnapshotDiff | null; opened_modal?: OpenedModal } | RejectionEnvelope;

/** ActionResult widened with the post-action snapshot (present by default, absent when include_snapshot:false). */
export type ActionResultWithSnapshot<T = ActionResult> = T & { snapshot?: Snapshot };

/**
 * Extension fields present on goto results when the engine-router fallback fired. M17.
 * These appear alongside the normal goto result object.
 */
export interface GotoFallbackFields {
  /** Set when lightpanda was tried first and Chrome was used instead. */
  fellback_from?: "lightpanda";
  /** Reasons the page-health check triggered the fallback. */
  fallback_reasons?: string[];
  /** Set when the fallback itself failed (e.g. Chrome not installed). */
  fallback_failed?: { reason: string; attempted_reasons: string[] };
}

// ----- Policy types (parsed server-side via set_policy; SDK sends raw YAML) -----

export type Severity = "hard" | "warn";

export interface ForbiddenRule {
  role?: string;
  name_matches?: string;
  selector?: string;
  on?: Verb;
  severity: Severity;
  message?: string;
}

export interface PrereqClause {
  role: string;
  name_matches: string;
  state: "checked" | "enabled" | "visible" | "focused" | "disabled";
}

export interface RequiredBeforeRule {
  action: Verb | "submit_form";
  prereq: PrereqClause[];
}

export interface PolicyDocument {
  flow?: string;
  forbidden?: ForbiddenRule[];
  required_before?: RequiredBeforeRule[];
  allow_domains?: string[];
  deny_domains?: string[];
}

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  size: number;
  httpOnly: boolean;
  secure: boolean;
  session: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  url?: string;
}

// ----- JSON-RPC envelope types -----

/** Result of the create_session JSON-RPC method. */
export interface CreateSessionResult {
  session_id: string;
  /** Non-null when the orchestrator is bound to 127.0.0.1 (loopback-only). */
  watch_url: string | null;
}

export interface JsonRpcSuccessResponse<T = unknown> {
  jsonrpc: "2.0";
  id: string | number | null;
  result: T;
}

export interface JsonRpcErrorPayload {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  error: JsonRpcErrorPayload;
}

export type JsonRpcResponse<T = unknown> = JsonRpcSuccessResponse<T> | JsonRpcErrorResponse;

export interface Credential {
  key: string;
  username: string;
  password: string;
  totp_secret?: string;
}

export type LoginReason =
  | "login_form_not_found"
  | "login_did_not_advance"
  | "watchdog_rejected"
  | "totp_field_not_found"
  | "credential_not_found";

export type LoginResult =
  | { ok: true; url_before: string; url_after: string }
  | { ok: false; reason: LoginReason; key?: string; detail?: unknown };

// ----- husk_wait_for types -----

export interface WaitForCondition {
  text?: string;
  role?: string;
  name?: string;
  url_matches?: string;
  network_idle?: number;
  selector_visible?: string;
  timeout_ms?: number;
}

export interface WaitForResult {
  ok: boolean;
  condition_met?: "text" | "role_name" | "url_matches" | "network_idle" | "selector_visible";
  reason?: "timeout";
  waited_ms: number;
  stable_id?: string;
}

export interface UploadResult {
  ok: boolean;
  reason?: string;
  candidates?: Candidate[];
}

// ----- husk_extract paginate types -----

export interface PaginateOpts {
  /** Target for the next-page element. Pass {intent} or {stable_id}. */
  next: { stable_id?: string; intent?: string };
  /** Maximum pages to collect. Default 10. */
  max_pages?: number;
  /** Optional condition to stop pagination early (same set as WaitForCondition). */
  stop_when?: WaitForCondition;
}

export type StoppedReason = "max_pages" | "stop_when" | "next_disappeared" | "click_failed";

export interface PaginateResult<T = unknown> {
  pages: T[];
  total_pages: number;
  stopped_reason: StoppedReason;
}

// ----- husk_handoff return types -----

export interface HandoffPasteResult {
  pending: true;
  token: string;
  handoff_url: string | null;
  surface: { reason: string; suggested_action?: string; current_url?: string };
  mode?: "paste";
}

export interface HandoffSeamlessResult {
  ok: boolean;
  mode: "seamless";
  cookies_imported: number;
  ms_paused: number;
  reason?: "timeout" | "chrome_not_found";
}

export type HandoffResult = HandoffPasteResult | HandoffSeamlessResult;

// ----- Intention / Outcome types (M19 Phase B) -----

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

export interface Evidence {
  predicate: string;
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

export interface Outcome<T = unknown> {
  ok: boolean;
  intention: string;
  args: unknown;
  state_before: string | null;
  state_after?: string;
  result?: T;
  evidence: Evidence[];
  duration_ms: number;
  reason?: FailureReason;
  reason_detail?: string;
  recovery_options?: Array<{ label: string; intention?: string; needs_human?: boolean }>;
  steps_observed: unknown[];  // opaque to SDK consumers in Phase B
}
