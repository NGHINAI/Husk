import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";

// DUPLICATED from / will-be-shared-with mcp/src/binary.ts
// (v0.1: consolidate into @husk/shared workspace package)

export class LightpandaNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LightpandaNotFoundError";
  }
}

/**
 * Locate the lightpanda binary on the local filesystem.
 *
 * Resolution order:
 *   1. `LIGHTPANDA_BIN` environment variable, if set, must point to an
 *      executable file.
 *   2. `lightpanda` discovered on `PATH` via directory scan.
 *
 * @throws {LightpandaNotFoundError} if neither path resolves to an
 *   executable. Error message includes the install hint.
 */
export async function locateLightpanda(): Promise<string> {
  const envPath = process.env.LIGHTPANDA_BIN;
  if (envPath) {
    if (await isExecutable(envPath)) return envPath;
    throw new LightpandaNotFoundError(
      `LIGHTPANDA_BIN is set to "${envPath}" but the path is not an executable file. ` +
        `Verify the file exists and has exec permissions, or unset LIGHTPANDA_BIN. ` +
        `See docs/quickstart.md.`
    );
  }

  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(delimiter).filter(Boolean)) {
    const candidate = join(dir, "lightpanda");
    if (await isExecutable(candidate)) return candidate;
  }

  throw new LightpandaNotFoundError(
    `No lightpanda binary found on PATH and LIGHTPANDA_BIN is unset. ` +
      `Download a prebuilt binary from https://github.com/lightpanda-io/browser/releases ` +
      `and either place it on PATH or set LIGHTPANDA_BIN to its absolute location. ` +
      `See docs/quickstart.md.`
  );
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
