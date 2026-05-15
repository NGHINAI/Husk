import type { Snapshot, SnapshotNode } from "../snapshot/types.js";

export interface LoginFields {
  /** Username/email field (textbox/combobox/searchbox). */
  username: SnapshotNode | null;
  /** Password field. Required for a login flow. */
  password: SnapshotNode | null;
  /** Submit button (or button-like). */
  submit: SnapshotNode | null;
  /** Optional TOTP / 2FA code field. */
  totp: SnapshotNode | null;
}

const USERNAME_RE = /\b(user(name)?|e[\s-]?mail|login|account|handle|sign[\s-]?in)\b/i;
const PASSWORD_RE = /\bpassword\b/i;
const SUBMIT_PRIMARY_RE = /\b(sign\s?in|log\s?in|submit)\b/i;
const SUBMIT_FALLBACK_RE = /\b(verify|continue|next|enter|proceed)\b/i;
const TOTP_RE = /\b(one[\s-]?time|2fa|two[\s-]?factor|authenticator|verification|tot[pj]|code)\b/i;

const USERNAME_ROLES = new Set(["textbox", "combobox", "searchbox"]);

function walk(node: SnapshotNode, visit: (n: SnapshotNode) => void): void {
  visit(node);
  for (const c of node.c ?? []) walk(c, visit);
}

function isEnabledVisible(n: SnapshotNode): boolean {
  return n.s.includes("v") && !n.s.includes("d");
}

export function locateLoginFields(snapshot: Snapshot): LoginFields {
  const textboxes: SnapshotNode[] = [];
  const buttons: SnapshotNode[] = [];
  walk(snapshot.root, (n) => {
    if (USERNAME_ROLES.has(n.r)) textboxes.push(n);
    else if (n.r === "button") buttons.push(n);
  });

  const password = textboxes.find((n) => PASSWORD_RE.test(n.n)) ?? null;
  let username = textboxes.find((n) => n !== password && USERNAME_RE.test(n.n)) ?? null;
  if (!username && password) {
    username = textboxes.find((n) => n !== password && isEnabledVisible(n)) ?? null;
  }
  const totp = textboxes.find((n) => n !== password && n !== username && TOTP_RE.test(n.n)) ?? null;

  const primary = buttons.filter((b) => isEnabledVisible(b) && SUBMIT_PRIMARY_RE.test(b.n));
  const fallback = buttons.filter((b) => isEnabledVisible(b) && SUBMIT_FALLBACK_RE.test(b.n));
  const submit = primary[0] ?? fallback[0] ?? null;

  return { username, password, submit, totp };
}
