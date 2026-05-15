import { describe, expect, it, vi } from "vitest";
import { TOOL_SURFACE, handleToolCall } from "../src/tool-surface.js";

describe("TOOL_SURFACE", () => {
  it("lists Husk-branded tools with husk_ prefix", () => {
    const names = TOOL_SURFACE.map((t) => t.name);
    expect(names).toContain("husk_create_session");
    expect(names).toContain("husk_goto");
    expect(names).toContain("husk_snapshot");
    expect(names).toContain("husk_click");
    expect(names).toContain("husk_type");
    expect(names).toContain("husk_press_key");
    expect(names).toContain("husk_scroll");
    expect(names).toContain("husk_close_session");
    expect(names).toContain("husk_version");
    for (const t of TOOL_SURFACE) expect(t.name.startsWith("husk_")).toBe(true);
  });

  it("every tool has a description and inputSchema", () => {
    for (const t of TOOL_SURFACE) {
      expect(typeof t.description).toBe("string");
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.inputSchema?.type).toBe("object");
    }
  });
});

describe("handleToolCall", () => {
  it("routes husk_goto to JSON-RPC goto with snake_case params", async () => {
    const client = { call: vi.fn(async () => ({ ok: true })) };
    const r = await handleToolCall(
      client as any,
      "husk_goto",
      { session_id: "s1", url: "https://x.test" }
    );
    expect(client.call).toHaveBeenCalledWith("goto", { session_id: "s1", url: "https://x.test" });
    expect(r).toEqual({ ok: true });
  });

  it("routes husk_click and returns rejection envelopes verbatim", async () => {
    const envelope = {
      ok: false, reason: "element_not_found", verb: "click",
      stable_id_attempted: "button:x", candidates: [],
      snapshot_at_attempt: { v: 1, url: "", count: 0, root: { i: "x", r: "x", n: "", s: [] } },
    };
    const client = { call: vi.fn(async () => envelope) };
    const r = await handleToolCall(client as any, "husk_click", { session_id: "s1", stable_id: "button:x" });
    expect(client.call).toHaveBeenCalledWith("click", { session_id: "s1", stable_id: "button:x" });
    expect(r).toEqual(envelope);
  });

  it("husk_version is handled locally (no RPC)", async () => {
    const client = { call: vi.fn() };
    const r = await handleToolCall(client as any, "husk_version", {});
    expect(client.call).not.toHaveBeenCalled();
    expect((r as { name: string }).name).toBe("husk-mcp");
  });

  it("unknown tool name throws", async () => {
    const client = { call: vi.fn() };
    await expect(handleToolCall(client as any, "husk_bogus", {})).rejects.toThrow(/Unknown tool/);
  });
});

describe("vault tools", () => {
  it("TOOL_SURFACE includes husk_vault_list_profiles + husk_vault_clear", () => {
    const names = TOOL_SURFACE.map((t) => t.name);
    expect(names).toContain("husk_vault_list_profiles");
    expect(names).toContain("husk_vault_clear");
  });

  it("husk_create_session schema accepts optional profile", () => {
    const tool = TOOL_SURFACE.find((t) => t.name === "husk_create_session")!;
    expect(tool.inputSchema.properties.profile).toBeDefined();
  });

  it("handleToolCall routes husk_vault_list_profiles to vault_list_profiles", async () => {
    const client = { call: vi.fn(async () => ({ profiles: ["default"] })) };
    await handleToolCall(client as any, "husk_vault_list_profiles", {});
    expect(client.call).toHaveBeenCalledWith("vault_list_profiles", {});
  });
});
