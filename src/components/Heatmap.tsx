import { useMemo, useState } from 'react'
import { DayRecord } from '../types'
import { logColorBin } from '../utils/tokens'
import { parseDate, getDatesInRange, formatDateDisplay } from '../utils/dates'

const CELL_SIZE = 13
const CELL_GAP = 2
const STEP = CELL_SIZE + CELL_GAP
const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

const BIN_FILLS = [
  'var(--tb-bin-0)',
  'var(--tb-bin-1)',
  'var(--tb-bin-2)',
  'var(--tb-bin-3)',
  'var(--tb-bin-4)',
  'var(--tb-bin-5)',
]

interface Tooltip {
  x: number; y: number; record: DayRecord | null; date: string
}

interface Props {
  records: DayRecord[]
}

export function Heatmap({ records }: Props) {
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)

  const recordMap = useMemo(() => {
    const m = new Map<string, DayRecord>()
    for (const r of records) m.set(r.date, r)
    return m
  }, [records])

  const { cells, weeks } = useMemo(() => {
    if (records.length === 0) return { cells: [], weeks: 0 }

    const dates = records.map(r => r.date).sort()
    const firstDate = parseDate(dates[0]!)
    const lastDate = parseDate(dates[dates.length - 1]!)

    const startDay = new Date(firstDate)
    const startDow = startDay.getUTCDay()
    const daysToMon = startDow === 0 ? 6 : startDow - 1
    startDay.setUTCDate(startDay.getUTCDate() - daysToMon)

    const endDay = new Date(lastDate)
    const endDow = endDay.getUTCDay()
    const daysToSun = endDow === 0 ? 0 : 7 - endDow
    endDay.setUTCDate(endDay.getUTCDate() + daysToSun)

    const allDates = getDatesInRange(startDay, endDay)
    const numWeeks = Math.ceil(allDates.length / 7)

    const cells = allDates.map((date, idx) => {
      const col = Math.floor(idx / 7)
      const row = idx % 7
      const record = recordMap.get(date)
      return { date, col, row, record }
    })

    return { cells, weeks: numWeeks }
  }, [records, recordMap])

  const LABEL_W = 20
  const MONTH_H = 16
  const svgW = LABEL_W + weeks * STEP
  const svgH = MONTH_H + 7 * STEP

  const monthLabels = useMemo(() => {
    const seen = new Set<string>()
    return cells.filter(c => {
      const month = c.date.slice(0, 7)
      if (!seen.has(month) && c.row === 0) { seen.add(month); return true }
      return false
    }).map(c => ({
      col: c.col,
      label: new Date(c.date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
    }))
  }, [cells])

  if (records.length === 0) return null

  return (
    <section className="mb-10">
      <div className="flex items-baseline justify-between mb-3">
        <h2
          className="text-sm font-medium uppercase tracking-wide"
          style={{ color: 'var(--tb-txt-muted)' }}
        >
          Daily burn
        </h2>
        <span className="text-xs" style={{ color: 'var(--tb-txt-muted)' }}>
          log color scale · less → more
        </span>
      </div>

      <div className="overflow-x-auto">
        <svg
          width={svgW}
          height={svgH}
          role="img"
          aria-label="Daily token burn heatmap"
          className="block"
          onMouseLeave={() => setTooltip(null)}
        >
          {/* Day-of-week labels */}
          {DAYS.map((d, i) => (
            <text
              key={i}
              x={LABEL_W - 4}
              y={MONTH_H + i * STEP + CELL_SIZE - 2}
              textAnchor="end"
              fontSize={9}
              style={{ fill: 'var(--tb-txt-muted)' }}
            >
              {i % 2 === 1 ? d : ''}
            </text>
          ))}

          {/* Month labels */}
          {monthLabels.map(({ col, label }) => (
            <text
              key={label + col}
              x={LABEL_W + col * STEP}
              y={MONTH_H - 4}
              fontSize={9}
              style={{ fill: 'var(--tb-txt-muted)' }}
            >
              {label}
            </text>
          ))}

          {/* Cells */}
          {cells.map(({ date, col, row, record }) => {
            const bin = record ? logColorBin(record.total_exact) : 0
            const isEstOnly = record && record.total_exact === 0 && record.total_est > 0
            const x = LABEL_W + col * STEP
            const y = MONTH_H + row * STEP

            return (
              <g key={date}>
                <rect
                  x={x}
                  y={y}
                  width={CELL_SIZE}
                  height={CELL_SIZE}
                  rx={2}
                  data-date={date}
                  style={{ fill: BIN_FILLS[bin], cursor: 'default' }}
                  onMouseEnter={e => {
                    const rect = (e.target as SVGElement).getBoundingClientRect()
                    setTooltip({ x: rect.left + rect.width / 2, y: rect.top, record: record ?? null, date })
                  }}
                />
                {isEstOnly && (
                  <circle
                    cx={x + CELL_SIZE / 2}
                    cy={y + CELL_SIZE / 2}
                    r={2}
                    style={{ fill: 'var(--tb-yellow)', pointerEvents: 'none' }}
                  />
                )}
              </g>
            )
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1 mt-2">
        <span className="text-xs mr-1" style={{ color: 'var(--tb-txt-muted)' }}>Less</span>
        {BIN_FILLS.map((fill, bin) => (
          <svg key={bin} width={13} height={13}>
            <rect width={13} height={13} rx={2} style={{ fill }} />
          </svg>
        ))}
        <span className="text-xs ml-1" style={{ color: 'var(--tb-txt-muted)' }}>More</span>
        <span className="text-xs ml-4" style={{ color: 'var(--tb-chart-axis)' }}>·</span>
        <svg width={13} height={13} className="ml-2">
          <rect width={13} height={13} rx={2} style={{ fill: 'var(--tb-bin-0)' }} />
          <circle cx={6.5} cy={6.5} r={2} style={{ fill: 'var(--tb-yellow)' }} />
        </svg>
        <span className="text-xs ml-1" style={{ color: 'var(--tb-txt-muted)' }}>Chat-only day</span>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          role="tooltip"
          className="fixed z-50 pointer-events-none rounded-lg p-3 text-xs shadow-xl max-w-xs"
          style={{
            left: tooltip.x,
            top: tooltip.y - 8,
            transform: 'translate(-50%, -100%)',
            backgroundColor: 'var(--tb-card)',
            border: '1px solid var(--tb-border)',
            color: 'var(--tb-txt)',
          }}
        >
          <div className="font-medium mb-1" style={{ color: 'var(--tb-txt)' }}>
            {formatDateDisplay(tooltip.date)}
            <span className="text-[9px] ml-1" style={{ color: 'var(--tb-txt-faint)' }}>
              ({tooltip.date})
            </span>
          </div>
          {tooltip.record ? (
            <>
              {tooltip.record.total_exact > 0 && (
                <div style={{ color: 'var(--tb-accent)' }}>
                  {tooltip.record.total_exact.toLocaleString()}{' '}
                  <span style={{ color: 'var(--tb-txt-muted)' }}>measured</span>
                </div>
              )}
              {tooltip.record.total_est > 0 && (
                <div style={{ color: 'var(--tb-yellow)' }}>
                  ~{tooltip.record.total_est.toLocaleString()}{' '}
                  <span style={{ color: 'var(--tb-txt-muted)' }}>estimated</span>
                </div>
              )}
              {tooltip.record.driver && (
                <div className="mt-1" style={{ color: 'var(--tb-txt-muted)' }}>
                  {tooltip.record.driver}
                </div>
              )}
            </>
          ) : (
            <div style={{ color: 'var(--tb-txt-faint)' }}>No activity</div>
          )}
        </div>
      )}
    </section>
  )
}
