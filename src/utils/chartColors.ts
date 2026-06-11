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
  barTrackInner:  string  // per-bar background track (extends full axis width)
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
      secondaryBar:   '#D3D1C7',
      barTrack:       'transparent',
      barTrackInner:  '#ede9df',   // very light warm gray, lighter than secondary bar
      yellow:         '#d97706',
      axis:           '#94a3b8',
      border:         '#e2e8f0',
      card:           '#ffffff',
      cardHover:      '#f8fafc',
      txtMuted:       '#475569',
      txt:            '#0f172a',
    }
  }
  return {
    accent:         '#22d3ee',   // weekly line stays cyan per spec
    peakBar:        '#D85A30',   // coral
    secondaryBar:   '#4a5568',
    barTrack:       '#2a3448',
    barTrackInner:  '#1a2535',   // darker than chart container bg — bars pop against it
    yellow:         '#f59e0b',
    axis:           '#4a5568',
    border:         '#1e293b',
    card:           '#0f172a',
    cardHover:      '#141f35',
    txtMuted:       '#94a3b8',
    txt:            '#e2e8f0',
  }
}
