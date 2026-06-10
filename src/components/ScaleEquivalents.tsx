import { useMemo } from 'react'
import { DayRecord } from '../types'
import { computeScaleEquivalents, formatTokens, formatNumber } from '../utils/tokens'
import { FidelityBadge } from './FidelityBadge'

interface Props {
  records: DayRecord[]
}

export function ScaleEquivalents({ records }: Props) {
  const totalExact = useMemo(
    () => records.reduce((s, r) => s + r.total_exact, 0),
    [records]
  )

  if (totalExact === 0) return null

  const { queryEquivalents, electricityKwh, netflixMovies, codeLinesOfCode, engineerYears } =
    computeScaleEquivalents(totalExact)

  const cards = [
    {
      label: 'Query equivalents',
      value: formatNumber(queryEquivalents, 0),
      formula: `${formatTokens(totalExact)} tokens ÷ 1,000`,
      unit: 'GPT-3.5-class queries',
    },
    {
      label: 'Electricity',
      value: `${formatNumber(electricityKwh)} kWh`,
      formula: 'queries × 0.34 Wh/query',
      unit: 'equivalent energy use',
    },
    {
      label: 'Netflix hours',
      value: formatNumber(netflixMovies, 0),
      formula: 'kWh ÷ 0.45 kWh/hr',
      unit: 'hours of HD streaming',
    },
    {
      label: 'Lines of code',
      value: formatNumber(codeLinesOfCode, 0),
      formula: `${formatTokens(totalExact)} tokens ÷ 15 tokens/LOC`,
      unit: 'approximate LOC generated',
    },
    {
      label: 'Engineer-years',
      value: formatNumber(engineerYears, 2),
      formula: 'LOC ÷ 10,000 LOC/year',
      unit: 'at 10K LOC/yr output',
    },
  ]

  return (
    <section className="mb-10">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wide">
          Scale equivalents
        </h2>
        <FidelityBadge type="measured" />
      </div>
      <p className="text-xs text-slate-600 mb-4">
        Based on {formatTokens(totalExact)} exact tokens — These are scale translations, not measured utility
      </p>

      <div className="grid grid-cols-5 gap-3">
        {cards.map(card => (
          <div
            key={card.label}
            className="bg-slate-900 rounded-lg p-3 border border-slate-800 flex flex-col gap-1"
          >
            <div className="text-xs text-slate-500 uppercase tracking-wide">{card.label}</div>
            <div className="text-xl font-bold font-mono text-slate-100">{card.value}</div>
            <div className="text-[10px] text-slate-600 font-mono mt-auto">{card.formula}</div>
            <div className="text-[10px] text-slate-700">{card.unit}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
