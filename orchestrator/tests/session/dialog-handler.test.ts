import { describe, it, expect, vi } from "vitest";
import { DialogHandler } from "../../src/session/dialog-handler.js";

describe("DialogHandler", () => {
  it("auto-dismisses an alert after the auto-dismiss window", async () => {
    const cdp = { send: vi.fn().mockResolvedValue({}) };
    const h = new DialogHandler(cdp as any, { autoDismissMs: 50 });
    h.onDialog({ type: "alert", message: "Hello", url: "/" });
    await new Promise((r) => setTimeout(r, 80));
    expect(cdp.send).toHaveBeenCalledWith("Page.handleJavaScriptDialog", {
      accept: false,
      promptText: undefined,
    });
  });

  it("snapshot exposes pending dialog before auto-dismiss fires", () => {
    const cdp = { send: vi.fn() };
    const h = new DialogHandler(cdp as any, { autoDismissMs: 1000 });
    h.onDialog({ type: "confirm", message: "Delete?", url: "/x" });
    const pending = h.pending();
    expect(pending).toEqual({ type: "confirm", message: "Delete?" });
  });

  it("pending() returns null when no dialog open", () => {
    const cdp = { send: vi.fn() };
    const h = new DialogHandler(cdp as any);
    expect(h.pending()).toBeNull();
  });

  it("manualHandle accepts a prompt with text and cancels the auto-dismiss timer", async () => {
    const cdp = { send: vi.fn().mockResolvedValue({}) };
    const h = new DialogHandler(cdp as any, { autoDismissMs: 1000 });
    h.onDialog({ type: "prompt", message: "Your name?", url: "/" });
    await h.manualHandle("accept", "Husk");
    expect(cdp.send).toHaveBeenCalledWith("Page.handleJavaScriptDialog", {
      accept: true,
      promptText: "Husk",
    });
    // After manual handle, pending is cleared
    expect(h.pending()).toBeNull();
    // Wait past auto-dismiss window; should NOT fire a second send
    await new Promise((r) => setTimeout(r, 1100));
    expect(cdp.send).toHaveBeenCalledTimes(1);
  });

  it("manualHandle dismiss without text", async () => {
    const cdp = { send: vi.fn().mockResolvedValue({}) };
    const h = new DialogHandler(cdp as any);
    h.onDialog({ type: "confirm", message: "Sure?", url: "/" });
    await h.manualHandle("dismiss");
    expect(cdp.send).toHaveBeenCalledWith("Page.handleJavaScriptDialog", {
      accept: false,
      promptText: undefined,
    });
  });

  it("manualHandle with no pending dialog is a no-op (doesn't throw)", async () => {
    const cdp = { send: vi.fn() };
    const h = new DialogHandler(cdp as any);
    await h.manualHandle("accept");
    expect(cdp.send).not.toHaveBeenCalled();
  });

  it("two dialogs in rapid succession — second replaces first; first never auto-dismisses", async () => {
    const cdp = { send: vi.fn().mockResolvedValue({}) };
    const h = new DialogHandler(cdp as any, { autoDismissMs: 50 });
    h.onDialog({ type: "alert", message: "First", url: "/" });
    h.onDialog({ type: "alert", message: "Second", url: "/" });
    await new Promise((r) => setTimeout(r, 100));
    // Only ONE send should fire — for the second dialog (the first one's timer should have been cancelled)
    expect(cdp.send).toHaveBeenCalledTimes(1);
    expect(h.pending()).toBeNull();
  });

  it("CDP send error is swallowed (doesn't crash session)", async () => {
    const cdp = { send: vi.fn().mockRejectedValue(new Error("UnknownMethod")) };
    const h = new DialogHandler(cdp as any, { autoDismissMs: 30 });
    h.onDialog({ type: "alert", message: "x", url: "/" });
    await new Promise((r) => setTimeout(r, 60));
    // No throw; pending cleared anyway
    expect(h.pending()).toBeNull();
  });
});
