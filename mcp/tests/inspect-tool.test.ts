import { describe, expect, it, vi } from "vitest";
import { TOOL_SURFACE, handleToolCall } from "../src/tool-surface.js";

describe("husk_inspect MCP tool", () => {
  it("is present with full and diff modes", () => {
    const tool = TOOL_SURFACE.find((t) => t.name === "husk_inspect");
    expect(tool).toBeDefined();
    const enumVals = (tool!.inputSchema.properties.mode as any).enum;
    expect(enumVals).toEqual(["full", "diff"]);
  });

  it("mode=full routes to snapshot RPC", async () => {
    const client = { call: vi.fn(async () => ({ ok: true })) };
    await handleToolCall(client as any, "husk_inspect", { session_id: "s1", mode: "full" });
    expect(client.call).toHaveBeenCalledWith("snapshot", expect.objectContaining({ session_id: "s1" }));
  });

  it("mode=diff routes to snapshot_diff RPC with since_signature", async () => {
    const client = { call: vi.fn(async () => ({ ok: true })) };
    await handleToolCall(client as any, "husk_inspect", {
      session_id: "s1",
      mode: "diff",
      since_signature: "sig",
    });
    expect(client.call).toHaveBeenCalledWith(
      "snapshot_diff",
      expect.objectContaining({ session_id: "s1", since_signature: "sig" })
    );
  });

  it("mode=diff without since_signature throws clearly", async () => {
    const client = { call: vi.fn() };
    await expect(
      handleToolCall(client as any, "husk_inspect", { session_id: "s1", mode: "diff" })
    ).rejects.toThrow(/since_signature/);
  });
});
