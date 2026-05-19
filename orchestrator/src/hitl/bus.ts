import { randomUUID } from "node:crypto";
import type {
  PendingQuestion,
  PendingHandoff,
  ResolvedQuestion,
  ResolvedHandoff,
  ResumeCookie,
} from "./types.js";

interface QuestionEntry {
  pending: PendingQuestion;
  resolve: (v: ResolvedQuestion) => void;
  timer: NodeJS.Timeout;
}

interface HandoffEntry {
  pending: PendingHandoff;
  resolve: (v: ResolvedHandoff) => void;
  timer: NodeJS.Timeout;
}

export interface AskInput {
  question: string;
  options?: string[];
}

export interface HandoffInput {
  reason: string;
  suggested_action?: string;
  current_url?: string;
  need_cookies_back?: boolean;
}

export class HumanIOBus {
  private questions = new Map<string, QuestionEntry>();
  private handoffs = new Map<string, HandoffEntry>();

  askQuestion(
    sessionId: string,
    input: AskInput,
    timeoutMs: number,
  ): { token: string; promise: Promise<ResolvedQuestion> } {
    const token = randomUUID();
    const created = Date.now();
    let timer!: NodeJS.Timeout;
    const promise = new Promise<ResolvedQuestion>((resolve) => {
      timer = setTimeout(() => {
        this.questions.delete(token);
        resolve({ timed_out: true, ms_waited: Date.now() - created });
      }, timeoutMs);
      this.questions.set(token, {
        pending: {
          token,
          session_id: sessionId,
          question: input.question,
          options: input.options,
          created_at: created,
        },
        resolve: (v) => {
          clearTimeout(timer);
          this.questions.delete(token);
          resolve(v);
        },
        timer,
      });
    });
    return { token, promise };
  }

  answerQuestion(token: string, v: { answer?: string; index?: number }): void {
    const e = this.questions.get(token);
    if (!e) return;
    e.resolve({ ...v, ms_waited: Date.now() - e.pending.created_at });
  }

  startHandoff(
    sessionId: string,
    input: HandoffInput,
    timeoutMs: number,
  ): { token: string; promise: Promise<ResolvedHandoff> } {
    const token = randomUUID();
    const created = Date.now();
    let timer!: NodeJS.Timeout;
    const promise = new Promise<ResolvedHandoff>((resolve) => {
      timer = setTimeout(() => {
        this.handoffs.delete(token);
        resolve({ resumed: false, reason: "timeout", ms_paused: Date.now() - created, cookies_imported: 0, cookies: [] });
      }, timeoutMs);
      this.handoffs.set(token, {
        pending: {
          token,
          session_id: sessionId,
          reason: input.reason,
          suggested_action: input.suggested_action,
          current_url: input.current_url,
          need_cookies_back: input.need_cookies_back,
          created_at: created,
        },
        resolve: (v) => {
          clearTimeout(timer);
          this.handoffs.delete(token);
          resolve(v);
        },
        timer,
      });
    });
    return { token, promise };
  }

  resumeHandoff(token: string, v: { cookies?: ResumeCookie[]; note?: string }): void {
    const e = this.handoffs.get(token);
    if (!e) return;
    const cookies = v.cookies ?? [];
    e.resolve({
      resumed: true,
      cookies_imported: cookies.length,
      cookies,
      ms_paused: Date.now() - e.pending.created_at,
      human_note: v.note,
    });
  }

  getQuestion(token: string): PendingQuestion | null {
    return this.questions.get(token)?.pending ?? null;
  }

  getHandoff(token: string): PendingHandoff | null {
    return this.handoffs.get(token)?.pending ?? null;
  }

  listPendingQuestions(): PendingQuestion[] {
    return [...this.questions.values()].map((e) => e.pending);
  }

  listPendingHandoffs(): PendingHandoff[] {
    return [...this.handoffs.values()].map((e) => e.pending);
  }
}
