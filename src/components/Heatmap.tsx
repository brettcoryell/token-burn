import { useMemo, useState } from 'react'
import { DayRecord } from '../types'
import { logColorBin } from '../utils/tokens'
import { parseDate, getDatesInRange, formatDateDisplay } from '../utils/dates'

const CELL_SIZE = 13
const CELL_GAP = 2
const STEP = CELL_SIZE + CELL_GAP
// Monday-start: Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6
const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

const BIN_CLASSES: Record<number, string> = {
  0: 'fill-slate-900',
  1: 'fill-cyan-950',
  2: 'fill-cyan-900',
  3: 'fill-cyan-700',
  4: 'fill-cyan-500',
  5: 'fill-cyan-300',
}

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

  // Build the grid: Monday-start weeks (Mon=row 0, Sun=row 6)
  // Sunday and following Monday land in different columns (Sun closes week, Mon opens next)
  const { cells, weeks } = useMemo(() => {
    if (records.length === 0) return { cells: [], weeks: 0 }

    const dates = records.map(r => r.date).sort()
    const firstDate = parseDate(dates[0]!)
    const lastDate = parseDate(dates[dates.length - 1]!)

    // Extend back to the most recent Monday on or before firstDate
    const startDay = new Date(firstDate)
    const startDow = startDay.getUTCDay() // 0=Sun,1=Mon,...,6=Sat
    const daysToMon = startDow === 0 ? 6 : startDow - 1
    startDay.setUTCDate(startDay.getUTCDate() - daysToMon)

    // Extend forward to the next Sunday on or after lastDate
    const endDay = new Date(lastDate)
    const endDow = endDay.getUTCDay()
    const daysToSun = endDow === 0 ? 0 : 7 - endDow
    endDay.setUTCDate(endDay.getUTCDate() + daysToSun)

    const allDates = getDatesInRange(startDay, endDay)
    const numWeeks = Math.ceil(allDates.length / 7)

    const cells = allDates.map((date, idx) => {
      const col = Math.floor(idx / 7)
      const row = idx % 7 // Mon=0, Tue=1, ..., Sat=5, Sun=6
      const record = recordMap.get(date)
      return { date, col, row, record }
    })

    return { cells, weeks: numWeeks }
  }, [records, recordMap])

  const LABEL_W = 20
  const MONTH_H = 16
  const svgW = LABEL_W + weeks * STEP
  const svgH = MONTH_H + 7 * STEP

  // Month labels
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
        <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wide">
          Daily burn
        </h2>
        <span className="text-xs text-slate-600">log color scale · less → more</span>
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
              className="fill-slate-600 font-mono"
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
              className="fill-slate-500 font-mono"
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
                  data-col={col}
                  data-row={row}
                  data-estimated={isEstOnly ? 'true' : undefined}
                  className={`${BIN_CLASSES[bin]} cursor-default transition-opacity hover:opacity-80`}
                  onMouseEnter={e => {
                    const rect = (e.target as SVGElement).getBoundingClientRect()
                    setTooltip({ x: rect.left + rect.width / 2, y: rect.top, record: record ?? null, date })
                  }}
                />
                {/* Dot indicator for estimated-only days */}
                {isEstOnly && (
                  <circle
                    cx={x + CELL_SIZE / 2}
                    cy={y + CELL_SIZE / 2}
                    r={2}
                    className="fill-amber-500 pointer-events-none"
                  />
                )}
              </g>
            )
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1 mt-2">
        <span className="text-xs text-slate-600 mr-1">Less</span>
        {[0, 1, 2, 3, 4, 5].map(bin => (
          <svg key={bin} width={13} height={13}>
            <rect width={13} height={13} rx={2} className={BIN_CLASSES[bin]} />
          </svg>
        ))}
        <span className="text-xs text-slate-600 ml-1">More</span>
        <span className="text-xs text-slate-700 ml-4">·</span>
        <svg width={13} height={13} className="ml-2">
          <rect width={13} height={13} rx={2} className="fill-slate-900" />
          <circle cx={6.5} cy={6.5} r={2} className="fill-amber-500" />
        </svg>
        <span className="text-xs text-slate-600 ml-1">Chat-only day</span>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          role="tooltip"
          className="fixed z-50 pointer-events-none bg-slate-800 border border-slate-700 rounded-lg p-3 text-xs shadow-xl max-w-xs"
          style={{ left: tooltip.x, top: tooltip.y - 8, transform: 'translate(-50%, -100%)' }}
        >
          <div className="font-medium text-slate-200 mb-1">
            {formatDateDisplay(tooltip.date)}
            <span className="text-slate-600 font-mono text-[9px] ml-1">({tooltip.date})</span>
          </div>
          {tooltip.record ? (
            <>
              {tooltip.record.total_exact > 0 && (
                <div className="text-cyan-400">
                  {tooltip.record.total_exact.toLocaleString()} <span className="text-slate-500">measured</span>
                </div>
              )}
              {tooltip.record.total_est > 0 && (
                <div className="text-amber-400">
                  ~{tooltip.record.total_est.toLocaleString()} <span className="text-slate-500">estimated</span>
                </div>
              )}
              {tooltip.record.driver && (
                <div className="text-slate-400 mt-1">{tooltip.record.driver}</div>
              )}
            </>
          ) : (
            <div className="text-slate-500">No activity</div>
          )}
        </div>
      )}
    </section>
  )
}
