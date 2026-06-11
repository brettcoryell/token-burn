import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { SessionRecord } from '../types'
import { formatTokens } from '../utils/tokens'
import { formatDateShort } from '../utils/dates'

interface Props {
  sessions: SessionRecord[]
}

const MIN_SESSION_TOKENS = 10_000

export function Drivers({ sessions }: Props) {
  const top = useMemo(() => {
    // Sum tokens per day to identify busy days
    const dailyMap = new Map<string, number>()
    for (const s of sessions) {
      dailyMap.set(s.session_date, (dailyMap.get(s.session_date) ?? 0) + s.total_tokens)
    }

    // 7-day avg of daily totals (most recent 7 days with data)
    const sortedDates = [...dailyMap.keys()].sort().reverse().slice(0, 7)
    const avg7 = sortedDates.reduce((sum, d) => sum + (dailyMap.get(d) ?? 0), 0)
      / Math.max(sortedDates.length, 1)

    const busyDates = new Set(
      [...dailyMap.entries()].filter(([, t]) => t > avg7).map(([d]) => d)
    )

    return sessions
      .filter(s => s.driver && s.total_tokens >= MIN_SESSION_TOKENS && busyDates.has(s.session_date))
      .sort((a, b) => b.total_tokens - a.total_tokens)
      .slice(0, 10)
      .map(s => ({
        label: `${s.driver} · ${formatDateShort(s.session_date)}`,
        driver: s.driver!,
        tokens: s.total_tokens,
      }))
  }, [sessions])

  if (top.length === 0) {
    return (
      <section className="mb-10">
        <h2
          className="text-sm font-medium uppercase tracking-wide mb-3"
          style={{ color: 'var(--tb-txt-muted)' }}
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
          className="text-sm font-medium uppercase tracking-wide"
          style={{ color: 'var(--tb-txt-muted)' }}
        >
          Drivers on busy days
        </h2>
        <span className="text-xs" style={{ color: 'var(--tb-txt-faint)' }}>
          above 7-day avg · per session
        </span>
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={top}
            margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
          >
            <XAxis
              type="number"
              tickFormatter={formatTokens}
              tick={{ fill: 'var(--tb-chart-axis)', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={160}
              tick={{ fill: 'var(--tb-txt-muted)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--tb-card)',
                border: '1px solid var(--tb-border)',
                borderRadius: 8,
                color: 'var(--tb-txt)',
              }}
              labelStyle={{ color: 'var(--tb-txt-muted)', fontSize: 11 }}
              formatter={(val: number) => [formatTokens(val), 'Session tokens']}
              cursor={{ fill: 'var(--tb-card-hover)' }}
            />
            <Bar dataKey="tokens" radius={[0, 3, 3, 0]} maxBarSize={20}>
              {top.map((_, i) => (
                <Cell
                  key={i}
                  fill={i === 0 ? 'var(--tb-accent)' : 'var(--tb-accent-dim)'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
