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

describe("login + credentials tools", () => {
  it("TOOL_SURFACE includes husk_login + husk_credentials_set", () => {
    const names = TOOL_SURFACE.map((t) => t.name);
    expect(names).toContain("husk_login");
    expect(names).toContain("husk_credentials_set");
  });

  it("husk_login schema requires only session_id (profile+key or username+password are optional alternates)", () => {
    const tool = TOOL_SURFACE.find((t) => t.name === "husk_login")!;
    expect(tool.inputSchema.required).toEqual(["session_id"]);
    // Both modes documented in properties
    expect(tool.inputSchema.properties.profile).toBeDefined();
    expect(tool.inputSchema.properties.key).toBeDefined();
    expect(tool.inputSchema.properties.username).toBeDefined();
    expect(tool.inputSchema.properties.password).toBeDefined();
    expect(tool.inputSchema.properties.totp_secret).toBeDefined();
  });

  it("handleToolCall routes husk_login to JSON-RPC login (lookup mode)", async () => {
    const client = { call: vi.fn(async () => ({ ok: true, url_before: "a", url_after: "b" })) };
    await handleToolCall(client as any, "husk_login", { session_id: "s1", profile: "default", key: "github.com" });
    expect(client.call).toHaveBeenCalledWith("login", { session_id: "s1", profile: "default", key: "github.com" });
  });

  it("handleToolCall routes husk_login inline mode (username+password) without going through credentials_set", async () => {
    const client = { call: vi.fn(async () => ({ ok: true, url_before: "a", url_after: "b" })) };
    await handleToolCall(client as any, "husk_login", {
      session_id: "s1",
      username: "tomsmith",
      password: "SuperSecretPassword!",
    });
    expect(client.call).toHaveBeenCalledWith("login", {
      session_id: "s1",
      username: "tomsmith",
      password: "SuperSecretPassword!",
    });
  });

  it("husk_type description warns agents to use husk_login for login forms", () => {
    const t = TOOL_SURFACE.find((x) => x.name === "husk_type")!;
    expect(t.description.toLowerCase()).toMatch(/husk_login/);
  });

  it("husk_click description warns agents to use husk_login for form submission", () => {
    const t = TOOL_SURFACE.find((x) => x.name === "husk_click")!;
    expect(t.description.toLowerCase()).toMatch(/husk_login/);
  });
});

describe("snapshot_diff tool", () => {
  it("husk_snapshot_diff is registered", () => {
    expect(TOOL_SURFACE.find((t) => t.name === "husk_snapshot_diff")).toBeDefined();
  });

  it("handleToolCall routes husk_snapshot_diff to snapshot_diff", async () => {
    const client = { call: vi.fn(async () => ({ added: [], removed: [], changed: [] })) };
    await handleToolCall(client as any, "husk_snapshot_diff", { session_id: "s1" });
    expect(client.call).toHaveBeenCalledWith("snapshot_diff", { session_id: "s1" });
  });
});

describe("parallelism + diff descriptions (M9)", () => {
  it("husk_create_session description mentions parallel-safe behavior", () => {
    const t = TOOL_SURFACE.find((x) => x.name === "husk_create_session")!;
    expect(t.description.toLowerCase()).toMatch(/parallel/);
  });

  it("husk_click description mentions diff field in result", () => {
    const t = TOOL_SURFACE.find((x) => x.name === "husk_click")!;
    expect(t.description.toLowerCase()).toMatch(/diff/);
  });

  it("husk_snapshot description mentions cache or freshness", () => {
    const t = TOOL_SURFACE.find((x) => x.name === "husk_snapshot")!;
    expect(t.description.toLowerCase()).toMatch(/cache|fresh|max_age/);
  });

  it("husk_snapshot schema accepts optional max_age_ms parameter", () => {
    const t = TOOL_SURFACE.find((x) => x.name === "husk_snapshot")!;
    expect(t.inputSchema.properties.max_age_ms).toBeDefined();
  });
});
