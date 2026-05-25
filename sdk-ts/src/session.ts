import type { JsonRpcClient } from "./transport.js";
import type {
  ActionResultWithSnapshot,
  Snapshot,
  SnapshotDiff,
  LoginResult,
  WaitForCondition,
  WaitForResult,
  UploadResult,
  PaginateOpts,
  PaginateResult,
  HandoffPasteResult,
  HandoffSeamlessResult,
  Outcome,
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

  async scroll(
    target: Target & { include_snapshot?: boolean },
    direction?: ScrollDirection,
    amount?: number,
    opts?: {
      until?: import("./types.js").WaitForCondition;
      max_scrolls?: number;
      scroll_amount_px?: number;
    },
  ): Promise<ActionResultWithSnapshot> {
    return await this.client.call<ActionResultWithSnapshot>("scroll", {
      session_id: this.id,
      ...target,
      direction,
      amount,
      ...opts,
    });
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
   * Extract text from the page. Three modes:
   *
   * - `{css}` → single selector, returns `string | null`.
   * - `{selectors}` → multi-field map, returns `{key: text | null}`. One round-trip.
   * - `{css|selectors, paginate}` → extracts across multiple pages using a click-next
   *   loop. Returns `{pages, total_pages, stopped_reason}`.
   *
   * DO NOT manually loop extract + click — pass `paginate` instead.
   */
  async extract(input: { css: string }): Promise<string | null>;
  async extract(input: { selectors: Record<string, string> }): Promise<Record<string, string | null>>;
  async extract(input: { css: string; paginate: PaginateOpts }): Promise<PaginateResult>;
  async extract(input: { selectors: Record<string, string>; paginate: PaginateOpts }): Promise<PaginateResult>;
  async extract(
    input:
      | { css: string; paginate?: PaginateOpts }
      | { selectors: Record<string, string>; paginate?: PaginateOpts }
  ): Promise<string | null | Record<string, string | null> | PaginateResult> {
    const result = await this.client.call<any>("extract", { session_id: this.id, ...input });
    // Paginate mode returns pages/total_pages/stopped_reason directly.
    if ("pages" in result) return result as PaginateResult;
    return result.result ?? result.text ?? result;
  }

  /**
   * Handle a pending JS dialog (alert/confirm/prompt/beforeunload).
   * No-op when no dialog is open. Auto-dismiss handles 99% of cases;
   * use this when you need to explicitly accept/respond (e.g. prompt dialogs).
   */
  async handleDialog(action: "accept" | "dismiss", text?: string): Promise<void> {
    await this.client.call("dialog", { session_id: this.id, action, text });
  }

  /**
   * Ask the human a question — NON-BLOCKING.
   * Returns immediately with {pending, token, watch_url, surface}.
   * Relay surface.question (and surface.options if present) in your next chat message.
   */
  async askHuman(input: { question: string; options?: string[]; timeout_ms?: number }): Promise<{
    pending: true;
    token: string;
    watch_url: string | null;
    surface: { question: string; options?: string[] };
  }> {
    return await this.client.call("ask_human", { session_id: this.id, ...input });
  }

  /**
   * Pause the session and hand control to the human.
   *
   * Two modes:
   *   - **seamless** (default when need_cookies_back:true): spawns the user's real
   *     Chrome at `target_url`, waits for login to complete, and imports cookies
   *     automatically. BLOCKS until done or timeout. Returns `HandoffSeamlessResult`.
   *   - **paste** (fallback / explicit): returns immediately with
   *     `{pending: true, token, handoff_url, surface}`. User pastes cookies via
   *     bookmarklet/devtools. Returns `HandoffPasteResult`.
   *
   * If seamless returns `{reason: "chrome_not_found"}`, re-call with mode:"paste".
   */
  async handoff(input: {
    reason: string;
    suggested_action?: string;
    need_cookies_back?: boolean;
    mode?: "seamless" | "paste";
    target_url?: string;
    timeout_ms?: number;
  }): Promise<HandoffPasteResult | HandoffSeamlessResult> {
    return await this.client.call("handoff", { session_id: this.id, ...input });
  }

  /**
   * Record a human answer or resume a paused handoff (agent-side relay).
   *
   * Call this when the user replied in chat rather than via the Watch UI.
   * Whichever surface fires first wins — the other will observe "resolved".
   *
   * For questions: pass `answer` (free-form) or `index` (when options were offered).
   * For handoffs: pass optional `cookies` and/or `note`. After this call the session
   * is unpaused and the next husk_* action call will succeed.
   */
  async resume(input: {
    token: string;
    answer?: string;
    index?: number;
    cookies?: Array<{ name: string; value: string; domain?: string; raw?: string }>;
    note?: string;
  }): Promise<{ ok: true; kind: "question" | "handoff" } | { ok: false; reason: "unknown_token" }> {
    return await this.client.call("resume", input);
  }

  /**
   * Execute a named intention against the current page state.
   *
   * The orchestrator resolves the intention from the site's intention graph,
   * plans a path through the state graph, executes each transition's action
   * sequence, runs verify predicates, and returns an Outcome envelope.
   *
   * @param args.intention_name  Name of the intention to execute (e.g. "visit_b").
   * @param args.args            Optional key-value arguments interpolated into steps.
   * @param args.site            Override site key (defaults to current URL hostname).
   */
  async intend<T = unknown>(args: {
    intention_name: string;
    args?: Record<string, unknown>;
    site?: string;
  }): Promise<Outcome<T>> {
    return await this.client.call<Outcome<T>>("intend", {
      session_id: this.id,
      intention_name: args.intention_name,
      args: args.args,
      site: args.site,
    });
  }

  async close(): Promise<void> {
    await this.client.call("close_session", { session_id: this.id });
  }
}
