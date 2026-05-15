import { SessionNotFoundError } from "../session/manager.js";
import { LightpandaNotFoundError } from "../engine/binary.js";

/**
 * JSON-RPC custom error codes used by Husk.
 *
 * The -32000..-32099 range is reserved by JSON-RPC 2.0 for "server errors"
 * that servers define themselves. We use the lower end of that range.
 */
export const JSONRPC_ERROR_CODES = {
  SESSION_NOT_FOUND: -32001,
  ENGINE_ERROR: -32002,
  BINARY_NOT_FOUND: -32003,
  INVALID_URL: -32004,
  // JSON-RPC standard codes (defined here so all codes are in one place)
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/** Raised when the lightpanda subprocess fails or returns malformed data. */
export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineError";
  }
}

/** Raised when goto() is called with a syntactically invalid URL. */
export class InvalidUrlError extends Error {
  readonly url: string;
  constructor(url: string) {
    super(`Invalid URL: ${url}`);
    this.name = "InvalidUrlError";
    this.url = url;
  }
}

export interface JsonRpcErrorPayload {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * Map any thrown value to a JSON-RPC error envelope. Known Husk error
 * types get their assigned code; everything else becomes an internal
 * error (-32603).
 */
export function toJsonRpcError(err: unknown): JsonRpcErrorPayload {
  if (err instanceof SessionNotFoundError) {
    return { code: JSONRPC_ERROR_CODES.SESSION_NOT_FOUND, message: err.message };
  }
  if (err instanceof EngineError) {
    return { code: JSONRPC_ERROR_CODES.ENGINE_ERROR, message: err.message };
  }
  if (err instanceof LightpandaNotFoundError) {
    return { code: JSONRPC_ERROR_CODES.BINARY_NOT_FOUND, message: err.message };
  }
  if (err instanceof InvalidUrlError) {
    return { code: JSONRPC_ERROR_CODES.INVALID_URL, message: err.message };
  }
  if (err instanceof Error) {
    return { code: JSONRPC_ERROR_CODES.INTERNAL_ERROR, message: err.message };
  }
  return {
    code: JSONRPC_ERROR_CODES.INTERNAL_ERROR,
    message: `Non-Error thrown: ${String(err)}`,
  };
}
