export type DialogType = "alert" | "confirm" | "prompt" | "beforeunload";

export interface DialogEvent {
  type: DialogType;
  message: string;
  url: string;
}

export interface PendingDialog {
  type: DialogType;
  message: string;
}

interface CdpLike {
  send(method: string, params: unknown): Promise<unknown>;
}

export interface DialogHandlerOpts {
  autoDismissMs?: number;
}

/**
 * Handles JS modal dialogs (alert/confirm/prompt/beforeunload) emitted via
 * the CDP Page.javascriptDialogOpening event.
 *
 * Default behaviour: auto-dismiss (accept: false) after `autoDismissMs` (default 100ms).
 * This prevents pages from deadlocking while keeping the common case fully hands-off.
 *
 * Advanced callers can call `manualHandle(action, text?)` to accept or dismiss
 * explicitly. The JSON-RPC `dialog` method exposes this; MCP does NOT expose it
 * (auto-dismiss handles 99% of cases — see Decision N in M15 spec).
 */
export class DialogHandler {
  private current: DialogEvent | null = null;
  private autoTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly autoMs: number;

  constructor(private cdp: CdpLike, opts: DialogHandlerOpts = {}) {
    this.autoMs = opts.autoDismissMs ?? 100;
  }

  /** Call when CDP emits Page.javascriptDialogOpening. */
  onDialog(e: DialogEvent): void {
    // Cancel any previous timer (a new dialog replaces a previous unhandled one).
    // In practice browsers only emit one dialog at a time, but handle rapid succession
    // defensively: the second call cancels the first timer so it never fires.
    if (this.autoTimer) {
      clearTimeout(this.autoTimer);
      this.autoTimer = null;
    }
    this.current = e;
    const captured = e;
    this.autoTimer = setTimeout(() => {
      if (this.current === captured) {
        this.current = null;
        this.autoTimer = null;
        // Auto-dismiss: accept:false is the safe default for all dialog types.
        // Use async IIFE so we can await and catch without touching the return value
        // of send() (some mocks don't return a real Promise with .catch).
        void (async () => {
          try {
            await this.cdp.send("Page.handleJavaScriptDialog", {
              accept: false,
              promptText: undefined,
            });
          } catch {
            // CDP send error swallowed — lightpanda may not implement
            // Page.handleJavaScriptDialog; auto-dismiss is best-effort.
          }
        })();
      }
    }, this.autoMs);
  }

  /** Returns the pending dialog (stripped of url) or null when none is open. */
  pending(): PendingDialog | null {
    if (!this.current) return null;
    return { type: this.current.type, message: this.current.message };
  }

  /**
   * Manually handle the pending dialog. Cancels the auto-dismiss timer.
   * No-op (no throw) when no dialog is open.
   *
   * @param action "accept" or "dismiss"
   * @param text   Optional text for prompt dialogs.
   */
  async manualHandle(action: "accept" | "dismiss", text?: string): Promise<void> {
    if (!this.current) return;
    if (this.autoTimer) {
      clearTimeout(this.autoTimer);
      this.autoTimer = null;
    }
    // Clear current before the async send so pending() returns null immediately.
    this.current = null;
    try {
      await this.cdp.send("Page.handleJavaScriptDialog", {
        accept: action === "accept",
        promptText: text,
      });
    } catch {
      // Swallow — lightpanda may not implement this command.
    }
  }
}
