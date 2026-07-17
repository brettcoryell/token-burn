import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { DayRecord, DRIVER_LABELS, SessionRecord } from '../types'
import { formatTokens } from '../utils/tokens'
import { formatDateShort } from '../utils/dates'
import { getChartColors } from '../utils/chartColors'

interface Props {
  records: DayRecord[]
  sessions: SessionRecord[]
  theme: 'light' | 'dark'
}

const TOP_DAY_COUNT = 10
const UNANNOTATED_DRIVER = 'unannotated'

export function Drivers({ records, sessions, theme }: Props) {
  const C = getChartColors(theme)

  const top = useMemo(() => {
    const dayDriverTokens = new Map<string, Map<string, number>>()

    for (const s of sessions) {
      if (s.driver) {
        if (!dayDriverTokens.has(s.session_date)) dayDriverTokens.set(s.session_date, new Map())
        const dm = dayDriverTokens.get(s.session_date)!
        dm.set(s.driver, (dm.get(s.driver) ?? 0) + s.total_tokens)
      }
    }

    return records
      .map(record => ({
        date: record.date,
        exactTokens: record.total_exact,
        estTokens: record.total_est,
        tokens: record.total_exact + record.total_est,
        fallbackDriver: record.driver || null,
      }))
      .filter(day => day.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, TOP_DAY_COUNT)
      .map(day => {
        const dm = dayDriverTokens.get(day.date)
        const pluralityDriver = dm && dm.size > 0
          ? [...dm.entries()].reduce((a, b) => a[1] >= b[1] ? a : b)[0]
          : day.fallbackDriver ?? UNANNOTATED_DRIVER
        const driverLabel = pluralityDriver === UNANNOTATED_DRIVER
          ? 'Unannotated'
          : DRIVER_LABELS[pluralityDriver] ?? pluralityDriver

        return {
          label: `${driverLabel} · ${formatDateShort(day.date)}`,
          driver: pluralityDriver,
          exactTokens: day.exactTokens,
          estTokens: day.estTokens,
          tokens: day.tokens,
        }
      })
  }, [records, sessions])

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
          top {TOP_DAY_COUNT} days · measured + est
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
              formatter={(val: number, name: string) => {
                const label = name === 'exactTokens'
                  ? 'Measured'
                  : name === 'estTokens'
                    ? 'Estimated'
                    : 'Day total'
                return [formatTokens(val), label]
              }}
              cursor={{ fill: C.cardHover }}
            />
            <Bar
              dataKey="exactTokens"
              stackId="tokens"
              radius={[0, 3, 3, 0]}
              maxBarSize={20}
            >
              {top.map((_, i) => (
                <Cell key={i} fill={i === 0 ? C.peakBar : C.secondaryBar} />
              ))}
            </Bar>
            <Bar
              dataKey="estTokens"
              stackId="tokens"
              fill={C.yellow}
              radius={[0, 3, 3, 0]}
              maxBarSize={20}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
