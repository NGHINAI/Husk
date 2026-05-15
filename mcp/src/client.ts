export interface HuskRpcClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
}

export class HuskRpcClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private nextId = 0;

  constructor(opts: HuskRpcClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
  }

  async call<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    const id = ++this.nextId;
    const res = await this.fetchImpl(`${this.baseUrl}/v1/jsonrpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${this.baseUrl}/v1/jsonrpc`);
    const body = await res.json() as { result?: T; error?: { code: number; message: string } };
    if (body.error) throw new Error(body.error.message);
    return body.result as T;
  }
}
