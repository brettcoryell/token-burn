import { useState, useEffect } from 'react'
import { DayRecord, SessionRecord, TimeRange } from '../types'
import { filterByRange } from '../utils/dates'

interface TokenDataState {
  all: DayRecord[]
  filtered: DayRecord[]
  sessions: SessionRecord[]
  loading: boolean
  error: string | null
}

export function useTokenData(range: TimeRange): TokenDataState {
  const [all, setAll] = useState<DayRecord[]>([])
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([
      fetch('/api/daily').then(r => {
        if (!r.ok) throw new Error(`/api/daily: HTTP ${r.status}`)
        return r.json() as Promise<DayRecord[]>
      }),
      fetch('/api/sessions?limit=200').then(r => {
        if (!r.ok) throw new Error(`/api/sessions: HTTP ${r.status}`)
        return r.json() as Promise<SessionRecord[]>
      }),
    ])
      .then(([daily, sess]) => {
        if (!cancelled) {
          setAll(Array.isArray(daily) ? daily : [])
          setSessions(Array.isArray(sess) ? sess : [])
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

  return { all, filtered, sessions, loading, error }
}
