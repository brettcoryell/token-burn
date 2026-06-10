import { useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { DayRecord } from '../types'
import { aggregateWeekly, formatDateShort } from '../utils/dates'
import { formatTokens } from '../utils/tokens'

interface Props {
  records: DayRecord[]
}

export function TrendLine({ records }: Props) {
  const weeks = useMemo(() => aggregateWeekly(records), [records])

  const peakWeek = useMemo(() => {
    if (weeks.length === 0) return null
    return weeks.reduce((max, w) => (w.total_exact > max.total_exact ? w : max), weeks[0]!)
  }, [weeks])

  if (weeks.length === 0) return null

  const hasEst = weeks.some(w => w.total_est > 0)

  return (
    <section className="mb-10">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wide">
          Weekly total
        </h2>
        <span className="text-xs text-slate-600">log y-scale · exact only</span>
      </div>

      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={weeks} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="weekStart"
              tickFormatter={formatDateShort}
              tick={{ fill: '#64748b', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              scale="log"
              domain={['auto', 'auto']}
              tickFormatter={formatTokens}
              tick={{ fill: '#64748b', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={48}
            />
            <Tooltip
              contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
              labelStyle={{ color: '#94a3b8', fontSize: 11 }}
              formatter={(val: number, name: string) => [
                formatTokens(val),
                name === 'total_exact' ? 'Exact (measured)' : 'Chat (estimated)',
              ]}
              labelFormatter={formatDateShort}
            />
            {peakWeek && (
              <ReferenceLine
                x={peakWeek.weekStart}
                stroke="#334155"
                label={{
                  value: `Peak ${formatTokens(peakWeek.total_exact)}`,
                  position: 'insideTopRight',
                  fill: '#64748b',
                  fontSize: 10,
                }}
              />
            )}
            <Line
              type="monotone"
              dataKey="total_exact"
              stroke="#22d3ee"
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3, fill: '#22d3ee' }}
            />
            {hasEst && (
              <Line
                type="monotone"
                dataKey="total_est"
                stroke="#f59e0b"
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
