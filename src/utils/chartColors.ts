// Chart colors for recharts — passed as hex since recharts sets stroke/fill as
// SVG presentation attributes where CSS var() resolution is unreliable.
// Values mirror the --tb-* tokens defined in index.css.

export interface ChartColors {
  accent:   string
  yellow:   string
  axis:     string
  border:   string
  card:     string
  cardHover:string
  txtMuted: string
  txt:      string
}

export function getChartColors(theme: 'light' | 'dark'): ChartColors {
  if (theme === 'light') {
    return {
      accent:    '#0891b2',  // --tb-accent light
      yellow:    '#d97706',  // --tb-yellow light
      axis:      '#94a3b8',  // --tb-chart-axis light
      border:    '#e2e8f0',  // --tb-border light
      card:      '#ffffff',  // --tb-card light
      cardHover: '#f8fafc',  // --tb-card-hover light
      txtMuted:  '#475569',  // --tb-txt-muted light
      txt:       '#0f172a',  // --tb-txt light
    }
  }
  return {
    accent:    '#22d3ee',  // --tb-accent dark
    yellow:    '#f59e0b',  // --tb-yellow dark
    axis:      '#334155',  // --tb-chart-axis dark
    border:    '#1e293b',  // --tb-border dark
    card:      '#0f172a',  // --tb-card dark
    cardHover: '#141f35',  // --tb-card-hover dark
    txtMuted:  '#94a3b8',  // --tb-txt-muted dark
    txt:       '#e2e8f0',  // --tb-txt dark
  }
}
