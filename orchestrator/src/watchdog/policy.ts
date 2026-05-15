import { load as yamlLoad, YAMLException } from "js-yaml";
import type {
  ForbiddenRule,
  PolicyDocument,
  PrereqClause,
  RequiredBeforeRule,
  Severity,
  Verb,
} from "./types.js";

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
