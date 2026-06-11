// Token math and scale equivalents

export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return n.toLocaleString()
}

export function formatTokensExact(n: number): string {
  return n.toLocaleString()
}

// Absolute-threshold color bins — 7 non-zero bins calibrated to Brett's
// daily token range. Fixed breakpoints prevent all heavy days from mapping
// to bin 7 when values cluster near the max (the failure mode of log-relative).
//
// Thresholds (tokens/day): 0 | 100K | 1M | 10M | 50M | 100M | 200M | ∞
export function logColorBin(tokens: number, _maxTokens: number): number {
  if (tokens <= 0)            return 0
  if (tokens < 100_000)       return 1
  if (tokens < 1_000_000)     return 2
  if (tokens < 10_000_000)    return 3
  if (tokens < 50_000_000)    return 4
  if (tokens < 100_000_000)   return 5
  if (tokens < 200_000_000)   return 6
  return 7
}

// Scale equivalents — all use total_exact only
export interface ScaleEquivalents {
  queryEquivalents: number
  electricityKwh: number
  netflixMovies: number
  codeLinesOfCode: number
  engineerYears: number
}

export function computeScaleEquivalents(totalExact: number): ScaleEquivalents {
  const queryEquivalents = totalExact / 1000
  const electricityKwh = queryEquivalents * 0.00034
  const netflixMovies = electricityKwh / 0.45
  const codeLinesOfCode = totalExact / 15
  const engineerYears = codeLinesOfCode / 10_000
  return { queryEquivalents, electricityKwh, netflixMovies, codeLinesOfCode, engineerYears }
}

export function formatNumber(n: number, decimals = 1): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(decimals)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(decimals)}K`
  return n.toFixed(decimals)
}
