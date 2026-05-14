export const SDK_VERSION = "0.0.0";

export interface HuskOptions {
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "http://localhost:7777";

/**
 * Husk SDK client.
 *
 * In Milestone 1 this is a placeholder constructor only. Full transport
 * (JSON-RPC over HTTP/2), Session API, and snapshot/act methods land in
 * Milestone 6.
 */
export class Husk {
  public readonly baseUrl: string;

  constructor(options: HuskOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  }
}
