import { useState } from 'react'
import { TimeRange } from './types'
import { useTokenData } from './hooks/useTokenData'
import { latestDate } from './utils/dates'
import { Header } from './components/Header'
import { Heatmap } from './components/Heatmap'
import { TrendLine } from './components/TrendLine'
import { Drivers } from './components/Drivers'
import { ScaleEquivalents } from './components/ScaleEquivalents'
import { DailyTable } from './components/DailyTable'

export function App() {
  const [range, setRange] = useState<TimeRange>('90d')
  const { all, filtered, sessions, loading, error } = useTokenData(range)

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--tb-bg)' }}>
        <span className="text-sm" style={{ color: 'var(--tb-txt-faint)' }}>Loading…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--tb-bg)' }}>
        <div className="text-center">
          <p className="text-sm mb-2" style={{ color: 'var(--tb-red)' }}>Failed to load data</p>
          <p className="text-xs" style={{ color: 'var(--tb-txt-faint)' }}>{error}</p>
          <p className="text-xs mt-3" style={{ color: 'var(--tb-chart-axis)' }}>
            Run <code style={{ color: 'var(--tb-txt-muted)' }}>make collect</code> to generate data
          </p>
        </div>
      </div>
    )
  }

  if (all.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--tb-bg)' }}>
        <div className="text-center">
          <p className="text-sm mb-2" style={{ color: 'var(--tb-txt-muted)' }}>No data yet</p>
          <p className="text-xs mt-2" style={{ color: 'var(--tb-txt-faint)' }}>
            Run <code style={{ color: 'var(--tb-txt-muted)' }}>make collect</code> to generate data
          </p>
        </div>
      </div>
    )
  }

  const lastUpdated = latestDate(all)

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--tb-bg)', color: 'var(--tb-txt)' }}>
      <div className="max-w-6xl mx-auto px-6 py-8">
        <Header
          records={filtered}
          range={range}
          onRangeChange={setRange}
          lastUpdated={lastUpdated}
        />
        <Heatmap records={filtered} />
        <TrendLine records={filtered} />
        <Drivers sessions={sessions} />
        <ScaleEquivalents records={filtered} />
        <DailyTable records={filtered} />
      </div>
    </div>
  )
}
