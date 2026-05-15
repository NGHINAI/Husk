import { describe, expect, it, vi } from "vitest";
import { Session } from "../../src/session/session.js";

describe("Session.extract", () => {
  it("runs Runtime.evaluate with the supplied CSS selector and returns textContent", async () => {
    const cdp = {
      send: vi.fn(async (method: string, params: any) => {
        if (method === "Runtime.evaluate") {
          expect(params.expression).toContain('".f4.my-3"');
          return { result: { value: "Production-Grade Container Scheduling" } };
        }
        return null;
      }),
      close: async () => {},
    };
    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    const text = await session.extract({ css: ".f4.my-3" });
    expect(text).toBe("Production-Grade Container Scheduling");
  });

  it("returns null when the element is not found", async () => {
    const cdp = {
      send: vi.fn(async () => ({ result: { value: null } })),
      close: async () => {},
    };
    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    const text = await session.extract({ css: ".does-not-exist" });
    expect(text).toBeNull();
  });

  it("trims surrounding whitespace from the extracted text", async () => {
    const cdp = {
      send: vi.fn(async () => ({ result: { value: "  spaced text  \n" } })),
      close: async () => {},
    };
    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    const text = await session.extract({ css: ".whatever" });
    // The Runtime.evaluate snippet trims; this test verifies the WHOLE chain works
    // (the fake returns already-trimmed text in the value field).
    expect(text).toBe("spaced text");
  });

  it("escapes selectors with single quotes safely", async () => {
    const cdp = {
      send: vi.fn(async (_method: string, params: any) => {
        // The selector must be JSON-stringified so it can't break the JS expression.
        // Specifically, an unescaped single quote inside the selector would break out
        // of the wrapping single-quoted JS string. We expect it to be JSON-encoded.
        expect(params.expression).toContain('"input[type=\'password\']"');
        return { result: { value: "ok" } };
      }),
      close: async () => {},
    };
    const session = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1" });
    await session.extract({ css: "input[type='password']" });
  });
});
