/**
 * bot-block-detector.ts
 *
 * Post-login bot-block detection. After an automated login attempt fails,
 * the caller snapshots the page and passes it here to distinguish:
 *
 *   (A) Bot-block: site detected automation and rendered a challenge/error
 *       page instead of accepting the credentials. Escalation to a seamless
 *       handoff is warranted.
 *
 *   (B) Real credential failure: the site accepted the form submission and
 *       replied with "wrong password". The login page re-rendered with an
 *       intact form. No escalation — the user needs to supply correct creds.
 *
 * Detection heuristics (any one fires → is_blocked = true):
 *   1. M17 page-health markers (polyfill gaps, empty AX on rich site, etc.)
 *   2. Login-block text patterns ("Ha habido un problema", "verify your account", ...)
 *   3. Still on a login/challenge URL AND no usable form found
 */

import type { Snapshot } from "../snapshot/types.js";
import { detectPageHealth } from "../engine/page-health.js";

const LOGIN_BLOCK_TEXT_PATTERNS: RegExp[] = [
  /ha habido un problema/i,
  /try again/i,
  /something went wrong/i,
  /unusual activity/i,
  /verify your account/i,
  /verify your identity/i,
  /complete the captcha/i,
  /confirm you'?re not a robot/i,
  /are you human/i,
];

export const LOGIN_URL_PATTERNS: RegExp[] = [
  /\/login/i,
  /\/signin/i,
  /\/sign-in/i,
  /\/auth/i,
  /\/challenge/i,
  /\/verify/i,
  /\/checkpoint/i,
  /\/captcha/i,
];

export interface BotBlockVerdict {
  is_blocked: boolean;
  reasons: string[];
  /** The URL we'd send to seamless handoff. */
  login_url: string;
}

interface AxNode { n?: string; c?: unknown[] }

function flattenText(node: AxNode | undefined): string {
  if (!node) return "";
  let t = node.n ?? "";
  if (Array.isArray(node.c)) {
    for (const c of node.c) t += " " + flattenText(c as AxNode);
  }
  return t;
}

export function detectLoginBotBlock(snapshot: Snapshot): BotBlockVerdict {
  const reasons: string[] = [];
  const url = snapshot.url ?? "";

  // Heuristic 1: M17 page-health markers (polyfill gaps, empty AX on rich site, etc.)
  const health = detectPageHealth(snapshot);
  if (health.should_fallback) {
    for (const r of health.reasons) {
      reasons.push(`page_health:${r}`);
    }
  }

  // Heuristic 2: login-specific block text in the page content
  const text = flattenText(snapshot.root as AxNode);
  for (const pat of LOGIN_BLOCK_TEXT_PATTERNS) {
    if (pat.test(text)) {
      reasons.push(`block_text:${pat.source.slice(0, 30)}`);
      break; // one text match is enough
    }
  }

  // Heuristic 3: URL is still on a login/challenge path AND there is no
  // usable form (form re-render with intact fields = real cred failure, not bot-block)
  const onLoginPath = LOGIN_URL_PATTERNS.some((re) => re.test(url));
  if (onLoginPath && (snapshot.forms?.length ?? 0) === 0) {
    reasons.push("login_url_no_form");
  }

  return {
    is_blocked: reasons.length > 0,
    reasons: [...new Set(reasons)],
    login_url: url,
  };
}
