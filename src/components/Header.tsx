import { useMemo } from 'react'
import { DayRecord, TimeRange } from '../types'
import { FidelityBadge } from './FidelityBadge'
import { HeroSparkline } from './HeroSparkline'
import { formatTokens } from '../utils/tokens'
import { formatDateDisplay } from '../utils/dates'

interface Props {
  records: DayRecord[]
  range: TimeRange
  onRangeChange: (r: TimeRange) => void
  lastUpdated: string | null
  theme: 'light' | 'dark'
  onThemeChange: (t: 'light' | 'dark') => void
}

const RANGES: TimeRange[] = ['30d', '90d', '1y', 'all']
const RANGE_LABELS: Record<TimeRange, string> = {
  '30d': '30d', '90d': '90d', '1y': '1y', 'all': 'All',
}

export function Header({ records, range, onRangeChange, lastUpdated, theme, onThemeChange }: Props) {
  const totalExact = records.reduce((s, r) => s + r.total_exact, 0)
  const totalEst = records.reduce((s, r) => s + r.total_est, 0)
  const totalSessions = records.reduce(
    (s, r) => s + r.claude_code_sessions + (r.codex_sessions ?? 0),
    0
  )

  const sortedAsc = useMemo(
    () => [...records].sort((a, b) => a.date.localeCompare(b.date)),
    [records]
  )
  const exactData    = useMemo(() => sortedAsc.map(r => r.total_exact), [sortedAsc])
  const sessionsData = useMemo(
    () => sortedAsc.map(r => r.claude_code_sessions + (r.codex_sessions ?? 0)),
    [sortedAsc]
  )
  const estData      = useMemo(() => sortedAsc.map(r => r.total_est), [sortedAsc])

  return (
    <header className="pb-6 mb-8" style={{ borderBottom: '1px solid var(--tb-border)' }}>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl mb-1" style={{ fontFamily: "'Georgia', 'Times New Roman', serif", fontWeight: 400, color: 'var(--tb-txt)' }}>
            Token Burn Dashboard
          </h1>
          <p className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--tb-txt-muted)' }}>
            AI usage by day
          </p>
          {lastUpdated && (
            <p className="text-xs mt-1" style={{ color: 'var(--tb-txt-faint)' }}>
              Updated {formatDateDisplay(lastUpdated)}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Theme toggle */}
          <button
            onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}
            className="text-xs px-2 py-1 rounded transition-colors tb-range-btn"
            style={{
              color: 'var(--tb-txt-faint)',
              border: '1px solid var(--tb-border)',
            }}
          >
            {theme === 'dark' ? '☀ Light' : '🌙 Dark'}
          </button>

          {/* Time range selector */}
          <div
            className="flex gap-1 rounded-md p-1"
            style={{ backgroundColor: 'var(--tb-card)', border: '1px solid var(--tb-border)' }}
          >
            {RANGES.map(r => (
              <button
                key={r}
                data-range={r}
                onClick={() => onRangeChange(r)}
                className="px-3 py-1 text-sm rounded transition-colors tb-range-btn"
                style={{
                  backgroundColor: range === r ? 'var(--tb-card-hover)' : 'transparent',
                  color: range === r ? 'var(--tb-txt)' : 'var(--tb-txt-faint)',
                }}
              >
                {RANGE_LABELS[r]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div
          className="rounded-lg p-4 flex flex-col"
          style={{ backgroundColor: 'var(--tb-card)', border: '1px solid var(--tb-border)' }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--tb-txt-muted)' }}>
              Exact Total
            </span>
            <FidelityBadge type="measured" />
          </div>
          <div className="text-2xl font-semibold tabular-nums mb-1" style={{ color: 'var(--tb-txt)' }}>
            {formatTokens(totalExact)}
          </div>
          <div className="text-xs mb-3" style={{ color: 'var(--tb-txt-faint)' }}>
            Claude Code + Lumen tokens
          </div>
          <div
            className="mt-auto -mx-4 -mb-4 px-4 pt-3 pb-3 rounded-b-lg"
            style={{ backgroundColor: 'var(--tb-sparkline-bg)' }}
          >
            <HeroSparkline data={exactData} />
          </div>
        </div>

        <div
          className="rounded-lg p-4 flex flex-col"
          style={{ backgroundColor: 'var(--tb-card)', border: '1px solid var(--tb-border)' }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--tb-txt-muted)' }}>
              Sessions
            </span>
            <FidelityBadge type="measured" />
          </div>
          <div className="text-2xl font-semibold tabular-nums mb-1" style={{ color: 'var(--tb-txt)' }}>
            {totalSessions.toLocaleString()}
          </div>
          <div className="text-xs mb-3" style={{ color: 'var(--tb-txt-faint)' }}>
            Claude Code + Lumen sessions
          </div>
          <div
            className="mt-auto -mx-4 -mb-4 px-4 pt-3 pb-3 rounded-b-lg"
            style={{ backgroundColor: 'var(--tb-sparkline-bg)' }}
          >
            <HeroSparkline data={sessionsData} />
          </div>
        </div>

        <div
          className="rounded-lg p-4 flex flex-col"
          style={{ backgroundColor: 'var(--tb-card)', border: '1px solid var(--tb-border)' }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--tb-txt-muted)' }}>
              Est. Chat
            </span>
            <FidelityBadge type="estimated" />
          </div>
          <div className="text-2xl font-semibold tabular-nums mb-1" style={{ color: totalEst > 0 ? 'var(--tb-yellow)' : 'var(--tb-txt-faint)' }}>
            {totalEst > 0 ? `~${formatTokens(totalEst)}` : '—'}
          </div>
          <div className="text-xs mb-3" style={{ color: 'var(--tb-txt-faint)' }}>
            Floor estimate · Claude Chat
          </div>
          {totalEst > 0 && (
            <div
              className="mt-auto -mx-4 -mb-4 px-4 pt-3 pb-3 rounded-b-lg"
              style={{ backgroundColor: 'var(--tb-sparkline-bg)' }}
            >
              <HeroSparkline data={estData} dashed />
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
