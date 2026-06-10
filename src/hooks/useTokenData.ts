import { useState, useEffect } from 'react'
import { DayRecord, TimeRange } from '../types'
import { filterByRange } from '../utils/dates'

interface TokenDataState {
  all: DayRecord[]
  filtered: DayRecord[]
  loading: boolean
  error: string | null
}

export function useTokenData(range: TimeRange): TokenDataState {
  const [all, setAll] = useState<DayRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch('/data/daily-burn.json')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<DayRecord[]>
      })
      .then(data => {
        if (!cancelled) {
          setAll(Array.isArray(data) ? data : [])
          setLoading(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError((err as Error).message)
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [])

  const filtered = filterByRange(all, range)

  return { all, filtered, loading, error }
}
