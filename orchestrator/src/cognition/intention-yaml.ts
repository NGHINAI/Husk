import * as yaml from "js-yaml";
import type { Intention, IntentionStep, VerifyCheck, FailureModePattern } from "./intention-types.js";

/** Parse a YAML string into an Intention. Throws on structural errors. */
export function parseIntentionYaml(source: string, site: string): Intention {
  const doc = yaml.load(source);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("Intention YAML must be a mapping");
  }
  const d = doc as Record<string, unknown>;

  const name = requireString(d, "name");
  const argsSchema = (d.args_schema as Record<string, unknown> | undefined) ?? { type: "object" };
  const requiresState = d.requires_state as string | undefined;
  const stepsRaw = d.steps;
  if (!Array.isArray(stepsRaw)) throw new Error(`Intention "${name}" must have a steps array`);
  const steps = stepsRaw.map((s, i) => validateStep(s, name, i));
  const verifyRaw = (d.verify as unknown[] | undefined) ?? [];
  const verify = verifyRaw.map((v, i) => validateVerify(v, name, i));
  const failureRaw = (d.failure_modes as unknown[] | undefined) ?? [];
  const failure_modes = failureRaw.map((f, i) => validateFailureMode(f, name, i));

  const now = Date.now();
  return {
    site,
    name,
    args_schema: argsSchema,
    requires_state: requiresState,
    steps,
    verify,
    failure_modes,
    description: d.description as string | undefined,
    created_at: now,
    updated_at: now,
  };
}

function requireString(d: Record<string, unknown>, key: string): string {
  const v = d[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`Intention YAML missing required string "${key}"`);
  }
  return v;
}

function validateStep(s: unknown, intentName: string, idx: number): IntentionStep {
  if (!s || typeof s !== "object") throw new Error(`Intention "${intentName}" step ${idx} not an object`);
  const o = s as unknown as Record<string, unknown>;
  const verb = o.verb;
  if (typeof verb !== "string") throw new Error(`Step ${idx} missing "verb"`);
  const validVerbs = ["click", "type", "press_key", "scroll", "wait_for", "navigate", "snapshot"];
  if (!validVerbs.includes(verb)) throw new Error(`Step ${idx} has invalid verb "${verb}"`);
  return o as unknown as IntentionStep;
}

function validateVerify(v: unknown, intentName: string, idx: number): VerifyCheck {
  if (!v || typeof v !== "object") throw new Error(`Intention "${intentName}" verify ${idx} not an object`);
  const o = v as unknown as Record<string, unknown>;
  const type = o.type;
  if (type !== "predicate" && type !== "network" && type !== "url") {
    throw new Error(`Verify check ${idx} has invalid type "${type}"`);
  }
  return o as unknown as VerifyCheck;
}

function validateFailureMode(f: unknown, intentName: string, idx: number): FailureModePattern {
  if (!f || typeof f !== "object") throw new Error(`Intention "${intentName}" failure_mode ${idx} not an object`);
  const o = f as unknown as Record<string, unknown>;
  if (typeof o.reason !== "string") throw new Error(`failure_mode ${idx} missing "reason"`);
  if (!o.match || typeof o.match !== "object") throw new Error(`failure_mode ${idx} missing "match"`);
  return o as unknown as FailureModePattern;
}

/** Interpolate {{args.X}} template references in a string. */
export function interpolate(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{\{args\.([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (_, k) => {
    const v = args[k];
    if (v === undefined) throw new Error(`Template references missing arg "${k}"`);
    return String(v);
  });
}
