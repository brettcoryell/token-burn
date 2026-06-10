import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { DayRecord } from '../types'
import { formatTokens } from '../utils/tokens'

interface Props {
  records: DayRecord[]
}

const MIN_TOKENS_FOR_DRIVER = 10_000

export function Drivers({ records }: Props) {
  const top = useMemo(() => {
    const last7 = records.slice(-7)
    const avg7 = last7.reduce((s, r) => s + r.total_exact, 0) / Math.max(last7.length, 1)

    return records
      .filter(r => r.driver && r.total_exact >= MIN_TOKENS_FOR_DRIVER && r.total_exact > avg7)
      .sort((a, b) => b.total_exact - a.total_exact)
      .slice(0, 10)
      .map(r => ({ date: r.date, driver: r.driver, tokens: r.total_exact }))
  }, [records])

  if (top.length === 0) {
    return (
      <section className="mb-10">
        <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wide mb-3">
          Top drivers
        </h2>
        <p className="text-slate-600 text-sm">Annotate sessions to see drivers</p>
      </section>
    )
  }

  return (
    <section className="mb-10">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wide">
          Top drivers
        </h2>
        <span className="text-xs text-slate-600">above 7-day avg · exact only</span>
      </div>

      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={top}
            margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
          >
            <XAxis
              type="number"
              tickFormatter={formatTokens}
              tick={{ fill: '#64748b', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="driver"
              width={110}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
              labelStyle={{ color: '#94a3b8', fontSize: 11 }}
              formatter={(val: number) => [formatTokens(val), 'Exact tokens']}
              cursor={{ fill: '#1e293b' }}
            />
            <Bar dataKey="tokens" radius={[0, 3, 3, 0]} maxBarSize={20}>
              {top.map((_, i) => (
                <Cell
                  key={i}
                  fill={i === 0 ? '#22d3ee' : '#164e63'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
