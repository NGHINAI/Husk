import { describe, expect, it, vi } from "vitest";
import { TOOL_SURFACE, handleToolCall } from "../src/tool-surface.js";

describe("husk_subscribe MCP tool", () => {
  it("is present in tool-surface with correct schema", () => {
    const tool = TOOL_SURFACE.find((t) => t.name === "husk_subscribe");
    expect(tool).toBeDefined();
    expect(tool?.inputSchema.required).toContain("event_type");
    const enumVals = (tool?.inputSchema.properties.event_type as any)?.enum;
    expect(enumVals).toEqual([
      "state_change",
      "network_idle",
      "error_appeared",
      "captcha_detected",
      "user_intervention_required",
    ]);
  });

  it("routes to JSON-RPC subscribe method with event_type and optional params", async () => {
    const client = { call: vi.fn(async () => ({ subscription_id: "sub-1", stream_url: "/stream/cognition?subscription_id=sub-1" })) };
    await handleToolCall(client as any, "husk_subscribe", {
      event_type: "state_change",
      session_id: "s1",
    });
    expect(client.call).toHaveBeenCalledWith("subscribe", {
      event_type: "state_change",
      session_id: "s1",
    });
  });
});
