/** Minimal subset of CdpClient we need; eases mocking. */
export interface CdpLike {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>;
}

/** Allowed keys for `press`. Maps friendly name → (key, code, [windowsVirtualKeyCode]). */
const KEY_MAP: Record<string, { key: string; code: string; vkc?: number }> = {
  Enter: { key: "Enter", code: "Enter", vkc: 13 },
  Tab: { key: "Tab", code: "Tab", vkc: 9 },
  Escape: { key: "Escape", code: "Escape", vkc: 27 },
  Backspace: { key: "Backspace", code: "Backspace", vkc: 8 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", vkc: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", vkc: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", vkc: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", vkc: 39 },
  Space: { key: " ", code: "Space", vkc: 32 },
};

/**
 * Resolve `backendNodeId` to (centerX, centerY) via DOM.getBoxModel.
 * CDP returns `content` as 8 numbers [x1,y1,x2,y2,x3,y3,x4,y4] — top-left,
 * top-right, bottom-right, bottom-left. Center is average of (x1,x3) and (y1,y3).
 */
async function centerOf(
  cdp: CdpLike,
  sessionId: string,
  backendNodeId: number
): Promise<{ x: number; y: number }> {
  const res = (await cdp.send("DOM.getBoxModel", { backendNodeId }, sessionId)) as {
    model: { content: number[] };
  };
  const c = res.model.content;
  return { x: (c[0] + c[4]) / 2, y: (c[1] + c[5]) / 2 };
}

/** Click at element center. Pressed + released. No double-click. */
export async function dispatchClick(
  cdp: CdpLike,
  sessionId: string,
  backendNodeId: number
): Promise<void> {
  const { x, y } = await centerOf(cdp, sessionId, backendNodeId);
  await cdp.send(
    "Input.dispatchMouseEvent",
    { type: "mousePressed", x, y, button: "left", clickCount: 1 },
    sessionId
  );
  await cdp.send(
    "Input.dispatchMouseEvent",
    { type: "mouseReleased", x, y, button: "left", clickCount: 1 },
    sessionId
  );
}

/** Focus element then type each char via CDP char events. */
export async function dispatchType(
  cdp: CdpLike,
  sessionId: string,
  backendNodeId: number,
  text: string
): Promise<void> {
  await cdp.send("DOM.focus", { backendNodeId }, sessionId);
  for (const ch of text) {
    await cdp.send("Input.dispatchKeyEvent", { type: "char", text: ch }, sessionId);
  }
}

export type ScrollDirection = "up" | "down" | "left" | "right" | "into_view";

/**
 * Scroll. Two modes:
 *   - `backendNodeId == null`: window-level mouseWheel in the given direction.
 *   - `backendNodeId != null`: scrolls the element into view (direction is ignored).
 */
export async function dispatchScroll(
  cdp: CdpLike,
  sessionId: string,
  backendNodeId: number | null,
  direction: ScrollDirection,
  amount: number
): Promise<void> {
  if (backendNodeId != null) {
    await cdp.send("DOM.scrollIntoViewIfNeeded", { backendNodeId }, sessionId);
    return;
  }
  let deltaX = 0;
  let deltaY = 0;
  switch (direction) {
    case "down":
      deltaY = amount;
      break;
    case "up":
      deltaY = -amount;
      break;
    case "right":
      deltaX = amount;
      break;
    case "left":
      deltaX = -amount;
      break;
    case "into_view":
      return;
  }
  await cdp.send(
    "Input.dispatchMouseEvent",
    { type: "mouseWheel", x: 0, y: 0, deltaX, deltaY },
    sessionId
  );
}

/** Press a single named key. Sends keyDown + keyUp. */
export async function dispatchPress(
  cdp: CdpLike,
  sessionId: string,
  key: string
): Promise<void> {
  const k = KEY_MAP[key];
  if (!k) throw new Error(`Unknown key: ${key}. Allowed: ${Object.keys(KEY_MAP).join(", ")}`);
  const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vkc };
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...base }, sessionId);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base }, sessionId);
}
