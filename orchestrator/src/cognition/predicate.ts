/**
 * Predicate language evaluator for Husk v0.1 Phase A (M18 Task 2).
 *
 * Pure function — no IO, no state, no side effects.
 * Never throws on malformed predicates or snapshots; returns false gracefully.
 *
 * Primitives (9):
 *   url_pattern    — regex against the page URL (case-sensitive on path)
 *   ax_role_name   — find AX node with matching role + optional name/name_regex
 *   ax_text_match  — regex over all visible text in the AX tree (case-insensitive)
 *   network_recent — match URL pattern + optional method + status in network ring buffer
 *   cookies_contain — cookie name + optional value regex
 *   forms_present  — min_fields count + optional required field_types
 *   and            — all sub-predicates must pass (vacuous truth for empty)
 *   or             — any sub-predicate must pass (vacuous false for empty)
 *   not            — sub-predicate must fail
 */

import type { Predicate } from "./types.js";

// ---------------------------------------------------------------------------
// SnapshotForPredicate — minimal subset of the M14 Snapshot shape
// ---------------------------------------------------------------------------

/** A single AX property — name + value. Matches CDP Accessibility.AXProperty shape. */
export interface AxState {
  name: string; // "disabled" | "checked" | "expanded" | "selected" | "focused" | "required" | ...
  value?: { type?: string; value?: unknown };
}

/** A single node in the compressed AX tree (matches SnapshotNode from M14). */
export interface AxTreeNode {
  /** Stable ID */
  i: string;
  /** ARIA role */
  r: string;
  /** Accessible name */
  n: string;
  /** Children */
  c?: AxTreeNode[];
  /** AX state properties (optional — may be absent in synthetic snapshots). */
  s?: AxState[];
}

/**
 * The subset of a Snapshot that the predicate evaluator operates on.
 * Intentionally narrower than the full Snapshot — extra fields are ignored.
 */
