import { describe, expect, it, vi } from "vitest";
import { TOOL_SURFACE, handleToolCall } from "../src/tool-surface.js";

describe("husk_session MCP tool", () => {
  it("is present in TOOL_SURFACE with action discriminator", () => {
    const tool = TOOL_SURFACE.find((t) => t.name === "husk_session");
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toContain("action");
    const actionEnum = (tool!.inputSchema.properties.action as { enum: string[] }).enum;
    expect(actionEnum).toContain("create");
    expect(actionEnum).toContain("close");
    expect(actionEnum).toContain("goto");
    expect(actionEnum).toContain("login");
    expect(actionEnum).toContain("set_credentials");
    expect(actionEnum).toContain("list_profiles");
    expect(actionEnum).toContain("clear_vault");
  });

  it("action=create routes to create_session RPC", async () => {
    const client = { call: vi.fn(async () => ({ session_id: "s1", watch_url: null })) };
    await handleToolCall(client as any, "husk_session", { action: "create" });
    expect(client.call).toHaveBeenCalledWith("create_session", expect.objectContaining({}));
  });

  it("action=create passes profile, engine, capability, parent_session_id", async () => {
    const client = { call: vi.fn(async () => ({ session_id: "s1", watch_url: null })) };
    await handleToolCall(client as any, "husk_session", {
      action: "create",
      profile: "default",
      engine: "chrome",
      capability: { features: ["webrtc"] },
      parent_session_id: "p1",
    });
    expect(client.call).toHaveBeenCalledWith("create_session", {
      profile: "default",
      engine: "chrome",
      capability: { features: ["webrtc"] },
      parent_session_id: "p1",
    });
  });

  it("action=close routes to close_session RPC", async () => {
    const client = { call: vi.fn(async () => ({ ok: true })) };
    await handleToolCall(client as any, "husk_session", { action: "close", session_id: "s1" });
    expect(client.call).toHaveBeenCalledWith("close_session", { session_id: "s1" });
  });

  it("action=goto routes to goto RPC", async () => {
    const client = { call: vi.fn(async () => ({ ok: true })) };
    await handleToolCall(client as any, "husk_session", {
      action: "goto",
      session_id: "s1",
      url: "https://example.com",
    });
    expect(client.call).toHaveBeenCalledWith("goto", {
      session_id: "s1",
      url: "https://example.com",
    });
  });

  it("action=login routes to login RPC", async () => {
    const client = { call: vi.fn(async () => ({ ok: true })) };
    await handleToolCall(client as any, "husk_session", {
      action: "login",
      session_id: "s1",
      username: "user",
      password: "pass",
      totp_secret: "JBSWY3DPEHPK3PXP",
    });
    expect(client.call).toHaveBeenCalledWith("login", expect.objectContaining({
      session_id: "s1",
      username: "user",
      password: "pass",
      totp_secret: "JBSWY3DPEHPK3PXP",
    }));
  });

  it("action=set_credentials routes to credentials_set RPC", async () => {
    const client = { call: vi.fn(async () => ({ ok: true })) };
    await handleToolCall(client as any, "husk_session", {
      action: "set_credentials",
      site: "github.com",
      username: "alice",
      password: "hunter2",
    });
    expect(client.call).toHaveBeenCalledWith("credentials_set", expect.objectContaining({
      username: "alice",
      password: "hunter2",
    }));
  });

  it("action=list_profiles routes to vault_list_profiles RPC", async () => {
    const client = { call: vi.fn(async () => ({ profiles: [] })) };
    await handleToolCall(client as any, "husk_session", { action: "list_profiles" });
    expect(client.call).toHaveBeenCalledWith("vault_list_profiles", {});
  });

  it("action=clear_vault routes to vault_clear RPC", async () => {
    const client = { call: vi.fn(async () => ({ ok: true })) };
    await handleToolCall(client as any, "husk_session", {
      action: "clear_vault",
      profile_name: "default",
    });
    expect(client.call).toHaveBeenCalledWith("vault_clear", { profile: "default" });
  });

  it("invalid action throws clearly", async () => {
    const client = { call: vi.fn() };
    await expect(
      handleToolCall(client as any, "husk_session", { action: "bogus_action" })
    ).rejects.toThrow(/husk_session.*invalid action/i);
  });

  it("load_profile is NOT in the action enum (deferred to post-v0.1)", () => {
    const tool = TOOL_SURFACE.find((t) => t.name === "husk_session");
    expect(tool).toBeDefined();
    const actionEnum = (tool!.inputSchema.properties.action as { enum: string[] }).enum;
    expect(actionEnum).not.toContain("load_profile");
  });

  it("action=save_profile routes to vault_save RPC with session_id", async () => {
    const client = { call: vi.fn(async () => ({ saved: true, profile: "linkedin", cookie_count: 14 })) };
    await handleToolCall(client as any, "husk_session", { action: "save_profile", session_id: "s1" });
    expect(client.call).toHaveBeenCalledWith("vault_save", { session_id: "s1" });
  });

  it("action=create threads profile through to create_session RPC", async () => {
    const client = { call: vi.fn(async () => ({ session_id: "new-s", engine: "lightpanda" })) };
    await handleToolCall(client as any, "husk_session", { action: "create", profile: "linkedin" });
    expect(client.call).toHaveBeenCalledWith("create_session", expect.objectContaining({ profile: "linkedin" }));
  });
});

describe("husk_handoff action=resume", () => {
  it("action=open (or unset) routes to handoff RPC", async () => {
    const client = { call: vi.fn(async () => ({ pending: true, token: "t1" })) };
    await handleToolCall(client as any, "husk_handoff", {
      session_id: "s1",
      reason: "captcha",
      action: "open",
    });
    expect(client.call).toHaveBeenCalledWith("handoff", expect.objectContaining({
      session_id: "s1",
      reason: "captcha",
    }));
  });

  it("action=resume routes to resume RPC", async () => {
    const client = { call: vi.fn(async () => ({ ok: true, kind: "handoff" })) };
    await handleToolCall(client as any, "husk_handoff", {
      action: "resume",
      session_id: "s1",
      token: "tok-abc",
    });
    expect(client.call).toHaveBeenCalledWith("resume", expect.objectContaining({
      token: "tok-abc",
    }));
  });

  it("husk_handoff schema includes action enum with open and resume", () => {
    const tool = TOOL_SURFACE.find((t) => t.name === "husk_handoff");
    expect(tool).toBeDefined();
    const actionProp = tool!.inputSchema.properties.action as { type: string; enum: string[] };
    expect(actionProp).toBeDefined();
    expect(actionProp.enum).toContain("open");
    expect(actionProp.enum).toContain("resume");
  });
});
