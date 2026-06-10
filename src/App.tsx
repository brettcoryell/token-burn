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
  const { all, filtered, loading, error } = useTokenData(range)

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <span className="text-slate-500 text-sm font-mono">Loading…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-sm font-mono mb-2">Failed to load data</p>
          <p className="text-slate-600 text-xs">{error}</p>
          <p className="text-slate-700 text-xs mt-3">
            Run <code className="text-slate-500">make collect</code> to generate data
          </p>
        </div>
      </div>
    )
  }

  if (all.length === 0) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-400 text-sm font-mono mb-2">No data yet</p>
          <p className="text-slate-600 text-xs mt-2">
            Run <code className="text-slate-500">make collect</code> to generate data
          </p>
        </div>
      </div>
    )
  }

  const lastUpdated = latestDate(all)

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <Header
          records={filtered}
          range={range}
          onRangeChange={setRange}
          lastUpdated={lastUpdated}
        />
        <Heatmap records={filtered} />
        <TrendLine records={filtered} />
        <Drivers records={filtered} />
        <ScaleEquivalents records={filtered} />
        <DailyTable records={filtered} />
      </div>
    </div>
  )
}
