import type { Snapshot } from "../snapshot/types.js";
import { locateLoginFields } from "./login-locator.js";

export interface LoginInput {
  username: string;
  password: string;
  /** Pre-computed 6-digit TOTP code. Caller generates from the secret. */
  totp_code?: string;
}

export type LoginReason =
  | "login_form_not_found"
  | "login_did_not_advance"
  | "watchdog_rejected"
  | "totp_field_not_found";

export type LoginResult =
  | { ok: true; url_before: string; url_after: string }
  | { ok: false; reason: LoginReason; detail?: unknown };

/**
 * Minimal action result shape. Defined locally to avoid circular imports
 * with session.ts (which will import login-flow.ts).
 * `ActionFail` uses a narrow required shape compatible with both RejectionEnvelope
 * and simple `{ok: false, reason: string}` returns.
 */
type ActionOk = { ok: true; warnings: unknown[] };
type ActionFail = { ok: false; reason: string };
type LocalActionResult = ActionOk | ActionFail;

/**
 * Minimal session shape the login flow needs. Lets us test with fakes
 * without dragging in the full Session class.
 */
export interface SessionLike {
  snapshot(): Promise<Snapshot>;
  type(stable_id: string, text: string): Promise<LocalActionResult>;
  click(stable_id: string): Promise<LocalActionResult>;
  pressKey?(key: string): Promise<LocalActionResult>;
}

/**
 * Drive a login flow on the current page:
 *   1. Snapshot the page; locate username/password/submit/totp fields
 *   2. Type username, password, optional TOTP (if both field and code present)
 *   3. Click submit
 *   4. Re-snapshot; declare success if URL changed OR no password field remains
 *
 * Returns `{ok: true}` only when both username and password fields existed
 * and the post-action snapshot suggests login advanced. Watchdog rejections
 * surface as `watchdog_rejected`.
 */
export async function performLogin(session: SessionLike, input: LoginInput): Promise<LoginResult> {
  const before = await session.snapshot();
  const fields = locateLoginFields(before);

  // Two flows supported in v0:
  //   (a) Combined form: username + password + submit all on one page.
  //   (b) Already on a 2FA-only prompt: only totp + submit.
  // Two-page split flows (Google/Microsoft/Okta) are M8c.
  if (!fields.username || !fields.password || !fields.submit) {
    if (fields.totp && input.totp_code && fields.submit) {
      return await handleTotpOnly(session, input.totp_code, before, fields);
    }
    return { ok: false, reason: "login_form_not_found" };
  }

  const u = await session.type(fields.username.i, input.username);
  if (!u.ok) return { ok: false, reason: "watchdog_rejected", detail: u };

  const p = await session.type(fields.password.i, input.password);
  if (!p.ok) return { ok: false, reason: "watchdog_rejected", detail: p };

  if (fields.totp && input.totp_code) {
    const t = await session.type(fields.totp.i, input.totp_code);
    if (!t.ok) return { ok: false, reason: "watchdog_rejected", detail: t };
  }

  const c = await session.click(fields.submit.i);
  if (!c.ok) return { ok: false, reason: "watchdog_rejected", detail: c };

  let after = await session.snapshot();
  const url_before = before.url;
  let url_after = after.url;

  // Belt-and-suspenders: some engines (e.g. lightpanda) don't fire form submit
  // via a click on <button type="submit">. If URL didn't change and the password
  // field is still on-page, fall back to pressing Enter on the password field.
  if (url_before === url_after && locateLoginFields(after).password && session.pressKey) {
    await session.pressKey("Enter");
    after = await session.snapshot();
    url_after = after.url;
  }

  if (url_before !== url_after) {
    const afterFields = locateLoginFields(after);
    if (afterFields.totp && input.totp_code && afterFields.submit) {
      return await handleTotpOnly(session, input.totp_code, after, afterFields);
    }
    return { ok: true, url_before, url_after };
  }

  // URL didn't change but password field gone → likely XHR/SPA login.
  const afterFields = locateLoginFields(after);
  if (!afterFields.password) {
    return { ok: true, url_before, url_after };
  }

  return { ok: false, reason: "login_did_not_advance" };
}

async function handleTotpOnly(
  session: SessionLike,
  code: string,
  current: Snapshot,
  fields: ReturnType<typeof locateLoginFields>
): Promise<LoginResult> {
  if (!fields.totp || !fields.submit) {
    return { ok: false, reason: "totp_field_not_found" };
  }
  const t = await session.type(fields.totp.i, code);
  if (!t.ok) return { ok: false, reason: "watchdog_rejected", detail: t };
  const c = await session.click(fields.submit.i);
  if (!c.ok) return { ok: false, reason: "watchdog_rejected", detail: c };
  const after = await session.snapshot();
  if (after.url !== current.url || !locateLoginFields(after).password) {
    return { ok: true, url_before: current.url, url_after: after.url };
  }
  return { ok: false, reason: "login_did_not_advance" };
}
