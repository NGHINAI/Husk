import type { JsonRpcClient } from "./transport.js";
import type {
  ActionResult,
  Snapshot,
  SnapshotDiff,
} from "./types.js";

export type ScrollDirection = "up" | "down" | "left" | "right" | "into_view";

/**
 * Per-session API. One instance per session_id. All methods are thin
 * wrappers over the JSON-RPC server — no client-side state aside from
 * the id.
 */
export class Session {
  constructor(private readonly client: JsonRpcClient, public readonly id: string) {}

  async goto(url: string): Promise<void> {
    await this.client.call<{ ok: true }>("goto", { session_id: this.id, url });
  }

  async snapshot(): Promise<Snapshot> {
    return await this.client.call<Snapshot>("snapshot", { session_id: this.id });
  }

  async snapshotDiff(): Promise<SnapshotDiff | null> {
    return await this.client.call<SnapshotDiff | null>("snapshot_diff", { session_id: this.id });
  }

  async click(stable_id: string): Promise<ActionResult> {
    return await this.client.call<ActionResult>("click", { session_id: this.id, stable_id });
  }

  async type(stable_id: string, text: string): Promise<ActionResult> {
    return await this.client.call<ActionResult>("type", { session_id: this.id, stable_id, text });
  }

  async scroll(stable_id: string | null, direction: ScrollDirection, amount: number): Promise<ActionResult> {
    return await this.client.call<ActionResult>("scroll", { session_id: this.id, stable_id, direction, amount });
  }

  async pressKey(key: string): Promise<ActionResult> {
    return await this.client.call<ActionResult>("press_key", { session_id: this.id, key });
  }

  async setPolicy(policy_yaml: string | null): Promise<void> {
    await this.client.call("set_policy", { session_id: this.id, policy_yaml });
  }

  async close(): Promise<void> {
    await this.client.call("close_session", { session_id: this.id });
  }
}
