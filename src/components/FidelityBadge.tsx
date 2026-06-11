interface Props {
  type: 'measured' | 'estimated'
  className?: string
}

export function FidelityBadge({ type, className = '' }: Props) {
  const isMeasured = type === 'measured'
  return (
    <span
      data-fidelity={type}
      className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${className}`}
      style={
        isMeasured
          ? {
              backgroundColor: 'var(--tb-accent-dim)',
              color: 'var(--tb-accent)',
              border: '1px solid var(--tb-accent-dim)',
            }
          : {
              color: 'var(--tb-yellow)',
              border: '1px solid var(--tb-yellow)',
            }
      }
    >
      {isMeasured ? 'measured' : 'est'}
    </span>
  )
}
