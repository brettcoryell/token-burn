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
    <header className="border-b border-slate-800 pb-6 mb-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <p className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-1">
            Token Burn Dashboard
          </p>
          <h1 className="text-2xl font-bold text-slate-100">
            AI usage by day
          </h1>
          {lastUpdated && (
            <p className="text-xs text-slate-600 mt-1">
              Updated {formatDateDisplay(lastUpdated)}
            </p>
          )}
        </div>

        {/* Time range selector */}
        <div className="flex gap-1 bg-slate-900 rounded-md p-1 border border-slate-800">
          {RANGES.map(r => (
            <button
              key={r}
              data-range={r}
              onClick={() => onRangeChange(r)}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                range === r
                  ? 'bg-slate-700 text-slate-100'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-slate-500 uppercase tracking-wide">Exact Total</span>
            <FidelityBadge type="measured" />
          </div>
          <div className="text-3xl font-bold text-slate-100 font-mono">
            {formatTokens(totalExact)}
          </div>
          <div className="text-xs text-slate-600 mt-1">Claude Code tokens</div>
        </div>

        <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-slate-500 uppercase tracking-wide">Sessions</span>
            <FidelityBadge type="measured" />
          </div>
          <div className="text-3xl font-bold text-slate-100 font-mono">
            {totalSessions.toLocaleString()}
          </div>
          <div className="text-xs text-slate-600 mt-1">Claude Code sessions</div>
        </div>

        <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-slate-500 uppercase tracking-wide">Est. Chat</span>
            <FidelityBadge type="estimated" />
          </div>
          <div className="text-3xl font-bold text-amber-400 font-mono">
            {totalEst > 0 ? `~${formatTokens(totalEst)}` : '—'}
          </div>
          <div className="text-xs text-slate-600 mt-1">Floor estimate · Claude Chat</div>
        </div>
      </div>
    </header>
  )
}
