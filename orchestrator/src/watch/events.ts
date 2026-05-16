import type { FindCandidate } from "../session/find.js";

export type WatchEvent =
  | { kind: "snapshot"; ts: number; url: string; node_count: number; mode: "full" | "terse" }
  | { kind: "action"; ts: number; verb: "click" | "type" | "scroll" | "press_key" | "upload"; stable_id: string | null; ok: boolean; diff?: { added: number; removed: number; changed: number } }
  | { kind: "rejection"; ts: number; verb: string; reason: string; candidates: Array<{ stable_id: string; role: string; name: string; score: number }> }
  | { kind: "navigation"; ts: number; url: string }
  | { kind: "find"; ts: number; intent: string; candidates: FindCandidate[] };
