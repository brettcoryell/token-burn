import { lazy, Suspense, useState, useEffect } from 'react'
import { TimeRange } from './types'
import { useTokenData } from './hooks/useTokenData'
import { latestDate } from './utils/dates'
import { Header } from './components/Header'
import { Heatmap } from './components/Heatmap'
import { ScaleEquivalents } from './components/ScaleEquivalents'
import { DailyTable } from './components/DailyTable'

const TrendLine = lazy(() => import('./components/TrendLine').then(({ TrendLine }) => ({ default: TrendLine })))
const Drivers = lazy(() => import('./components/Drivers').then(({ Drivers }) => ({ default: Drivers })))

function ChartFallback({ height }: { height: string }) {
  return <div className="mb-10" style={{ height }} aria-busy="true" />
}

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
      <a
        href="https://brettcoryell.com"
        style={{
          position: 'fixed', bottom: '1.25rem', left: '1.5rem', zIndex: 50,
          fontSize: '0.75rem', color: 'var(--tb-txt-faint)',
          textDecoration: 'none', fontFamily: 'inherit',
          transition: 'color 0.15s ease',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--tb-txt-muted)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--tb-txt-faint)')}
      >
        ← brettcoryell.com
      </a>
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
        <Suspense fallback={<ChartFallback height="12.5rem" />}>
          <TrendLine records={filtered} theme={theme} />
        </Suspense>
        <Suspense fallback={<ChartFallback height="16rem" />}>
          <Drivers records={filtered} sessions={sessions} theme={theme} />
        </Suspense>
        <ScaleEquivalents records={filtered} />
        <DailyTable records={filtered} />
      </div>
    </div>
  )
}
