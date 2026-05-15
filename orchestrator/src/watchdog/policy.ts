import { load as yamlLoad, YAMLException } from "js-yaml";
import type {
  ForbiddenRule,
  PolicyDocument,
  PrereqClause,
  RejectionReason,
  RequiredBeforeRule,
  Severity,
  Verb,
  Warning,
} from "./types.js";
import type { Snapshot, SnapshotNode } from "../snapshot/types.js";

export class PolicyParseError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "PolicyParseError";
  }
}

const SEVERITIES = new Set<Severity>(["hard", "warn"]);
const VERBS = new Set<string>(["click", "type", "scroll", "press_key", "submit_form"]);
const STATES = new Set(["checked", "enabled", "visible", "focused", "disabled"]);

export function parsePolicy(yamlText: string): PolicyDocument {
  let raw: unknown;
  try {
    raw = yamlLoad(yamlText);
  } catch (e) {
    if (e instanceof YAMLException) throw new PolicyParseError(`Invalid YAML: ${e.message}`, e);
    throw e;
  }
  if (raw == null) return {};
  if (typeof raw !== "object") throw new PolicyParseError("Policy root must be a YAML mapping");
  const r = raw as Record<string, unknown>;

  const doc: PolicyDocument = {};
  if (typeof r.flow === "string") doc.flow = r.flow;

  if (r.forbidden !== undefined) {
    if (!Array.isArray(r.forbidden)) throw new PolicyParseError("`forbidden` must be a list");
    doc.forbidden = r.forbidden.map((row, i) => parseForbidden(row, i));
  }
  if (r.required_before !== undefined) {
    if (!Array.isArray(r.required_before)) throw new PolicyParseError("`required_before` must be a list");
    doc.required_before = r.required_before.map((row, i) => parseRequiredBefore(row, i));
  }
  if (r.allow_domains !== undefined) doc.allow_domains = parseStringList(r.allow_domains, "allow_domains");
  if (r.deny_domains !== undefined) doc.deny_domains = parseStringList(r.deny_domains, "deny_domains");
  return doc;
}

function parseForbidden(raw: unknown, i: number): ForbiddenRule {
  if (!raw || typeof raw !== "object") throw new PolicyParseError(`forbidden[${i}] must be a mapping`);
  const r = raw as Record<string, unknown>;
  const hasMatch = (typeof r.role === "string" && typeof r.name_matches === "string") || typeof r.selector === "string";
  if (!hasMatch) {
    throw new PolicyParseError(`forbidden[${i}] must specify either {role, name_matches} or {selector}`);
  }
  if (typeof r.severity !== "string") {
    throw new PolicyParseError(`forbidden[${i}] is missing severity`);
  }
  if (!SEVERITIES.has(r.severity as Severity)) {
    throw new PolicyParseError(`forbidden[${i}] severity must be 'hard' or 'warn', got ${JSON.stringify(r.severity)}`);
  }
  if (r.on !== undefined && (typeof r.on !== "string" || !VERBS.has(r.on))) {
    throw new PolicyParseError(`forbidden[${i}] 'on' must be one of ${[...VERBS].join(", ")}`);
  }
  return {
    ...(typeof r.role === "string" ? { role: r.role } : {}),
    ...(typeof r.name_matches === "string" ? { name_matches: r.name_matches } : {}),
    ...(typeof r.selector === "string" ? { selector: r.selector } : {}),
    ...(typeof r.on === "string" ? { on: r.on as Verb } : {}),
    severity: r.severity as Severity,
    ...(typeof r.message === "string" ? { message: r.message } : {}),
  };
}

function parseRequiredBefore(raw: unknown, i: number): RequiredBeforeRule {
  if (!raw || typeof raw !== "object") throw new PolicyParseError(`required_before[${i}] must be a mapping`);
  const r = raw as Record<string, unknown>;
  if (typeof r.action !== "string" || !VERBS.has(r.action)) {
    throw new PolicyParseError(`required_before[${i}] action must be one of ${[...VERBS].join(", ")}`);
  }
  if (!Array.isArray(r.prereq)) throw new PolicyParseError(`required_before[${i}] prereq must be a list`);
  const prereq: PrereqClause[] = r.prereq.map((p, j) => {
    if (!p || typeof p !== "object") throw new PolicyParseError(`required_before[${i}].prereq[${j}] must be a mapping`);
    const x = p as Record<string, unknown>;
    if (typeof x.role !== "string" || typeof x.name_matches !== "string" || typeof x.state !== "string") {
      throw new PolicyParseError(`required_before[${i}].prereq[${j}] needs role + name_matches + state`);
    }
    if (!STATES.has(x.state)) {
      throw new PolicyParseError(`required_before[${i}].prereq[${j}] state must be one of ${[...STATES].join(", ")}`);
    }
    return { role: x.role, name_matches: x.name_matches, state: x.state as PrereqClause["state"] };
  });
  return { action: r.action as RequiredBeforeRule["action"], prereq };
}

function parseStringList(raw: unknown, field: string): string[] {
  if (!Array.isArray(raw)) throw new PolicyParseError(`${field} must be a list of strings`);
  return raw.map((x, i) => {
    if (typeof x !== "string") throw new PolicyParseError(`${field}[${i}] must be a string`);
    return x;
  });
}

// ─── Policy Matcher (Task 10) ─────────────────────────────────────────────────

