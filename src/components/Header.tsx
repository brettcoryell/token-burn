import { DayRecord, TimeRange } from '../types'
import { FidelityBadge } from './FidelityBadge'
import { formatTokens } from '../utils/tokens'
import { formatDateDisplay } from '../utils/dates'

interface Props {
  records: DayRecord[]
  range: TimeRange
  onRangeChange: (r: TimeRange) => void
  lastUpdated: string | null
}

const RANGES: TimeRange[] = ['30d', '90d', '1y', 'all']
const RANGE_LABELS: Record<TimeRange, string> = {
  '30d': '30d', '90d': '90d', '1y': '1y', 'all': 'All',
}

export function Header({ records, range, onRangeChange, lastUpdated }: Props) {
  const totalExact = records.reduce((s, r) => s + r.total_exact, 0)
  const totalEst = records.reduce((s, r) => s + r.total_est, 0)
  const totalSessions = records.reduce((s, r) => s + r.claude_code_sessions, 0)

  return (
    <header className="pb-6 mb-8" style={{ borderBottom: '1px solid var(--tb-border)' }}>
      <div className="flex items-start justify-between mb-6">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--tb-txt-faint)' }}>
            Token Burn Dashboard
          </p>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--tb-txt)' }}>
            AI usage by day
          </h1>
          {lastUpdated && (
            <p className="text-xs mt-1" style={{ color: 'var(--tb-txt-faint)' }}>
              Updated {formatDateDisplay(lastUpdated)}
            </p>
          )}
        </div>

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
              className={`px-3 py-1 text-sm rounded transition-colors tb-range-btn`}
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

      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-4">
        <div
          className="rounded-lg p-4"
          style={{ backgroundColor: 'var(--tb-card)', border: '1px solid var(--tb-border)' }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--tb-txt-faint)' }}>
              Exact Total
            </span>
            <FidelityBadge type="measured" />
          </div>
          <div className="text-3xl font-bold tabular-nums" style={{ color: 'var(--tb-txt)' }}>
            {formatTokens(totalExact)}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--tb-txt-faint)' }}>
            Claude Code tokens
          </div>
        </div>

        <div
          className="rounded-lg p-4"
          style={{ backgroundColor: 'var(--tb-card)', border: '1px solid var(--tb-border)' }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--tb-txt-faint)' }}>
              Sessions
            </span>
            <FidelityBadge type="measured" />
          </div>
          <div className="text-3xl font-bold tabular-nums" style={{ color: 'var(--tb-txt)' }}>
            {totalSessions.toLocaleString()}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--tb-txt-faint)' }}>
            Claude Code sessions
          </div>
        </div>

        <div
          className="rounded-lg p-4"
          style={{ backgroundColor: 'var(--tb-card)', border: '1px solid var(--tb-border)' }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--tb-txt-faint)' }}>
              Est. Chat
            </span>
            <FidelityBadge type="estimated" />
          </div>
          <div className="text-3xl font-bold tabular-nums" style={{ color: totalEst > 0 ? 'var(--tb-yellow)' : 'var(--tb-txt-faint)' }}>
            {totalEst > 0 ? `~${formatTokens(totalEst)}` : '—'}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--tb-txt-faint)' }}>
            Floor estimate · Claude Chat
          </div>
        </div>
      </div>
    </header>
  )
}
