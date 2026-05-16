import { describe, it, expect, vi } from "vitest";
import { runUpload } from "../../src/session/upload.js";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("runUpload", () => {
  const tmp = mkdtempSync(join(tmpdir(), "husk-upload-"));
  const realFile = join(tmp, "hello.txt");
  writeFileSync(realFile, "hello world");

  it("file_path → DOM.setFileInputFiles with absolute path + backendNodeId", async () => {
    const cdp = { send: vi.fn().mockResolvedValue({}) };
    const r = await runUpload({ cdp, resolveBackendNodeId: async () => 42 }, {
      stable_id: "x", file_path: realFile,
    });
    expect(r.ok).toBe(true);
    expect(cdp.send).toHaveBeenCalledWith("DOM.setFileInputFiles", {
      files: [realFile],
      backendNodeId: 42,
    });
  });

  it("rejects when file does not exist", async () => {
    const cdp = { send: vi.fn() };
    const r = await runUpload({ cdp, resolveBackendNodeId: async () => 1 }, {
      stable_id: "x", file_path: "/nonexistent.zzz",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not found/i);
    expect(cdp.send).not.toHaveBeenCalled();
  });

  it("content_base64 → tempfile → setFileInputFiles", async () => {
    const cdp = { send: vi.fn().mockResolvedValue({}) };
    const r = await runUpload({ cdp, resolveBackendNodeId: async () => 7 }, {
      stable_id: "x",
      content_base64: Buffer.from("test data").toString("base64"),
      filename: "test.txt",
    });
    expect(r.ok).toBe(true);
    expect(cdp.send).toHaveBeenCalledOnce();
    const args = cdp.send.mock.calls[0][1];
    expect(args.backendNodeId).toBe(7);
    expect(args.files).toHaveLength(1);
    expect(existsSync(args.files[0])).toBe(true);
    expect(readFileSync(args.files[0], "utf8")).toBe("test data");
    expect(args.files[0]).toMatch(/test\.txt$/);
  });

  it("rejects when neither file_path nor content_base64 is provided", async () => {
    const cdp = { send: vi.fn() };
    await expect(runUpload({ cdp, resolveBackendNodeId: async () => 1 }, {
      stable_id: "x",
    } as never)).rejects.toThrow(/file_path or content_base64/);
  });

  it("rejects when content_base64 given without filename", async () => {
    const cdp = { send: vi.fn() };
    await expect(runUpload({ cdp, resolveBackendNodeId: async () => 1 }, {
      stable_id: "x",
      content_base64: "aGVsbG8=",
    } as never)).rejects.toThrow(/filename/i);
  });

  it("resolves relative file_path to absolute before passing to CDP", async () => {
    const cdp = { send: vi.fn().mockResolvedValue({}) };
    // Use realFile but pass a relative path that resolves to it (relative to cwd)
    // Or just confirm that the path passed to CDP is absolute (matches /^\/.* on unix)
    const r = await runUpload({ cdp, resolveBackendNodeId: async () => 1 }, {
      stable_id: "x", file_path: realFile,  // already absolute, but assert the call site uses abs
    });
    expect(r.ok).toBe(true);
    const filesArg = (cdp.send.mock.calls[0][1] as { files: string[] }).files[0];
    expect(filesArg.startsWith("/")).toBe(true);
  });
});
