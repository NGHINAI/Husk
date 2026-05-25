import type { VerifyCheck, Evidence } from "./intention-types.js";
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
