import { describe, expect, it, vi } from "vitest";
import { TOOL_SURFACE, handleToolCall } from "../src/tool-surface.js";

describe("husk_intend MCP tool", () => {
  it("is present in TOOL_SURFACE with correct schema", () => {
    const tool = TOOL_SURFACE.find((t) => t.name === "husk_intend");
    expect(tool).toBeDefined();
    // required: session_id
    expect(tool!.inputSchema.required).toContain("session_id");
    // has verb enum
    const verbProp = (tool!.inputSchema.properties.verb as any);
    expect(verbProp.enum).toEqual(["click", "type", "scroll", "press_key", "wait_for", "upload"]);
    // has intention_name property
    expect(tool!.inputSchema.properties.intention_name).toBeDefined();
  });

  it("intention_name mode routes to 'intend' RPC with session_id + intention_name + args", async () => {
    const client = { call: vi.fn(async () => ({ ok: true })) };
    await handleToolCall(client as any, "husk_intend", {
      session_id: "s1",
      intention_name: "send_connect",
      args: { person: "Alice" },
    });
    expect(client.call).toHaveBeenCalledWith("intend", expect.objectContaining({
      session_id: "s1",
      intention_name: "send_connect",
      args: { person: "Alice" },
    }));
  });

  it("verb=click routes to 'click' RPC with target", async () => {
    const client = { call: vi.fn(async () => ({ ok: true })) };
    await handleToolCall(client as any, "husk_intend", {
      session_id: "s1",
      verb: "click",
      target: { intent: "Sign in button" },
    });
    expect(client.call).toHaveBeenCalledWith("click", expect.objectContaining({
      session_id: "s1",
    }));
    // target fields should be spread into the call
    const callArgs = client.call.mock.calls[0][1] as Record<string, unknown>;
    expect(callArgs.intent).toBe("Sign in button");
  });

  it("verb=type routes to 'type' RPC with text", async () => {
    const client = { call: vi.fn(async () => ({ ok: true })) };
    await handleToolCall(client as any, "husk_intend", {
      session_id: "s1",
      verb: "type",
      target: { intent: "Email field" },
      text: "hello@example.com",
    });
    expect(client.call).toHaveBeenCalledWith("type", expect.objectContaining({
      session_id: "s1",
      text: "hello@example.com",
    }));
  });

  it("verb=scroll routes to 'scroll' RPC with direction", async () => {
    const client = { call: vi.fn(async () => ({ ok: true })) };
    await handleToolCall(client as any, "husk_intend", {
      session_id: "s1",
      verb: "scroll",
      direction: "down",
      amount_px: 800,
    });
    expect(client.call).toHaveBeenCalledWith("scroll", expect.objectContaining({
      session_id: "s1",
      direction: "down",
    }));
  });

  it("verb=press_key routes to 'press_key' RPC with key", async () => {
    const client = { call: vi.fn(async () => ({ ok: true })) };
    await handleToolCall(client as any, "husk_intend", {
      session_id: "s1",
      verb: "press_key",
      key: "Enter",
    });
    expect(client.call).toHaveBeenCalledWith("press_key", expect.objectContaining({
      session_id: "s1",
      key: "Enter",
    }));
  });

  it("verb=wait_for routes to 'wait_for' RPC with predicate fields spread", async () => {
    const client = { call: vi.fn(async () => ({ ok: true })) };
    await handleToolCall(client as any, "husk_intend", {
      session_id: "s1",
      verb: "wait_for",
      predicate: { text: "Success" },
      timeout_ms: 5000,
    });
    expect(client.call).toHaveBeenCalledWith("wait_for", expect.objectContaining({
      session_id: "s1",
      text: "Success",
    }));
  });

  it("verb=upload routes to 'upload' RPC with file_path", async () => {
    const client = { call: vi.fn(async () => ({ ok: true })) };
    await handleToolCall(client as any, "husk_intend", {
      session_id: "s1",
      verb: "upload",
      target: { intent: "Resume upload" },
      file_path: "/tmp/resume.pdf",
    });
    expect(client.call).toHaveBeenCalledWith("upload", expect.objectContaining({
      session_id: "s1",
      file_path: "/tmp/resume.pdf",
    }));
  });

  it("neither intention_name nor verb throws 'requires either intention_name or verb'", async () => {
    const client = { call: vi.fn() };
    await expect(
      handleToolCall(client as any, "husk_intend", { session_id: "s1" })
    ).rejects.toThrow(/requires either intention_name or verb/);
  });
});
