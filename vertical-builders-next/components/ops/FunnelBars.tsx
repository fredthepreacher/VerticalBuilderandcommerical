import type { FunnelStage } from '@/lib/ops/prospecting/analytics-metrics'

/**
 * Funnel visualization: a horizontal bar per stage, width proportional to the top
 * of the funnel, with the numeric value ALWAYS shown alongside (spec §10 — never a
 * bar without its number). Pure presentational server component; no chart library.
 */
export default function FunnelBars({ stages }: { stages: FunnelStage[] }) {
  return (
    <div className="ops-funnel" role="list">
      {stages.map(s => (
        <div className="ops-funnel-row" role="listitem" key={s.key}>
          <div className="ops-funnel-label">{s.label}</div>
          <div className="ops-funnel-track">
            <div
              className="ops-funnel-bar"
              style={{ width: `${Math.max(2, s.fraction * 100)}%` }}
              aria-hidden="true"
            />
          </div>
          <div className="ops-funnel-value">{s.value.toLocaleString()}</div>
        </div>
      ))}
    </div>
  )
}
