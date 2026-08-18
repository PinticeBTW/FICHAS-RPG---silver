import {
  Bookmark,
  BookmarkCheck,
  Lock,
  RotateCcw,
  Waves,
} from 'lucide-react'

import type {
  NetEchoMapNode,
  NetEchoSignalDetail,
  NetEchoSignalKind,
} from '../../lib/netEchoTypes'

type EchoDetailPhase = 'idle' | 'loading' | 'ready' | 'unavailable' | 'failed'

interface EchoDetailPanelProps {
  readonly node: NetEchoMapNode | null
  readonly phase: EchoDetailPhase
  readonly detail: NetEchoSignalDetail | null
  readonly error: string | null
  readonly isSaving: boolean
  readonly onSave: () => void
  readonly onRetry: () => void
}

function label(value: string): string {
  return value.replaceAll('-', ' ')
}

function kindLabel(kind: NetEchoSignalKind): string {
  if (kind === 'dead') return 'Recovered / Dead Signal'
  if (kind === 'corrupted') return 'Corrupted Signal'
  if (kind === 'encrypted') return 'Encrypted Signal'
  return label(kind)
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function EchoDetailStatus({
  title,
  detail,
  retry,
}: {
  readonly title: string
  readonly detail: string
  readonly retry?: () => void
}) {
  return (
    <div className="net-echo-panel net-echo-panel--empty" role="status">
      <Waves size={22} aria-hidden="true" />
      <strong>{title}</strong>
      <p>{detail}</p>
      {retry ? (
        <button type="button" className="net-echo-panel__retry" onClick={retry}>
          <RotateCcw size={13} aria-hidden="true" />
          Retry signal
        </button>
      ) : null}
    </div>
  )
}

export function EchoDetailPanel({
  node,
  phase,
  detail,
  error,
  isSaving,
  onSave,
  onRetry,
}: EchoDetailPanelProps) {
  if (!node) {
    return (
      <EchoDetailStatus
        title="NO SIGNAL SELECTED"
        detail="Select a represented node to inspect its confirmed intelligence."
      />
    )
  }

  if (node.accessState === 'locked') {
    return (
      <div className="net-echo-panel" data-locked="true">
        <div className="net-echo-panel__author">
          <strong>ENCRYPTED SIGNAL</strong>
          <span>LOCKED NODE // SAFE PROJECTION</span>
        </div>
        <div className="net-echo-panel__locked">
          <Lock size={15} aria-hidden="true" />
          <p>{node.lockedTeaser}</p>
        </div>
        <p className="net-echo-panel__privacy-note">
          Signal intelligence remains withheld until its direct prerequisites are discovered.
        </p>
      </div>
    )
  }

  if (phase === 'loading') {
    return (
      <EchoDetailStatus
        title="SYNCING SIGNAL"
        detail="Opening the authoritative signal record and confirming discovery."
      />
    )
  }

  if (phase === 'unavailable') {
    return (
      <EchoDetailStatus
        title="SIGNAL UNAVAILABLE"
        detail="This node is no longer available to the active ECHO presence."
      />
    )
  }

  if (phase === 'failed') {
    return (
      <EchoDetailStatus
        title="SIGNAL INTERRUPTED"
        detail={error ?? 'The signal could not be synchronized.'}
        retry={onRetry}
      />
    )
  }

  if (phase !== 'ready' || !detail || detail.id !== node.id) {
    return (
      <EchoDetailStatus
        title="SIGNAL READY"
        detail="Open this node to retrieve its full intelligence record."
      />
    )
  }

  const isCorrupted = detail.kind === 'corrupted' || detail.kind === 'dead'
  const sourceName = detail.source?.displayName
    ?? (detail.source?.handle ? `@${detail.source.handle}` : detail.source?.label)

  return (
    <div
      className="net-echo-panel"
      data-dead={isCorrupted ? 'true' : 'false'}
    >
      <div className="net-echo-panel__author">
        <strong>{detail.title}</strong>
        <span>
          {sourceName ? `${sourceName} // ` : ''}{kindLabel(detail.kind)}
        </span>
      </div>

      <dl className="net-echo-panel__meta">
        <div>
          <dt>Reliability</dt>
          <dd>{label(detail.reliability)}</dd>
        </div>
        <div>
          <dt>Intensity</dt>
          <dd>{detail.intensity}</dd>
        </div>
        {detail.locationLabel || detail.districtLabel ? (
          <div>
            <dt>Location</dt>
            <dd>{detail.locationLabel ?? detail.districtLabel}</dd>
          </div>
        ) : null}
        <div>
          <dt>{detail.occurredAt ? 'Occurred' : 'Revealed'}</dt>
          <dd>{formatTimestamp(detail.occurredAt ?? detail.revealedAt)}</dd>
        </div>
        {detail.integrityPercent !== undefined ? (
          <div>
            <dt>Integrity</dt>
            <dd className="net-echo-panel__integrity">{detail.integrityPercent}%</dd>
          </div>
        ) : null}
      </dl>

      {detail.frequencies.length > 0 ? (
        <div className="net-echo-panel__frequencies" aria-label="Signal frequencies">
          {detail.frequencies.map((frequency) => (
            <span key={frequency}>{frequency}</span>
          ))}
        </div>
      ) : null}

      {detail.summary ? <p className="net-echo-panel__summary">{detail.summary}</p> : null}
      <p
        className="net-echo-panel__content"
        data-corrupted={isCorrupted ? 'true' : 'false'}
      >
        {detail.body}
      </p>

      {detail.primaryReference ? (
        <div className="net-echo-panel__reference">
          <span>Referenced record</span>
          <strong>
            {detail.primaryReference.appId} / {detail.primaryReference.resourceKind}
          </strong>
        </div>
      ) : null}

      <div className="net-echo-panel__actions net-echo-panel__actions--single">
        <button
          type="button"
          data-active={detail.viewerSaved ? 'true' : 'false'}
          onClick={onSave}
          disabled={isSaving}
          aria-pressed={detail.viewerSaved}
        >
          {detail.viewerSaved
            ? <BookmarkCheck size={14} aria-hidden="true" />
            : <Bookmark size={14} aria-hidden="true" />}
          {isSaving ? 'Synchronizing…' : detail.viewerSaved ? 'Saved' : 'Save'}
        </button>
      </div>
    </div>
  )
}
