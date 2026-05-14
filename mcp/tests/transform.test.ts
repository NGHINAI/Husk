import { describe, expect, it } from "vitest";
import {
  rewriteToolsListResponse,
  rewriteToolsCallRequest,
  isToolsListResponse,
  isToolsCallRequest,
} from "../src/transform.js";

describe("isToolsListResponse / isToolsCallRequest", () => {
  it("detects tools/list response shape", () => {
    expect(
      isToolsListResponse({ jsonrpc: "2.0", id: 1, result: { tools: [] } })
    ).toBe(true);
  });

  it("rejects non-result messages", () => {
    expect(isToolsListResponse({ jsonrpc: "2.0", id: 1, method: "tools/list" })).toBe(false);
  });

  it("detects tools/call request shape", () => {
    expect(
      isToolsCallRequest({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "x" } })
    ).toBe(true);
  });

  it("rejects non-tools/call methods", () => {
    expect(
      isToolsCallRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    ).toBe(false);
  });
});

describe("rewriteToolsListResponse", () => {
  it("renames each upstream tool to its husk_ form", () => {
    const input = {
      jsonrpc: "2.0" as const,
      id: 1,
      result: {
        tools: [
          { name: "goto", description: "Navigate the browser to a URL." },
          { name: "semantic_tree", description: "Return the page semantic tree." },
        ],
      },
    };
    const out = rewriteToolsListResponse(input);
    const names = (out.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(names).toContain("husk_goto");
    expect(names).toContain("husk_snapshot");
    expect(names).not.toContain("goto");
    expect(names).not.toContain("semantic_tree");
  });

  it('prepends "Husk — " to each upstream tool description', () => {
    const input = {
      jsonrpc: "2.0" as const,
      id: 1,
      result: {
        tools: [{ name: "click", description: "Click an element by selector." }],
      },
    };
    const out = rewriteToolsListResponse(input);
    const desc = (out.result as { tools: { description: string }[] }).tools[0].description;
    expect(desc).toMatch(/^Husk — /);
    expect(desc).toContain("Click an element by selector.");
  });

  it("appends Husk-native tools to the list", () => {
    const input = {
      jsonrpc: "2.0" as const,
      id: 1,
      result: { tools: [{ name: "goto", description: "Navigate." }] },
    };
    const out = rewriteToolsListResponse(input);
    const names = (out.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(names).toContain("husk_version");
  });

  it("preserves the response id and jsonrpc version", () => {
    const input = {
      jsonrpc: "2.0" as const,
      id: 42,
      result: { tools: [] },
    };
    const out = rewriteToolsListResponse(input);
    expect(out.id).toBe(42);
    expect(out.jsonrpc).toBe("2.0");
  });
});

describe("rewriteToolsCallRequest", () => {
  it("translates husk_goto → goto in params.name", () => {
    const input = {
      jsonrpc: "2.0" as const,
      id: 7,
      method: "tools/call",
      params: { name: "husk_goto", arguments: { url: "https://example.com" } },
    };
    const out = rewriteToolsCallRequest(input);
    expect(out.params.name).toBe("goto");
    expect(out.params.arguments).toEqual({ url: "https://example.com" });
  });

  it("translates husk_snapshot → semantic_tree", () => {
    const input = {
      jsonrpc: "2.0" as const,
      id: 7,
      method: "tools/call",
      params: { name: "husk_snapshot", arguments: {} },
    };
    const out = rewriteToolsCallRequest(input);
    expect(out.params.name).toBe("semantic_tree");
  });

  it("returns the input unchanged when params.name is not a husk_ name", () => {
    const input = {
      jsonrpc: "2.0" as const,
      id: 7,
      method: "tools/call",
      params: { name: "unknown_tool", arguments: {} },
    };
    const out = rewriteToolsCallRequest(input);
    expect(out.params.name).toBe("unknown_tool");
  });

  it("preserves the request id, jsonrpc, and method fields", () => {
    const input = {
      jsonrpc: "2.0" as const,
      id: 99,
      method: "tools/call",
      params: { name: "husk_click", arguments: { selector: "#x" } },
    };
    const out = rewriteToolsCallRequest(input);
    expect(out.id).toBe(99);
    expect(out.jsonrpc).toBe("2.0");
    expect(out.method).toBe("tools/call");
  });
});
