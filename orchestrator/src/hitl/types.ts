export interface PendingQuestion {
  token: string;
  session_id: string;
  question: string;
  options?: string[];
  created_at: number;
}

export interface ResolvedQuestion {
  answer?: string;
  index?: number;
  timed_out?: boolean;
  ms_waited: number;
}

export interface PendingHandoff {
  token: string;
  session_id: string;
  reason: string;
  suggested_action?: string;
  current_url?: string;
  need_cookies_back?: boolean;
  created_at: number;
}

export interface ResumeCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  /** If only `raw` is set, the resume endpoint parses it as `name=value`. */
  raw?: string;
}

export interface ResolvedHandoff {
  resumed: boolean;
  reason?: "timeout";
  cookies_imported?: number;
  cookies?: ResumeCookie[];  // raw cookies — Session.importCookies uses these
  ms_paused: number;
  human_note?: string;
}
