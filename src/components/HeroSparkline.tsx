interface Props {
  data: number[]
  dashed?: boolean
}

export function HeroSparkline({ data, dashed = false }: Props) {
  if (data.length < 2) return null

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = Math.max(max - min, 1)

  const W = 200
  const H = 36
  const pad = 2

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * W
      const y = H - pad - ((v - min) / range) * (H - 2 * pad)
      return `${x},${y}`
    })
    .join(' ')

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ width: '100%', height: H, display: 'block' }}
    >
      <polyline
        points={points}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dashed ? '3 2' : undefined}
        style={{ stroke: 'var(--tb-sparkline)', strokeWidth: 1.5 }}
      />
    </svg>
  )
}