export interface SnapshotForPredicate {
  url: string;
  root: AxTreeNode;
  network?: {
    recent: Array<{
      url: string;
      method: string;
      status?: number;
      content_type?: string;
    }>;
  };
  forms?: Array<{
    fields: Array<{ type: string; name?: string }>;
  }>;
  cookies?: Array<{ name: string; value: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compile a regex string safely; returns null on invalid pattern. */
function safeRegex(pattern: string, flags = ""): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

/**
 * Walk the AX tree depth-first, yielding every node.
 * Avoids deep recursion issues by using an explicit stack.
 */
function* walkTree(node: AxTreeNode): Generator<AxTreeNode> {
  const stack: AxTreeNode[] = [node];
  while (stack.length > 0) {
    const current = stack.pop()!;
    yield current;
    if (current.c && current.c.length > 0) {
      // Push in reverse so left-most child is processed first
      for (let i = current.c.length - 1; i >= 0; i--) {
        stack.push(current.c[i]);
      }
    }
  }
}

/** Collect all accessible names from every node in the tree. */
export function collectAllText(root: AxTreeNode): string {
  const parts: string[] = [];
  for (const node of walkTree(root)) {
    if (node.n) {
      parts.push(node.n);
    }
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Primitive evaluators
// ---------------------------------------------------------------------------

function evalUrlPattern(pred: { type: "url_pattern"; regex: string }, snap: SnapshotForPredicate): boolean {
  const re = safeRegex(pred.regex); // URL matching is case-sensitive (no "i" flag)
  if (!re) return false;
  return re.test(snap.url);
}

function evalAxRoleName(
  pred: { type: "ax_role_name"; role: string; name?: string; name_regex?: string },
  snap: SnapshotForPredicate
): boolean {
  const roleToFind = pred.role.toLowerCase();
  const exactName = pred.name;
  const nameRegexStr = pred.name_regex;

  // Compile name_regex upfront; bail early if invalid
  let nameRe: RegExp | null = null;
  if (nameRegexStr !== undefined) {
    nameRe = safeRegex(nameRegexStr, "i");
    if (!nameRe) return false; // Invalid regex → false
  }

  for (const node of walkTree(snap.root)) {
    if (node.r.toLowerCase() !== roleToFind) continue;

    // Role matches — now check optional name constraints
    if (exactName !== undefined) {
      if (node.n.toLowerCase() !== exactName.toLowerCase()) continue;
    }

    if (nameRe !== null) {
      if (!nameRe.test(node.n)) continue;
    }

    return true; // Found a matching node
  }
  return false;
}

function evalAxTextMatch(pred: { type: "ax_text_match"; regex: string }, snap: SnapshotForPredicate): boolean {
  const re = safeRegex(pred.regex, "i"); // case-insensitive text matching
  if (!re) return false;
  const text = collectAllText(snap.root);
  return re.test(text);
}

function evalNetworkRecent(
  pred: { type: "network_recent"; url_pattern: string; method?: string; status?: number },
  snap: SnapshotForPredicate
): boolean {
  if (!snap.network || snap.network.recent.length === 0) return false;

  const urlRe = safeRegex(pred.url_pattern, "i"); // URL pattern is case-insensitive
  if (!urlRe) return false;

  const methodFilter = pred.method?.toUpperCase();
  const statusFilter = pred.status;

  for (const entry of snap.network.recent) {
    if (!urlRe.test(entry.url)) continue;
    if (methodFilter !== undefined && entry.method.toUpperCase() !== methodFilter) continue;
    if (statusFilter !== undefined && entry.status !== statusFilter) continue;
    return true;
  }
  return false;
}

function evalCookiesContain(
  pred: { type: "cookies_contain"; name: string; value_regex?: string },
  snap: SnapshotForPredicate
): boolean {
  if (!snap.cookies || snap.cookies.length === 0) return false;

  let valueRe: RegExp | null = null;
  if (pred.value_regex !== undefined) {
    valueRe = safeRegex(pred.value_regex, "i");
    if (!valueRe) return false; // invalid regex
  }

  for (const cookie of snap.cookies) {
    if (cookie.name !== pred.name) continue;
    if (valueRe !== null && !valueRe.test(cookie.value)) continue;
    return true;
  }
  return false;
}

function evalFormsPresent(
  pred: { type: "forms_present"; min_fields?: number; field_types?: string[] },
  snap: SnapshotForPredicate
): boolean {
  if (!snap.forms || snap.forms.length === 0) return false;

  const minFields = pred.min_fields ?? 1;
  const requiredTypes = pred.field_types;

  for (const form of snap.forms) {
    const fields = form.fields;

    // Check minimum field count
    if (fields.length < minFields) continue;

    // Check that all required field_types appear in this form
    if (requiredTypes !== undefined) {
      const presentTypes = new Set(fields.map((f) => f.type.toLowerCase()));
      const allPresent = requiredTypes.every((t) => presentTypes.has(t.toLowerCase()));
      if (!allPresent) continue;
    }

    return true; // This form satisfies all constraints
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main evaluate() function
// ---------------------------------------------------------------------------

/**
 * Evaluate a predicate against a snapshot.
 *
 * @returns true if the snapshot matches the predicate, false otherwise.
 *          Never throws — malformed predicates and missing snapshot fields
 *          are handled gracefully.
 */
export function evaluate(predicate: Predicate, snapshot: SnapshotForPredicate): boolean {
  try {
    switch (predicate.type) {
      case "url_pattern":
        return evalUrlPattern(predicate, snapshot);

      case "ax_role_name":
        return evalAxRoleName(predicate, snapshot);

      case "ax_text_match":
        return evalAxTextMatch(predicate, snapshot);

      case "network_recent":
        return evalNetworkRecent(predicate, snapshot);

      case "cookies_contain":
        return evalCookiesContain(predicate, snapshot);

      case "forms_present":
        return evalFormsPresent(predicate, snapshot);

      case "and":
        // Vacuous truth: empty AND = true
        return predicate.all.every((sub) => evaluate(sub, snapshot));

      case "or":
        // Vacuous false: empty OR = false
        return predicate.any.some((sub) => evaluate(sub, snapshot));

      case "not":
        return !evaluate(predicate.not, snapshot);

      default:
        // Unknown predicate type — return false gracefully
        return false;
    }
  } catch {
    // Catch-all: any unexpected error → false (never throw to callers)
    return false;
  }
}
