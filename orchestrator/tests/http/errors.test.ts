import { describe, expect, it } from "vitest";
import {
  EngineError,
  InvalidUrlError,
  toJsonRpcError,
  JSONRPC_ERROR_CODES,
} from "../../src/http/errors.js";
import { SessionNotFoundError } from "../../src/session/manager.js";
import { LightpandaNotFoundError } from "../../src/engine/binary.js";

describe("Husk error classes", () => {
  it("EngineError carries its message", () => {
    const e = new EngineError("subprocess crashed");
    expect(e.message).toBe("subprocess crashed");
    expect(e.name).toBe("EngineError");
  });

  it("InvalidUrlError carries the offending URL", () => {
    const e = new InvalidUrlError("not a url");
    expect(e.message).toContain("not a url");
    expect(e.name).toBe("InvalidUrlError");
  });
});

describe("toJsonRpcError", () => {
  it("maps SessionNotFoundError to code -32001", () => {
    const err = new SessionNotFoundError("abc");
    const j = toJsonRpcError(err);
    expect(j.code).toBe(JSONRPC_ERROR_CODES.SESSION_NOT_FOUND);
    expect(j.code).toBe(-32001);
    expect(j.message).toContain("abc");
  });

  it("maps EngineError to code -32002", () => {
    const j = toJsonRpcError(new EngineError("oh no"));
    expect(j.code).toBe(-32002);
    expect(j.message).toBe("oh no");
  });

  it("maps LightpandaNotFoundError to code -32003", () => {
    const j = toJsonRpcError(new LightpandaNotFoundError("nope"));
    expect(j.code).toBe(-32003);
  });

  it("maps InvalidUrlError to code -32004", () => {
    const j = toJsonRpcError(new InvalidUrlError("badurl"));
    expect(j.code).toBe(-32004);
  });

  it("maps unknown Error to internal error -32603", () => {
    const j = toJsonRpcError(new Error("???"));
    expect(j.code).toBe(-32603);
    expect(j.message).toBe("???");
  });

  it("handles non-Error throwables by stringifying", () => {
    const j = toJsonRpcError("string-thrown");
    expect(j.code).toBe(-32603);
    expect(j.message).toContain("string-thrown");
  });
});
