import { JsonRpcClient } from "./transport.js";
import { Session } from "./session.js";
import type { Cookie } from "./types.js";

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
class VaultApi {
  constructor(private readonly client: JsonRpcClient) {}

  async listProfiles(): Promise<string[]> {
    const r = await this.client.call<{ profiles: string[] }>("vault_list_profiles", {});
    return r.profiles;
  }

  async listCookies(profile: string): Promise<Cookie[]> {
    const r = await this.client.call<{ cookies: Cookie[] }>("vault_list_cookies", { profile });
    return r.cookies;
  }

  async clear(profile: string): Promise<void> {
    await this.client.call("vault_clear", { profile });
  }

  async removeCookie(profile: string, name: string, domain: string, path: string): Promise<void> {
    await this.client.call("vault_remove_cookie", { profile, name, domain, path });
  }
}

export { VaultApi };

class CredentialsApi {
  constructor(private readonly client: JsonRpcClient) {}

  async set(profile: string, cred: { key: string; username: string; password: string; totp_secret?: string }): Promise<void> {
    await this.client.call("credentials_set", {
      profile,
      key: cred.key,
      username: cred.username,
      password: cred.password,
      totp_secret: cred.totp_secret,
    });
  }

  async list(profile: string): Promise<Array<{ key: string; username: string }>> {
    const r = await this.client.call<{ credentials: Array<{ key: string; username: string }> }>("credentials_list", { profile });
    return r.credentials;
  }

  async listProfiles(): Promise<string[]> {
    const r = await this.client.call<{ profiles: string[] }>("credentials_list_profiles", {});
    return r.profiles;
  }

  async remove(profile: string, key: string): Promise<void> {
    await this.client.call("credentials_remove", { profile, key });
  }
}

export { CredentialsApi };

export class Husk {
  public readonly baseUrl: string;
  public readonly vault: VaultApi;
  public readonly credentials: CredentialsApi;
  private readonly client: JsonRpcClient;

  constructor(options: HuskOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.client = new JsonRpcClient({ baseUrl: this.baseUrl, fetch: options.fetch });
    this.vault = new VaultApi(this.client);
    this.credentials = new CredentialsApi(this.client);
  }

  async createSession(options: { profile?: string } = {}): Promise<Session> {
    const params = options.profile !== undefined ? { profile: options.profile } : {};
    const { session_id } = await this.client.call<{ session_id: string }>("create_session", params);
    return new Session(this.client, session_id);
  }

  async health(): Promise<HealthResult> {
    return await this.client.call<HealthResult>("health", {});
  }
}

export { Session } from "./session.js";
export { JsonRpcClient, JsonRpcTransportError, HuskApiError } from "./transport.js";
export type { ScrollDirection } from "./session.js";
export { findInSnapshot, findAllInSnapshot } from "./snapshot.js";
export type { FindCriteria } from "./snapshot.js";
export * from "./types.js";
