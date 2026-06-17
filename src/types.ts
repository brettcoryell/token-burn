// Day-level aggregated record — returned by /api/daily
export interface DayRecord {
  date: string                        // "YYYY-MM-DD"
  total_exact: number                 // sum of exact (Claude Code + Codex) tokens
  total_est: number                   // sum of estimated (Claude Chat) tokens
  claude_code_sessions: number        // count of Code sessions
  claude_chat_sessions: number        // count of Chat sessions
  claude_code_api_requests: number    // sum of API requests from Code sessions
  codex_sessions?: number             // count of Codex sessions
  codex_api_requests?: number         // sum of token-count events from Codex sessions
  sources: string[]                   // distinct machine names
  driver: string                      // most recent non-null driver, or ''
}

// Session-level record — returned by /api/sessions
export interface SessionRecord {
  id: string
  session_id: string
  machine: string
  session_date: string
  agent: 'claude-code' | 'claude-chat' | 'codex'
  total_tokens: number
  api_requests: number
  driver: string | null
  notes: string | null
  fidelity: 'exact' | 'estimated'
  created_at: string
}

export type TimeRange = '30d' | '90d' | '1y' | 'all'

export const TIME_RANGE_DAYS: Record<TimeRange, number | null> = {
  '30d': 30,
  '90d': 90,
  '1y': 365,
  'all': null,
}

export const DRIVER_LABELS: Record<string, string> = {
  infrastructure: 'Infrastructure',
  career:         'Career',
  creative:       'Creative',
  markets:        'Markets',
  research:       'Research',
  personal:       'Personal',
}
