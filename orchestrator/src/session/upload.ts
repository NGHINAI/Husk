import { existsSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";

export interface UploadInput {
  stable_id: string;
  file_path?: string;
  content_base64?: string;
  filename?: string;
}

export interface UploadResult {
  ok: boolean;
  reason?: string;
}

export interface UploadCtx {
  cdp: { send(method: string, params: unknown): Promise<unknown> };
  resolveBackendNodeId: (stable_id: string) => Promise<number>;
}

export async function runUpload(ctx: UploadCtx, input: UploadInput): Promise<UploadResult> {
  if (!input.file_path && !input.content_base64) {
    throw new Error("husk_upload requires file_path or content_base64");
  }

  let absPath: string;
  if (input.file_path) {
    absPath = resolvePath(input.file_path);
    if (!existsSync(absPath)) {
      return { ok: false, reason: `file not found: ${absPath}` };
    }
  } else {
    if (!input.filename) {
      throw new Error("husk_upload: content_base64 requires filename");
    }
    const dir = mkdtempSync(join(tmpdir(), "husk-upload-"));
    absPath = join(dir, input.filename);
    writeFileSync(absPath, Buffer.from(input.content_base64!, "base64"));
  }

  const backendNodeId = await ctx.resolveBackendNodeId(input.stable_id);
  await ctx.cdp.send("DOM.setFileInputFiles", { files: [absPath], backendNodeId });
  return { ok: true };
}
