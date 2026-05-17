import type { JsonRpcClient } from "./transport.js";
import type {
  ActionResult,
  ActionResultWithSnapshot,
  Snapshot,
  SnapshotDiff,
  LoginResult,
  WaitForCondition,
  WaitForResult,
  UploadResult,
} from "./types.js";

export type ScrollDirection = "up" | "down" | "left" | "right" | "into_view";

/**
 * Target specifier for action methods. Pass EITHER `stable_id` (exact, from
 * snapshot) OR `intent` (natural language, e.g. "sign in button").
 * For scroll, `stable_id` may be null for window-level scroll.
 */
export type Target = { stable_id?: string | null; intent?: string };

/**
 * Per-session API. One instance per session_id. All methods are thin
 * wrappers over the JSON-RPC server — no client-side state aside from
 * the id.
 */
export class Session {
  constructor(private readonly client: JsonRpcClient, public readonly id: string) {}

  async goto(url: string, opts: { include_snapshot?: boolean } = {}): Promise<{ ok: true; snapshot?: Snapshot }> {
    return await this.client.call<{ ok: true; snapshot?: Snapshot }>("goto", { session_id: this.id, url, ...opts });
  }

  async snapshot(): Promise<Snapshot> {
    return await this.client.call<Snapshot>("snapshot", { session_id: this.id });
  }

  async snapshotDiff(): Promise<SnapshotDiff | null> {
    return await this.client.call<SnapshotDiff | null>("snapshot_diff", { session_id: this.id });
  }

  async click(target: Target & { include_snapshot?: boolean }): Promise<ActionResultWithSnapshot> {
    return await this.client.call<ActionResultWithSnapshot>("click", { session_id: this.id, ...target });
  }

  async type(target: Target & { include_snapshot?: boolean }, text: string): Promise<ActionResultWithSnapshot> {
    return await this.client.call<ActionResultWithSnapshot>("type", { session_id: this.id, ...target, text });
  }

  async scroll(target: Target & { include_snapshot?: boolean }, direction: ScrollDirection, amount: number): Promise<ActionResultWithSnapshot> {
    return await this.client.call<ActionResultWithSnapshot>("scroll", { session_id: this.id, ...target, direction, amount });
  }

  async pressKey(key: string, opts: { include_snapshot?: boolean } = {}): Promise<ActionResultWithSnapshot> {
    return await this.client.call<ActionResultWithSnapshot>("press_key", { session_id: this.id, key, ...opts });
  }

  async setPolicy(policy_yaml: string | null): Promise<void> {
    await this.client.call("set_policy", { session_id: this.id, policy_yaml });
  }

  /**
   * Log into a website. Two modes:
   *   A) Inline (ephemeral): `{ username, password, totp_secret? }` — creds
   *      are not persisted; useful for one-off automation or chat-driven flows.
   *   B) Stored lookup: `{ profile, key }` — reads previously-stored credentials
   *      from the credentials vault.
   *
   * Pass `include_snapshot: false` to opt out of the post-login snapshot.
   */
  async login(
    args:
      | { profile: string; key: string; include_snapshot?: boolean }
      | { username: string; password: string; totp_secret?: string; include_snapshot?: boolean }
  ): Promise<ActionResultWithSnapshot<LoginResult>> {
    return await this.client.call<ActionResultWithSnapshot<LoginResult>>("login", {
      session_id: this.id,
      ...args,
    });
  }

  async waitFor(c: WaitForCondition): Promise<WaitForResult> {
    return await this.client.call<WaitForResult>("wait_for", { session_id: this.id, ...c });
  }

  /**
   * Upload a file to an `<input type="file">` element.
   * Pass `{ stable_id }` or `{ intent }` to target the input.
   * File contents come from EITHER `{ file_path }` OR `{ content_base64, filename }`.
   * Pass `include_snapshot: false` to opt out of the post-upload snapshot.
   */
  async upload(
    target: { stable_id?: string; intent?: string; include_snapshot?: boolean },
    fileSpec: { file_path?: string; content_base64?: string; filename?: string },
  ): Promise<ActionResultWithSnapshot<UploadResult>> {
    return await this.client.call<ActionResultWithSnapshot<UploadResult>>("upload", { session_id: this.id, ...target, ...fileSpec });
  }

  /**
   * Extract text from the page.
   * Pass EITHER {css: string} for single selector (returns string|null),
   * OR {selectors: {key: css}} for multi-field extraction (returns {key: text|null}).
   * Multi-selector mode completes in one round-trip.
   */
  async extract(input: { css: string }): Promise<string | null>;
  async extract(input: { selectors: Record<string, string> }): Promise<Record<string, string | null>>;
  async extract(
    input: { css: string } | { selectors: Record<string, string> }
  ): Promise<string | null | Record<string, string | null>> {
    const result = await this.client.call<any>("extract", { session_id: this.id, ...input });
    return result.result ?? result.text ?? result;
  }

  async close(): Promise<void> {
    await this.client.call("close_session", { session_id: this.id });
  }
}
