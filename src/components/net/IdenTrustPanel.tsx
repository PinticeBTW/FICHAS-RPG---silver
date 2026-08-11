import {
  History,
  Minus,
  PanelRight,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { useState } from 'react'

import {
  trustImpactAreas,
  type TrustFactor,
  type TrustHistoryPoint,
  type TrustBand,
} from './idenData'

const RANGE_OPTIONS: { id: '30d' | '6m' | '1y'; label: string; take: number }[] = [
  { id: '30d', label: '30 Days', take: 2 },
  { id: '6m', label: '6 Months', take: 6 },
  { id: '1y', label: '1 Year', take: 12 },
]

const DIRECTION_ICON = { up: TrendingUp, down: TrendingDown, flat: Minus }

function MiniChart({ points }: { points: TrustHistoryPoint[] }) {
  const width = 280
  const height = 64

  const coords = points.map((point, index) => {
    const x = points.length > 1 ? (index / (points.length - 1)) * width : width
    const y = height - (point.score / 100) * height
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="iden-trust-chart"
      role="img"
      aria-label="Trust Index history chart"
    >
      <polyline points={coords.join(' ')} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

interface IdenTrustPanelProps {
  score: number
  band: TrustBand
  history: TrustHistoryPoint[]
  factors: TrustFactor[]
  reviewSubmitted: boolean
  onOpenReview: () => void
  onOpenRelatedEvents: () => void
}

export function IdenTrustPanel({
  score,
  band,
  history,
  factors,
  reviewSubmitted,
  onOpenReview,
  onOpenRelatedEvents,
}: IdenTrustPanelProps) {
  const [range, setRange] = useState<'30d' | '6m' | '1y'>('6m')
  const [selectedFactorId, setSelectedFactorId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(true)

  const rangeConfig = RANGE_OPTIONS.find((r) => r.id === range) ?? RANGE_OPTIONS[1]
  const visibleHistory = history.slice(-rangeConfig.take)
  const change = visibleHistory.length > 1
    ? visibleHistory[visibleHistory.length - 1].score - visibleHistory[0].score
    : 0

  const selectedFactor = factors.find((f) => f.id === selectedFactorId) ?? null

  return (
    <div className="iden-workspace">
      <div className="iden-main">
        <section className="iden-trust-hero">
          <div className="iden-trust-hero__score">
            <strong>{score}</strong>
            <span>/ 100</span>
          </div>

          <div className="iden-trust-hero__meta">
            <span className="iden-trust-band" data-band={band}>
              {band} band
            </span>
            <span className="iden-trust-hero__change" data-direction={change >= 0 ? 'up' : 'down'}>
              {change >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
              {change >= 0 ? '+' : ''}
              {change} over {rangeConfig.label.toLowerCase()}
            </span>
          </div>

          <div className="iden-trust-hero__range">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                data-active={range === option.id ? 'true' : 'false'}
                onClick={() => setRange(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <MiniChart points={visibleHistory} />
        </section>

        <section className="iden-section">
          <h3>Factor breakdown</h3>

          <div className="iden-list iden-list--factors">
            {factors.map((factor) => {
              const Icon = DIRECTION_ICON[factor.direction]

              return (
                <button
                  key={factor.id}
                  type="button"
                  className="iden-row"
                  data-selected={selectedFactorId === factor.id ? 'true' : 'false'}
                  onClick={() => {
                    setSelectedFactorId(factor.id)
                    setDetailOpen(true)
                  }}
                >
                  <Icon size={14} className="iden-row__risk-icon" />

                  <span className="iden-row__body">
                    <strong>{factor.label}</strong>
                    <small>Weight {factor.weight}%</small>
                  </span>

                  <span className="iden-row__meta">
                    <strong>{factor.value}</strong>
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="iden-section">
          <h3>What affects this score?</h3>
          <p className="iden-lead">
            Fictional participating-institution use cases where Trust Index data may factor into
            screening decisions:
          </p>
          <div className="iden-tag-row">
            {trustImpactAreas.map((area) => (
              <span key={area}>{area}</span>
            ))}
          </div>
        </section>

        <section className="iden-legal">
          <p>
            NetWatch states that Trust Index values do not independently determine access
            decisions. Participating institutions may use IDEN data within their own screening
            systems.
          </p>
        </section>

        <div className="iden-trust-actions">
          <button type="button" onClick={onOpenRelatedEvents}>
            Open related events
          </button>

          <button
            type="button"
            className="iden-trust-actions__review"
            data-disabled={reviewSubmitted ? 'true' : 'false'}
            onClick={onOpenReview}
          >
            <History size={13} />
            {reviewSubmitted ? 'Review requested' : 'Request Score Review'}
          </button>
        </div>
      </div>

      <div className="iden-inspect" data-open={detailOpen ? 'true' : 'false'}>
        {detailOpen ? (
          selectedFactor ? (
            <>
              <header className="iden-inspect__head">
                <strong>Trust factor</strong>
                <button
                  type="button"
                  onClick={() => setDetailOpen(false)}
                  aria-label="Collapse inspection panel"
                  title="Collapse"
                >
                  <PanelRight size={14} />
                </button>
              </header>

              <div className="iden-inspect__body">
                <h3>{selectedFactor.label}</h3>
                <p className="iden-inspect__description">{selectedFactor.explanation}</p>

                <div className="iden-kv">
                  <span>Value</span>
                  <strong>{selectedFactor.value} / 100</strong>
                </div>
                <div className="iden-kv">
                  <span>Weight</span>
                  <strong>{selectedFactor.weight}%</strong>
                </div>
                <div className="iden-kv">
                  <span>Direction</span>
                  <strong>{selectedFactor.direction}</strong>
                </div>
                <div className="iden-kv">
                  <span>Last updated</span>
                  <strong>{selectedFactor.lastUpdated}</strong>
                </div>

                {selectedFactor.relatedEventIds?.length ? (
                  <div className="iden-kv-block">
                    <span>Related events</span>
                    <button type="button" onClick={onOpenRelatedEvents}>
                      View in Access Log ({selectedFactor.relatedEventIds.length})
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="iden-empty-state">Select a factor to inspect it.</div>
          )
        ) : (
          <button
            type="button"
            className="iden-inspect__reopen"
            onClick={() => setDetailOpen(true)}
            aria-label="Open inspection panel"
            title="Open inspection panel"
          >
            <PanelRight size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
