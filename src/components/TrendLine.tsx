import { useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { DayRecord } from '../types'
import { aggregateWeekly, formatDateShort } from '../utils/dates'
import { formatTokens } from '../utils/tokens'
import { getChartColors } from '../utils/chartColors'

interface Props {
  records: DayRecord[]
  theme: 'light' | 'dark'
}

export function TrendLine({ records, theme }: Props) {
  const C = getChartColors(theme)

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
          style={{ color: 'var(--tb-txt)' }}
        >
          Weekly total
        </h2>
        <span className="text-xs" style={{ color: 'var(--tb-txt-muted)' }}>
          exact tokens
        </span>
      </div>

      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={weeks} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="tbAccentGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={C.accent} stopOpacity={0.15} />
                <stop offset="95%" stopColor={C.accent} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="tbYellowGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={C.yellow} stopOpacity={0.1} />
                <stop offset="95%" stopColor={C.yellow} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="weekStart"
              tickFormatter={formatDateShort}
              tick={{ fill: C.axis, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={formatTokens}
              tick={{ fill: C.axis, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <Tooltip
              contentStyle={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                color: C.txt,
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
            <Area
              type="monotone"
              dataKey="total_exact"
              stroke={C.accent}
              strokeWidth={2}
              fill="url(#tbAccentGrad)"
              dot={false}
              activeDot={{ r: 3, fill: C.accent }}
            />
            {hasEst && (
              <Area
                type="monotone"
                dataKey="total_est"
                stroke={C.yellow}
                strokeWidth={1}
                strokeDasharray="4 2"
                fill="url(#tbYellowGrad)"
                dot={false}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
