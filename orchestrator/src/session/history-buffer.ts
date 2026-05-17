export type HistoryVerb = "goto" | "click" | "type" | "scroll" | "press_key" | "upload" | "login" | "extract";

export interface HistoryEntry {
  verb: HistoryVerb;
  target_name: string | null; // resolved AX name of the target, when applicable (e.g., "Sign in")
  ok: boolean;
  ts: number;
  url_after?: string;
}

export class HistoryBuffer {
  private entries: HistoryEntry[] = [];
  constructor(private maxSize: number = 10) {}

  add(e: HistoryEntry): void {
    this.entries.push(e);
    if (this.entries.length > this.maxSize) this.entries.shift();
  }

  recent(): HistoryEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }
}