export interface PolicyContext {
  verb: Verb;
  /** The node being acted on. `null` for press_key / window scroll. */
  node: SnapshotNode | null;
  snapshot: Snapshot;
}

export type PolicyOutcome =
  | { outcome: "allowed" }
  | { outcome: "warned"; warnings: Warning[] }
  | { outcome: "rejected"; reason: RejectionReason; message: string };

/**
 * Run policy rules in declaration order. Returns:
 *   - "rejected"  if any `severity: hard` rule matches, or if a domain rule denies,
 *                 or a required_before prereq is unsatisfied. First match wins.
 *   - "warned"    if no hard rules match but at least one `severity: warn` rule matches.
 *   - "allowed"   otherwise.
 *
 * Hard wins: a hard `forbidden` rule beats a matching `allow_domains` entry.
 */
export function evaluatePolicy(policy: PolicyDocument, ctx: PolicyContext): PolicyOutcome {
  const warnings: Warning[] = [];

  // 1. Forbidden — first hard match wins; warn matches are accumulated.
  for (const rule of policy.forbidden ?? []) {
    if (rule.on && rule.on !== ctx.verb) continue;
    if (!ruleMatchesNode(rule, ctx.node)) continue;
    if (rule.severity === "hard") {
      return {
        outcome: "rejected",
        reason: "policy_forbidden",
        message: rule.message ?? `Action blocked by policy rule (${rule.role ?? rule.selector}).`,
      };
    }
    warnings.push({ reason: "policy_warn", message: rule.message ?? "Policy warning." });
  }

  // 2. Required-before — check prereqs in the snapshot.
  for (const rb of policy.required_before ?? []) {
    if (rb.action !== ctx.verb && !(rb.action === "submit_form" && ctx.verb === "click" && isSubmitButton(ctx.node))) {
      continue;
    }
    for (const prereq of rb.prereq) {
      if (!prereqSatisfied(prereq, ctx.snapshot)) {
        return {
          outcome: "rejected",
          reason: "policy_required_before",
          message: `Prerequisite not met: ${prereq.role} matching ${prereq.name_matches} must be ${prereq.state}.`,
        };
      }
    }
  }

  // 3. Domains — deny unless allow matches.
  const host = hostnameOf(ctx.snapshot.url);
  if (host) {
    const denied = (policy.deny_domains ?? []).some((g) => globMatches(g, host));
    const allowed = (policy.allow_domains ?? []).some((g) => globMatches(g, host));
    if (denied && !allowed) {
      return {
        outcome: "rejected",
        reason: "policy_domain_denied",
        message: `Domain ${host} is not in allow_domains.`,
      };
    }
  }

  return warnings.length ? { outcome: "warned", warnings } : { outcome: "allowed" };
}

/**
 * Compile a regex pattern that may use the `(?i)` prefix (Python/YAML convention)
 * or inline JS flags. Strips `(?i)` and applies the `i` flag instead.
 */
function compilePattern(source: string): RegExp | null {
  try {
    if (source.startsWith("(?i)")) {
      return new RegExp(source.slice(4), "i");
    }
    return new RegExp(source);
  } catch {
    return null;
  }
}

function ruleMatchesNode(rule: ForbiddenRule, node: SnapshotNode | null): boolean {
  if (!node) return false;
  if (rule.selector) {
    // v0 cannot evaluate CSS against snapshot nodes — SiteGraphRow.current_css is null in v0.
    // Always non-matching for now; v0.1 fills this in.
    return false;
  }
  if (rule.role && rule.role !== node.r) return false;
  if (rule.name_matches) {
    const re = compilePattern(rule.name_matches);
    if (!re || !re.test(node.n)) return false;
  }
  return true;
}

function prereqSatisfied(prereq: PrereqClause, snapshot: Snapshot): boolean {
  const re = compilePattern(prereq.name_matches);
  if (!re) return false;
  const hit = findNode(snapshot.root, (n) => n.r === prereq.role && re.test(n.n));
  if (!hit) return false;
  switch (prereq.state) {
    case "checked": return hit.s.includes("c");
    case "enabled": return hit.s.includes("e");
    case "visible": return hit.s.includes("v");
    case "focused": return hit.s.includes("f");
    case "disabled": return hit.s.includes("d");
  }
}

function findNode(node: SnapshotNode, pred: (n: SnapshotNode) => boolean): SnapshotNode | null {
  if (pred(node)) return node;
  for (const c of node.c ?? []) {
    const hit = findNode(c, pred);
    if (hit) return hit;
  }
  return null;
}

function isSubmitButton(node: SnapshotNode | null): boolean {
  return !!node && node.r === "button" && /\bsubmit\b/i.test(node.n);
}

function hostnameOf(url: string): string | null {
  try { return new URL(url).hostname; } catch { return null; }
}

/**
 * Tiny glob matcher: '*' matches one DNS label or any sequence depending on
 * position. Specifically:
 *   - "*"            → match anything
 *   - "*.foo.com"    → match only subdomains of foo.com (NOT foo.com itself)
 *   - "foo.com"      → exact host match
 *   - "*foo*.com"    → contains-foo and ends-with .com
 * Compiles to anchored RegExp.
 */
export function globMatches(pattern: string, host: string): boolean {
  if (pattern === "*") return true;
  if (pattern.startsWith("*.")) {
    const rest = pattern.slice(2).replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^[^.]+\\.${rest}$|^([^.]+\\.)+${rest}$`);
    return re.test(host);
  }
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(host);
}
