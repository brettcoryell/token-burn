// Closed schema — exactly 14 fields, mirrors SPEC.md
export interface DayRecord {
  date: string                   // "YYYY-MM-DD" Pacific time
  claude_code_input: number
  claude_code_output: number
  claude_code_cache_read: number
  claude_code_cache_create: number
  claude_code_api_requests: number
  claude_code_sessions: number
  claude_chat_sessions: number
  claude_chat_est: number
  total_exact: number
  total_est: number
  sources: string[]
  driver: string
  evidence: string
}

export type TimeRange = '30d' | '90d' | '1y' | 'all'

export const TIME_RANGE_DAYS: Record<TimeRange, number | null> = {
  '30d': 30,
  '90d': 90,
  '1y': 365,
  'all': null,
}

export const DRIVER_LABELS: Record<string, string> = {
  code: 'Software / Code',
  memoir: 'Memoir / OB',
  career: 'Career / ai-resume',
  markets: 'Markets / MSM',
  infrastructure: 'Infrastructure',
  research: 'Research',
  personal: 'Personal / Admin',
  mixed: 'Mixed',
}
