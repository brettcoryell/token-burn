import { useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { DayRecord } from '../types'
import { aggregateWeekly, formatDateShort } from '../utils/dates'
import { formatTokens } from '../utils/tokens'

// Recharts passes these as SVG presentation attributes — CSS vars don't reliably
// resolve that way. Use hex directly for chart stroke/fill; the CSS var values are
// the source of truth in index.css.
const C = {
  accent:     '#22d3ee',  // --tb-accent
  yellow:     '#f59e0b',  // --tb-yellow
  axis:       '#334155',  // --tb-chart-axis
  border:     '#1e293b',  // --tb-border
  card:       '#0f172a',  // --tb-card
  txtMuted:   '#94a3b8',  // --tb-txt-muted
}

interface Props {
  records: DayRecord[]
}

export function TrendLine({ records }: Props) {
  const weeks = useMemo(
    () => aggregateWeekly(records).filter(w => w.total_exact > 0),
    [records]
  )

  const peakWeek = useMemo(() => {
    if (weeks.length === 0) return null
    return weeks.reduce((max, w) => (w.total_exact > max.total_exact ? w : max), weeks[0]!)
  }, [weeks])

  if (weeks.length === 0) return null

  const hasEst = weeks.some(w => w.total_est > 0)

  return (
    <section className="mb-10">
      <div className="flex items-baseline justify-between mb-3">
        <h2
          className="text-sm font-medium uppercase tracking-wide"
          style={{ color: 'var(--tb-txt-muted)' }}
        >
          Weekly total
        </h2>
        <span className="text-xs" style={{ color: 'var(--tb-txt-muted)' }}>
          log y-scale · exact only
        </span>
      </div>

      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={weeks} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="weekStart"
              tickFormatter={formatDateShort}
              tick={{ fill: C.axis, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              scale="log"
              domain={['auto', 'auto']}
              tickFormatter={formatTokens}
              tick={{ fill: C.axis, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={48}
            />
            <Tooltip
              contentStyle={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                color: '#e2e8f0',
              }}
              labelStyle={{ color: C.txtMuted, fontSize: 11 }}
              formatter={(val: number, name: string) => [
                formatTokens(val),
                name === 'total_exact' ? 'Exact (measured)' : 'Chat (estimated)',
              ]}
              labelFormatter={formatDateShort}
            />
            {peakWeek && (
              <ReferenceLine
                x={peakWeek.weekStart}
                stroke={C.border}
                label={{
                  value: `Peak ${formatTokens(peakWeek.total_exact)}`,
                  position: 'insideTopRight',
                  fill: C.axis,
                  fontSize: 10,
                }}
              />
            )}
            <Line
              type="monotone"
              dataKey="total_exact"
              stroke={C.accent}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3, fill: C.accent }}
            />
            {hasEst && (
              <Line
                type="monotone"
                dataKey="total_est"
                stroke={C.yellow}
                strokeWidth={1}
                strokeDasharray="4 2"
                dot={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
