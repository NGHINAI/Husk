import { describe, expect, it, vi } from "vitest";
import { TOOL_SURFACE, handleToolCall } from "../src/tool-surface.js";

// ── Phase F: Final 8-tool surface assertions ────────────────────────────────

describe("MCP tool surface (Phase F)", () => {
  it("exposes exactly 8 tools", () => {
    expect(TOOL_SURFACE).toHaveLength(8);
  });

  it("tool names match v0.1 spec", () => {
    const expected = [
      "husk_ask_human",
      "husk_extract",
      "husk_handoff",
      "husk_inspect",
      "husk_intend",
      "husk_session",
      "husk_set_policy",
      "husk_subscribe",
    ];
    expect(TOOL_SURFACE.map((t) => t.name).sort()).toEqual(expected);
  });

  it("no deprecated tools remain", () => {
    const deprecated = [
      "husk_create_session",
      "husk_close_session",
      "husk_goto",
      "husk_login",
      "husk_credentials_set",
      "husk_vault_list_profiles",
      "husk_vault_clear",
      "husk_version",
      "husk_click",
      "husk_type",
      "husk_scroll",
      "husk_press_key",
      "husk_wait_for",
      "husk_upload",
      "husk_snapshot",
      "husk_snapshot_diff",
      "husk_resume",
      "husk_batch_visit",
    ];
    const names = TOOL_SURFACE.map((t) => t.name);
    for (const d of deprecated) {
      expect(names).not.toContain(d);
    }
  });

  it("every tool has a non-empty description and object inputSchema", () => {
    for (const t of TOOL_SURFACE) {
      expect(typeof t.description).toBe("string");
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.inputSchema?.type).toBe("object");
    }
  });

  it("all tool names use the husk_ prefix", () => {
    for (const t of TOOL_SURFACE) {
      expect(t.name.startsWith("husk_")).toBe(true);
    }
  });
});

// ── handleToolCall: retained tool routing ───────────────────────────────────

describe("handleToolCall — retained tools", () => {
  it("routes husk_extract to JSON-RPC extract", async () => {
    const client = { call: vi.fn(async () => ({ text: "hello" })) };
    await handleToolCall(client as any, "husk_extract", { session_id: "s1", css: "h1" });
    expect(client.call).toHaveBeenCalledWith("extract", expect.objectContaining({ session_id: "s1", css: "h1" }));
  });

  it("routes husk_ask_human to JSON-RPC ask_human", async () => {
    const client = { call: vi.fn(async () => ({ pending: true, token: "q1" })) };
    await handleToolCall(client as any, "husk_ask_human", { session_id: "s1", question: "Are you sure?" });
    expect(client.call).toHaveBeenCalledWith("ask_human", expect.objectContaining({ session_id: "s1", question: "Are you sure?" }));
  });

  it("routes husk_set_policy to JSON-RPC set_policy", async () => {
    const client = { call: vi.fn(async () => ({ ok: true })) };
    await handleToolCall(client as any, "husk_set_policy", { session_id: "s1", policy_yaml: "allow: []" });
    expect(client.call).toHaveBeenCalledWith("set_policy", expect.objectContaining({ session_id: "s1" }));
  });

  it("unknown tool name throws", async () => {
    const client = { call: vi.fn() };
    await expect(handleToolCall(client as any, "husk_bogus", {})).rejects.toThrow(/Unknown tool/);
  });

  it("throws for removed tools (husk_click)", async () => {
    const client = { call: vi.fn() };
    await expect(handleToolCall(client as any, "husk_click", { session_id: "s1" })).rejects.toThrow(/Unknown tool/);
  });

  it("throws for removed tools (husk_goto)", async () => {
    const client = { call: vi.fn() };
    await expect(handleToolCall(client as any, "husk_goto", { session_id: "s1", url: "https://x.com" })).rejects.toThrow(/Unknown tool/);
  });

  it("throws for removed tools (husk_snapshot)", async () => {
    const client = { call: vi.fn() };
    await expect(handleToolCall(client as any, "husk_snapshot", { session_id: "s1" })).rejects.toThrow(/Unknown tool/);
  });
});
