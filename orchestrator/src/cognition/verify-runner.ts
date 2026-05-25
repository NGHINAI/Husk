import type { VerifyCheck, Evidence, RetryOptions } from "./intention-types.js";
import { evaluate, collectAllText } from "./predicate.js";
import type { SnapshotForPredicate } from "./predicate.js";

export interface NetworkEntry {
  method: string;
  url: string;
  status?: number;
  ts: number;
}

export interface VerifyContext {
  currentUrl: string;
  snapshot: SnapshotForPredicate;
  network?: NetworkEntry[];   // recent requests; undefined when not tracked
}

function evalTextPresent(check: VerifyCheck & { type: "text_present" | "text_absent" }, ctx: VerifyContext): Evidence {
  const text = collectAllText(ctx.snapshot.root);
  let passed = false;
  let observed: string | undefined;
  try {
    const re = new RegExp(check.pattern, "i");
    const match = re.exec(text);
    if (check.type === "text_present") {
      passed = match !== null;
      observed = match?.[0];
    } else {
      // text_absent
      passed = match === null;
    }
  } catch {
    passed = false;
  }
  return {
    predicate: check.description,
    passed,
    observed_value: observed,
    ts: Date.now(),
    source: "text",
    severity: "block",
  };
}

export function runVerify(check: VerifyCheck, ctx: VerifyContext): Evidence {
  if (check.type === "text_present" || check.type === "text_absent") {
    return evalTextPresent(check, ctx);
  }
  if (check.type === "predicate") {
    const passed = evaluate(check.predicate, ctx.snapshot);
    return { predicate: check.description, passed, ts: Date.now(), source: "predicate", severity: "block" };
  }
  if (check.type === "url") {
    const re = new RegExp(check.pattern);
    const passed = re.test(ctx.currentUrl);
    return { predicate: check.description, passed, observed_value: ctx.currentUrl, ts: Date.now(), source: "url", severity: "block" };
  }
  if (check.type === "network") {
    const entries = ctx.network ?? [];
    const re = new RegExp(check.url_pattern);
    const match = entries.find((e) => {
      if (check.method && e.method.toUpperCase() !== check.method) return false;
      if (!re.test(e.url)) return false;
      if (check.status_min !== undefined && (e.status ?? 0) < check.status_min) return false;
      if (check.status_max !== undefined && (e.status ?? 999) > check.status_max) return false;
      return true;
    });
    return {
      predicate: check.description,
      passed: match !== undefined,
      observed_value: match,
      ts: Date.now(),
      source: "network",
      severity: "block",
    };
  }
  return { predicate: "unknown check type", passed: false };
}

export function runAllVerify(checks: VerifyCheck[], ctx: VerifyContext): Evidence[] {
  return checks.map((c) => runVerify(c, ctx));
}

// Default retry budget when a check declares retry: {} with no fields.
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_INTERVAL_MS = 250;
const DEFAULT_MAX_ATTEMPTS = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run a verify check with retry-until-pass semantics.
 *
 * Continues polling until any of:
 *   - the check passes (returns the passing Evidence with attempts counter)
 *   - timeout_ms elapsed
 *   - max_attempts reached
 *
 * The contextFactory is called fresh each attempt — pass a function that
 * re-snapshots / re-collects network state so polling sees the latest data.
 *
 * If neither check.retry nor options is provided, falls back to single-shot
 * (calls runVerify once) without annotating attempts.
 */
export async function runVerifyWithRetry(
  check: VerifyCheck,
  contextFactory: () => Promise<VerifyContext>,
  options?: RetryOptions,
): Promise<Evidence> {
  const retryConfig = check.retry ?? options;
  if (!retryConfig) {
    // No retry policy — fall back to single-shot (no attempts annotation).
    const ctx = await contextFactory();
    return runVerify(check, ctx);
  }

  const timeout = retryConfig.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const interval = retryConfig.interval_ms ?? DEFAULT_INTERVAL_MS;
  const maxAttempts = retryConfig.max_attempts ?? DEFAULT_MAX_ATTEMPTS;

  const start = Date.now();
  let attempts = 0;
  let lastEv: Evidence | null = null;

  while (true) {
    attempts++;
    const ctx = await contextFactory();
    const ev = runVerify(check, ctx);
    lastEv = ev;
    if (ev.passed) {
      return { ...ev, attempts, ts: Date.now() };
    }
    if (attempts >= maxAttempts) break;
    if (Date.now() - start + interval >= timeout) break;
    await sleep(interval);
  }

  // Exhausted: return last result with attempts annotation.
  return { ...(lastEv as Evidence), attempts, ts: Date.now() };
}

/**
 * Run all verify checks with retry semantics (serial — each check uses the
 * full retry budget independently). contextFactory is called fresh per attempt
 * of each check.
 */
export async function runAllVerifyWithRetry(
  checks: VerifyCheck[],
  contextFactory: () => Promise<VerifyContext>,
): Promise<Evidence[]> {
  const evidence: Evidence[] = [];
  for (const c of checks) {
    evidence.push(await runVerifyWithRetry(c, contextFactory));
  }
  return evidence;
}
