import { DayRecord, TimeRange, TIME_RANGE_DAYS } from '../types'

export function filterByRange(records: DayRecord[], range: TimeRange): DayRecord[] {
  const days = TIME_RANGE_DAYS[range]
  if (days === null) return records
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  return records.filter(r => r.date >= cutoffStr)
}

// Parse "YYYY-MM-DD" to a Date at midnight UTC (avoids timezone offset issues)
export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!))
}

// Format a date string for display
export function formatDateDisplay(s: string): string {
  const d = parseDate(s)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export function formatDateShort(s: string): string {
  const d = parseDate(s)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// Get all dates in a range as "YYYY-MM-DD" strings, Sunday-first
export function getDatesInRange(start: Date, end: Date): string[] {
  const dates: string[] = []
  const cur = new Date(start)
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return dates
}

// Return the Sunday-start week start for a given date string
export function weekStart(dateStr: string): string {
  const d = parseDate(dateStr)
  const day = d.getUTCDay() // 0 = Sunday
  d.setUTCDate(d.getUTCDate() - day)
  return d.toISOString().slice(0, 10)
}

// Aggregate records into weekly buckets (Sunday-start), returning [{weekStart, total_exact, total_est}]
export function aggregateWeekly(records: DayRecord[]): { weekStart: string; total_exact: number; total_est: number }[] {
  const buckets = new Map<string, { total_exact: number; total_est: number }>()
  for (const r of records) {
    const ws = weekStart(r.date)
    const existing = buckets.get(ws) ?? { total_exact: 0, total_est: 0 }
    existing.total_exact += r.total_exact
    existing.total_est += r.total_est
    buckets.set(ws, existing)
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ws, v]) => ({ weekStart: ws, ...v }))
}

// Latest date in records
export function latestDate(records: DayRecord[]): string | null {
  if (records.length === 0) return null
  return records.reduce((max, r) => (r.date > max ? r.date : max), records[0]!.date)
}
