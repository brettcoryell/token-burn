interface Props {
  type: 'measured' | 'estimated'
  className?: string
}

export function FidelityBadge({ type, className = '' }: Props) {
  const isMeasured = type === 'measured'
  return (
    <span
      data-fidelity={type}
      className={`inline-block text-[10px] font-medium px-[6px] py-[1px] rounded uppercase tracking-wide ${className}`}
      style={
        isMeasured
          ? {
              backgroundColor: 'var(--tb-chip-measured-bg)',
              color: 'var(--tb-chip-measured-txt)',
              border: '1px solid var(--tb-chip-measured-border)',
            }
          : {
              backgroundColor: 'var(--tb-chip-est-bg)',
              color: 'var(--tb-chip-est-txt)',
              border: '1px solid var(--tb-chip-est-border)',
            }
      }
    >
      {isMeasured ? 'measured' : 'est'}
    </span>
  )
}
