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

// Log color scale — 5 non-zero bins for the heatmap
// Returns a CSS class suffix (0–5)
export function logColorBin(tokens: number): number {
  if (tokens <= 0) return 0
  if (tokens < 1_000) return 1
  if (tokens < 10_000) return 2
  if (tokens < 100_000) return 3
  if (tokens < 1_000_000) return 4
  return 5
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
