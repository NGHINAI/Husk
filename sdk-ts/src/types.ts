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
  | "policy_domain_denied";

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

export type ActionResult = { ok: true; warnings: Warning[] } | RejectionEnvelope;

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

// ----- JSON-RPC envelope types -----

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
