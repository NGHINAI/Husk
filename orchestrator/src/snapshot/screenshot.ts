export interface ScreenshotOpts {
  fullPage?: boolean;
}

export async function captureScreenshot(
  cdp: { send(m: string, p: unknown): Promise<{ data?: string }> },
  opts: ScreenshotOpts = {},
): Promise<string | null> {
  try {
    const r = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: opts.fullPage ?? false,
    });
    return r.data ?? null;
  } catch {
    return null;
  }
}
