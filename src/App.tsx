import { useState, useEffect } from 'react'
import { TimeRange } from './types'
import { useTokenData } from './hooks/useTokenData'
import { latestDate } from './utils/dates'
import { Header } from './components/Header'
import { Heatmap } from './components/Heatmap'
import { TrendLine } from './components/TrendLine'
import { Drivers } from './components/Drivers'
import { ScaleEquivalents } from './components/ScaleEquivalents'
import { DailyTable } from './components/DailyTable'

function getInitialTheme(): 'light' | 'dark' {
  try { return (localStorage.getItem('tb-theme') as 'light' | 'dark') ?? 'light' } catch { return 'light' }
}

export function App() {
  const [range, setRange] = useState<TimeRange>('90d')
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme)
  const { all, filtered, sessions, loading, error } = useTokenData(range)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : '')
    try { localStorage.setItem('tb-theme', theme) } catch { /* ignore */ }
  }, [theme])

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
        </div>
      </div>
    )
  }

  if (all.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--tb-bg)' }}>
        <p className="text-sm" style={{ color: 'var(--tb-txt-muted)' }}>No data yet — run <code>make collect</code></p>
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
          theme={theme}
          onThemeChange={setTheme}
        />
        <Heatmap records={filtered} />
        <TrendLine records={filtered} theme={theme} />
        <Drivers sessions={sessions} theme={theme} />
        <ScaleEquivalents records={filtered} />
        <DailyTable records={filtered} />
      </div>
    </div>
  )
}
