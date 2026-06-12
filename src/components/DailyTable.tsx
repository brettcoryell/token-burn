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
        <h2
          className="text-sm font-semibold uppercase tracking-wide"
          style={{ color: 'var(--tb-txt)' }}
        >
          Daily detail
        </h2>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr style={{ borderBottom: '0.5px solid var(--tb-border)', backgroundColor: 'var(--tb-card)' }}>
              <th
                className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wide whitespace-nowrap"
                style={{ color: 'var(--tb-txt-faint)' }}
              >
                Date
              </th>
              <th className="text-right py-2 px-3 text-xs font-medium uppercase tracking-wide whitespace-nowrap">
                <span className="inline-flex items-center gap-1">
                  <FidelityBadge type="measured" />
                  <span style={{ color: 'var(--tb-txt-faint)' }}>Exact</span>
                </span>
              </th>
              <th
                className="text-right py-2 px-3 text-xs font-medium uppercase tracking-wide whitespace-nowrap"
                style={{ color: 'var(--tb-txt-faint)' }}
              >
                Code sessions
              </th>
              <th
                className="text-right py-2 px-3 text-xs font-medium uppercase tracking-wide whitespace-nowrap"
                style={{ color: 'var(--tb-txt-faint)' }}
              >
                API Requests
              </th>
              <th
                className="text-right py-2 px-3 text-xs font-medium uppercase tracking-wide whitespace-nowrap"
                style={{ color: 'var(--tb-txt-faint)' }}
              >
                Claude Chat Est
              </th>
              <th
                className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wide"
                style={{ color: 'var(--tb-txt-faint)' }}
              >
                Driver
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, idx) => {
              const isEstOnly = r.total_exact === 0 && r.total_est > 0
              const isLast = idx === sorted.length - 1
              return (
                <tr
                  key={r.date}
                  className="tb-row-hover transition-colors"
                  style={{
                    borderBottom: isLast ? 'none' : '0.5px solid var(--tb-border)',
                    backgroundColor: 'var(--tb-card)',
                  }}
                >
                  <td
                    className="py-2 px-3 whitespace-nowrap text-xs tabular-nums"
                    style={{ color: 'var(--tb-data-date)' }}
                  >
                    {formatDateDisplay(r.date)}
                  </td>
                  <td className="py-2 px-3 text-right text-xs tabular-nums whitespace-nowrap">
                    {isEstOnly ? (
                      <span style={{ color: 'var(--tb-data-empty)' }}>—</span>
                    ) : (
                      <span style={{ color: 'var(--tb-data-primary)' }}>{formatTokensExact(r.total_exact)}</span>
                    )}
                  </td>
                  <td
                    className="py-2 px-3 text-right text-xs tabular-nums whitespace-nowrap"
                    style={{ color: r.claude_code_sessions > 0 ? 'var(--tb-data-secondary)' : 'var(--tb-data-empty)' }}
                  >
                    {r.claude_code_sessions > 0 ? r.claude_code_sessions : '—'}
                  </td>
                  <td
                    className="py-2 px-3 text-right text-xs tabular-nums whitespace-nowrap"
                    style={{ color: r.claude_code_api_requests > 0 ? 'var(--tb-data-secondary)' : 'var(--tb-data-empty)' }}
                  >
                    {r.claude_code_api_requests > 0 ? r.claude_code_api_requests : '—'}
                  </td>
                  <td className="py-2 px-3 text-right text-xs tabular-nums whitespace-nowrap">
                    {r.total_est > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <span style={{ color: 'var(--tb-yellow)' }}>~{formatTokens(r.total_est)}</span>
                        <FidelityBadge type="estimated" />
                      </span>
                    ) : (
                      <span style={{ color: 'var(--tb-data-empty)' }}>—</span>
                    )}
                  </td>
                  <td
                    className="py-2 px-3 text-xs max-w-40 truncate"
                    style={{ color: r.driver ? 'var(--tb-data-secondary)' : 'var(--tb-data-empty)' }}
                  >
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
