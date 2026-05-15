import { JsonRpcClient } from "./transport.js";
import { Session } from "./session.js";

export const SDK_VERSION = "0.0.0";

export interface HuskOptions {
  /** Orchestrator URL. Defaults to `http://localhost:7777`. */
  baseUrl?: string;
  /** Optional fetch override (tests / custom transports). */
  fetch?: typeof globalThis.fetch;
}

export interface HealthResult {
  ok: boolean;
  version: string;
  activeSessions: number;
}

const DEFAULT_BASE_URL = "http://localhost:7777";

/**
 * Husk SDK client. Entry point for agent code.
 *
 * ```ts
 * const h = new Husk({ baseUrl: "http://localhost:7777" });
 * const s = await h.createSession();
 * await s.goto("https://example.com");
 * const snap = await s.snapshot();
 * const r = await s.click("button:submit");
 * if (!r.ok) console.log("rejected:", r.reason, r.candidates);
 * ```
 */
export class Husk {
  public readonly baseUrl: string;
  private readonly client: JsonRpcClient;

  constructor(options: HuskOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.client = new JsonRpcClient({ baseUrl: this.baseUrl, fetch: options.fetch });
  }

  async createSession(): Promise<Session> {
    const { session_id } = await this.client.call<{ session_id: string }>("create_session", {});
    return new Session(this.client, session_id);
  }

  async health(): Promise<HealthResult> {
    return await this.client.call<HealthResult>("health", {});
  }
}

export { Session } from "./session.js";
export { JsonRpcClient, JsonRpcTransportError, HuskApiError } from "./transport.js";
export type { ScrollDirection } from "./session.js";
export * from "./types.js";
