import type { JsonRpcResponse } from "./types.js";

export class JsonRpcTransportError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "JsonRpcTransportError";
  }
}

export class HuskApiError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly data?: unknown
  ) {
    super(message);
    this.name = "HuskApiError";
  }
}

export interface JsonRpcClientOptions {
  /** e.g. "http://localhost:7777" — trailing slash is stripped. */
  baseUrl: string;
  /** Optional fetch override (for tests + custom transports). */
  fetch?: typeof globalThis.fetch;
}

/**
 * Minimal JSON-RPC 2.0 client over HTTP POST. v0 binds to /v1/jsonrpc on
 * the orchestrator. No retry, no batching, no timeout (caller handles).
 */
export class JsonRpcClient {
  private readonly _baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private nextId = 0;

  constructor(opts: JsonRpcClientOptions) {
    this._baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
  }

  /** The orchestrator base URL (no trailing slash). Used by subscribe.ts for SSE. */
  get baseUrl(): string {
    return this._baseUrl;
  }

  /**
   * Invoke a JSON-RPC method. Returns the `result` payload on success or
   * throws `HuskApiError` (server returned `error`) or
   * `JsonRpcTransportError` (HTTP/parse issue).
   */
  async call<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    const id = ++this.nextId;
    const url = `${this._baseUrl}/v1/jsonrpc`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
    } catch (e) {
      throw new JsonRpcTransportError(`Fetch failed: ${(e as Error).message}`, e);
    }
    if (!res.ok) {
      throw new JsonRpcTransportError(`HTTP ${res.status} from ${url}`);
    }
    let body: JsonRpcResponse<T>;
    try {
      body = (await res.json()) as JsonRpcResponse<T>;
    } catch (e) {
      throw new JsonRpcTransportError("Response body was not valid JSON", e);
    }
    if ("error" in body) {
      throw new HuskApiError(body.error.message, body.error.code, body.error.data);
    }
    return body.result;
  }
}
