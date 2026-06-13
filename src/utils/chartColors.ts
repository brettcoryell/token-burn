// Chart colors for recharts — passed as hex since recharts sets stroke/fill as
// SVG presentation attributes where CSS var() resolution is unreliable.
// Values mirror the --tb-* tokens defined in index.css.
//
// NOTE: `accent` is the weekly area chart line (cyan, not changed per design spec §8).
// `peakBar` is the Drivers peak bar (coral #D85A30, per spec §5).

export interface ChartColors {
  accent:         string  // weekly total line — cyan (unchanged per spec §8)
  peakBar:        string  // drivers peak bar — coral
  secondaryBar:   string  // drivers non-peak bars
  barTrack:       string  // drivers chart container background
  yellow:         string
  axis:           string
  border:         string
  card:           string
  cardHover:      string
  txtMuted:       string
  txt:            string
}

export function getChartColors(theme: 'light' | 'dark'): ChartColors {
  if (theme === 'light') {
    return {
      accent:         '#0891b2',   // weekly line stays cyan per spec
      peakBar:        '#D85A30',   // coral
      secondaryBar:   '#e8edf3',   // site-fog
      barTrack:       'transparent',
      yellow:         '#d97706',
      axis:           '#64748b',
      border:         '#e8edf3',   // site-fog
      card:           '#ffffff',
      cardHover:      '#f8fafc',
      txtMuted:       '#4a5568',   // site-dusk
      txt:            '#1a2332',   // site-ink
    }
  }
  return {
    accent:         '#22d3ee',   // weekly line stays cyan per spec
    peakBar:        '#D85A30',   // coral
    secondaryBar:   '#4a5568',
    barTrack:       '#141f35',
    yellow:         '#f59e0b',
    axis:           '#64748b',
    border:         '#1e293b',
    card:           '#0f172a',
    cardHover:      '#141f35',
    txtMuted:       '#94a3b8',
    txt:            '#e2e8f0',
  }
}
