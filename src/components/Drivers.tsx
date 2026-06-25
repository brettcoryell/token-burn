import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { SessionRecord } from '../types'
import { formatTokens } from '../utils/tokens'
import { formatDateShort } from '../utils/dates'
import { getChartColors } from '../utils/chartColors'

interface Props {
  sessions: SessionRecord[]
  theme: 'light' | 'dark'
}

const MIN_SESSION_TOKENS = 10_000

export function Drivers({ sessions, theme }: Props) {
  const C = getChartColors(theme)

  const top = useMemo(() => {
    // Build per-day totals and per-driver token sums
    const dayTotals = new Map<string, number>()
    const dayDriverTokens = new Map<string, Map<string, number>>()

    for (const s of sessions) {
      if (s.total_tokens < MIN_SESSION_TOKENS) continue
      dayTotals.set(s.session_date, (dayTotals.get(s.session_date) ?? 0) + s.total_tokens)
      if (s.driver) {
        if (!dayDriverTokens.has(s.session_date)) dayDriverTokens.set(s.session_date, new Map())
        const dm = dayDriverTokens.get(s.session_date)!
        dm.set(s.driver, (dm.get(s.driver) ?? 0) + s.total_tokens)
      }
    }

    // 7-day avg from most recent 7 days
    const sortedDates = [...dayTotals.keys()].sort().reverse().slice(0, 7)
    const avg7 = sortedDates.reduce((sum, d) => sum + (dayTotals.get(d) ?? 0), 0)
      / Math.max(sortedDates.length, 1)

    const busyDates = new Set(
      [...dayTotals.entries()].filter(([, t]) => t > avg7).map(([d]) => d)
    )

    return [...busyDates]
      .filter(date => dayDriverTokens.has(date))
      .map(date => {
        const dm = dayDriverTokens.get(date)!
        const pluralityDriver = [...dm.entries()].reduce((a, b) => a[1] >= b[1] ? a : b)[0]
        return {
          label: `${pluralityDriver} · ${formatDateShort(date)}`,
          driver: pluralityDriver,
          tokens: dayTotals.get(date)!,
        }
      })
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 10)
  }, [sessions])

  if (top.length === 0) {
    return (
      <section className="mb-10">
        <h2
          className="text-sm font-semibold uppercase tracking-wide mb-3"
          style={{ color: 'var(--tb-txt)' }}
        >
          Drivers on busy days
        </h2>
        <p className="text-sm" style={{ color: 'var(--tb-txt-faint)' }}>
          Annotate sessions to see drivers
        </p>
      </section>
    )
  }

  return (
    <section className="mb-10">
      <div className="flex items-baseline justify-between mb-3">
        <h2
          className="text-sm font-semibold uppercase tracking-wide"
          style={{ color: 'var(--tb-txt)' }}
        >
          Drivers on busy days
        </h2>
        <span className="text-xs" style={{ color: 'var(--tb-txt-muted)' }}>
          above 7-day avg · per day
        </span>
      </div>

      <div
        className="h-64 rounded-lg"
        style={{ backgroundColor: C.barTrack }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={top}
            margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
          >
            <XAxis
              type="number"
              tickFormatter={formatTokens}
              tick={{ fill: C.axis, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={160}
              tick={{ fill: C.txtMuted, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                color: C.txt,
              }}
              labelStyle={{ color: C.txtMuted, fontSize: 11 }}
              formatter={(val: number) => [formatTokens(val), 'Day total']}
              cursor={{ fill: C.cardHover }}
            />
            <Bar
              dataKey="tokens"
              radius={[0, 3, 3, 0]}
              maxBarSize={20}
            >
              {top.map((_, i) => (
                <Cell key={i} fill={i === 0 ? C.peakBar : C.secondaryBar} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
