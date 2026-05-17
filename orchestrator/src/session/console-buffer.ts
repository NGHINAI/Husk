export type ConsoleLevel = "log" | "warn" | "error" | "info" | "debug";

export interface ConsoleMessage {
  level: ConsoleLevel;
  text: string;
  ts: number;
}

export class ConsoleBuffer {
  private entries: ConsoleMessage[] = [];
  constructor(private maxSize: number = 50) {}

  add(msg: ConsoleMessage): void {
    this.entries.push(msg);
    if (this.entries.length > this.maxSize) this.entries.shift();
  }

  recent(): ConsoleMessage[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }
}
