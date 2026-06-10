interface Props {
  type: 'measured' | 'estimated'
  className?: string
}

export function FidelityBadge({ type, className = '' }: Props) {
  const isMeasured = type === 'measured'
  return (
    <span
      data-fidelity={type}
      className={`inline-block text-[10px] font-mono font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
        isMeasured
          ? 'bg-cyan-950 text-cyan-400 border border-cyan-800'
          : 'bg-amber-950 text-amber-400 border border-amber-800'
      } ${className}`}
    >
      {isMeasured ? 'measured' : 'est'}
    </span>
  )
}
