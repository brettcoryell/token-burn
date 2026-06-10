import { useMemo } from 'react'
import { DayRecord, DRIVER_LABELS } from '../types'
import { FidelityBadge } from './FidelityBadge'
import { formatTokens, formatTokensExact } from '../utils/tokens'
import { formatDateDisplay } from '../utils/dates'

interface Props {
  records: DayRecord[]
}

export function DailyTable({ records }: Props) {
  const sorted = useMemo(
    () => [...records].sort((a, b) => b.date.localeCompare(a.date)),
    [records]
  )

  if (sorted.length === 0) return null

  return (
    <section className="mb-10">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wide">
          Daily detail
        </h2>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900">
              <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">
                Date
              </th>
              <th className="text-right py-2 px-3 text-xs font-medium uppercase tracking-wide whitespace-nowrap">
                <span className="text-cyan-600">MEASURED</span>
                <span className="text-slate-500 ml-1">Exact</span>
              </th>
              <th className="text-right py-2 px-3 text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">
                Code sessions
              </th>
              <th className="text-right py-2 px-3 text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">
                API Requests
              </th>
              <th className="text-right py-2 px-3 text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">
                Claude Chat Est
              </th>
              <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 uppercase tracking-wide">
                Driver
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const isEstOnly = r.total_exact === 0 && r.total_est > 0
              return (
                <tr
                  key={r.date}
                  className={`border-b border-slate-800 ${i % 2 === 0 ? 'bg-slate-950' : 'bg-slate-900/50'} hover:bg-slate-800/50 transition-colors`}
                >
                  <td className="py-2 px-3 text-slate-300 whitespace-nowrap font-mono text-xs">
                    {formatDateDisplay(r.date)}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-xs whitespace-nowrap">
                    {isEstOnly ? (
                      <span className="text-slate-600">—</span>
                    ) : (
                      <span className="text-slate-200">{formatTokensExact(r.total_exact)}</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-xs text-slate-500 whitespace-nowrap">
                    {r.claude_code_sessions > 0 ? r.claude_code_sessions : '—'}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-xs text-slate-500 whitespace-nowrap">
                    {r.claude_code_api_requests > 0 ? r.claude_code_api_requests : '—'}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-xs whitespace-nowrap">
                    {r.total_est > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="text-amber-400">~{formatTokens(r.total_est)}</span>
                        <FidelityBadge type="estimated" />
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-xs text-slate-500 max-w-40 truncate">
                    {r.driver ? (DRIVER_LABELS[r.driver] ?? r.driver) : ''}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
