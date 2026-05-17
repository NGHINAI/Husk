import { describe, it, expect, vi } from "vitest";
import { captureScreenshot } from "../../src/snapshot/screenshot.js";

describe("captureScreenshot", () => {
  it("returns base64 data on success", async () => {
    const cdp = { send: vi.fn().mockResolvedValue({ data: "iVBORw0KGgo..." }) };
    const r = await captureScreenshot(cdp as any);
    expect(r).toBe("iVBORw0KGgo...");
    expect(cdp.send).toHaveBeenCalledWith("Page.captureScreenshot", expect.objectContaining({ format: "png" }));
  });

  it("returns null when CDP throws (engine doesn't implement)", async () => {
    const cdp = { send: vi.fn().mockRejectedValue(new Error("UnknownMethod")) };
    expect(await captureScreenshot(cdp as any)).toBeNull();
  });

  it("returns null when data field is missing", async () => {
    const cdp = { send: vi.fn().mockResolvedValue({}) };
    expect(await captureScreenshot(cdp as any)).toBeNull();
  });

  it("passes captureBeyondViewport when fullPage:true", async () => {
    const cdp = { send: vi.fn().mockResolvedValue({ data: "abc" }) };
    await captureScreenshot(cdp as any, { fullPage: true });
    expect(cdp.send).toHaveBeenCalledWith("Page.captureScreenshot", expect.objectContaining({ captureBeyondViewport: true }));
  });
});
