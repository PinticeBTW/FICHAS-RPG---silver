import { Clock3, MapPin, Radio, RefreshCcw, ShieldCheck } from 'lucide-react'

import type {
  NetNvnIncidentUpdateKind,
  NetNvnIncidentUpdateVerificationStatus,
  NetNvnIncidentVerificationStatus,
} from '../../lib/netNvnLiveTypes'
import { NvnReaderFeedback, NvnRefreshStrip } from './NvnReaderFeedback'
import { NvnRadioDesk } from './NvnRadioDesk'
import type { NvnRadioController } from './useNetNvnRadio'
import { NVN_CATEGORY_LABELS, formatNvnDateTime } from './nvnPresentation'
import { useNetNvnLiveDesk } from './useNetNvnLiveDesk'

const INCIDENT_VERIFICATION_LABELS: Record<NetNvnIncidentVerificationStatus, string> = {
  developing: 'Developing',
  verified: 'Verified',
  'multiple-sources': 'Multiple sources',
  'official-statement': 'Official statement',
  unconfirmed: 'Unconfirmed',
}

const UPDATE_KIND_LABELS: Record<NetNvnIncidentUpdateKind, string> = {
  update: 'Update',
  confirmation: 'Confirmation',
  warning: 'Warning',
  correction: 'Correction',
}

const UPDATE_VERIFICATION_LABELS: Record<NetNvnIncidentUpdateVerificationStatus, string> = {
  confirmed: 'Confirmed',
  developing: 'Developing',
  unconfirmed: 'Unconfirmed',
}

function NvnIncidentDesk({
  enabled,
  realtimeInvalidationVersion,
}: {
  readonly enabled: boolean
  readonly realtimeInvalidationVersion: number
}) {
  const live = useNetNvnLiveDesk(enabled, realtimeInvalidationVersion)

  if (live.phase === 'loading' && !live.desk) {
    return (
      <NvnReaderFeedback
        title="Synchronizing live desk"
        detail="Retrieving the bounded authoritative incident ledger."
        loading
      />
    )
  }

  if (live.phase === 'failed' && !live.desk) {
    return (
      <NvnReaderFeedback
        title="Live desk unavailable"
        detail={live.error ?? 'The NVN live ledger could not be reached.'}
        error
        onRetry={live.retry}
      />
    )
  }

  if (!live.desk?.incident) {
    return (
      <section className="nvn-live-empty" aria-labelledby="nvn-live-empty-title">
        {live.refreshing ? <NvnRefreshStrip message="Synchronizing LIVE desk…" /> : null}
        {live.error ? <NvnRefreshStrip message={live.error} error onRetry={live.retry} /> : null}
        <Radio size={22} aria-hidden="true" />
        <h2 id="nvn-live-empty-title">No active live incident</h2>
        <p>There is no active NVN incident ledger on this grid.</p>
        <span>Live incident coverage will appear here when the newsroom opens a desk.</span>
      </section>
    )
  }

  const { incident, updates } = live.desk
  return (
    <section className="nvn-live-desk" aria-label="NVN live coverage" aria-live="polite">
      {live.refreshing ? <NvnRefreshStrip message="LIVE ledger synchronizing…" /> : null}
      {live.error ? <NvnRefreshStrip message={live.error} error onRetry={live.retry} /> : null}

      <header className="nvn-live-desk__header">
        <div className="nvn-live-desk__badges">
          <span className="nvn-live-desk__live-badge"><Radio size={12} aria-hidden="true" /> Live</span>
          <span data-verification={incident.verificationStatus}>
            <ShieldCheck size={12} aria-hidden="true" />
            {INCIDENT_VERIFICATION_LABELS[incident.verificationStatus]}
          </span>
        </div>
        <span className="nvn-category-tag">{NVN_CATEGORY_LABELS[incident.category]}</span>
        <h2>{incident.headline}</h2>
        {incident.summary ? <p>{incident.summary}</p> : null}
        <dl>
          <div>
            <dt>Desk</dt>
            <dd>{incident.bylineName}{incident.bylineRole ? ` · ${incident.bylineRole}` : ''}</dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd><Clock3 size={12} aria-hidden="true" /> {formatNvnDateTime(incident.startedAt)}</dd>
          </div>
          {incident.locationLabel || incident.districtLabel ? (
            <div>
              <dt>Location</dt>
              <dd>
                <MapPin size={12} aria-hidden="true" />
                {[incident.locationLabel, incident.districtLabel].filter(Boolean).join(' · ')}
              </dd>
            </div>
          ) : null}
        </dl>
      </header>

      <div className="nvn-live-ledger__heading">
        <div>
          <strong>Incident ledger</strong>
          <span>{updates.length} / 100 updates</span>
        </div>
        <button type="button" onClick={live.retry} disabled={live.refreshing}>
          <RefreshCcw size={13} aria-hidden="true" /> Refresh
        </button>
      </div>

      {updates.length === 0 ? (
        <div className="nvn-live-ledger__empty">
          <Radio size={18} aria-hidden="true" />
          <p>Coverage is active. The newsroom has not filed its first update.</p>
        </div>
      ) : (
        <ol className="nvn-live-ledger">
          {updates.map((update, index) => (
            <li
              key={update.id}
              data-kind={update.updateKind}
              data-latest={index === updates.length - 1 ? 'true' : undefined}
            >
              <span className="nvn-live-ledger__sequence">#{String(update.sequence).padStart(2, '0')}</span>
              <article>
                <header>
                  <span>{UPDATE_KIND_LABELS[update.updateKind]}</span>
                  <span data-verification={update.verificationStatus}>
                    {UPDATE_VERIFICATION_LABELS[update.verificationStatus]}
                  </span>
                  <time dateTime={update.publishedAt}>{formatNvnDateTime(update.publishedAt)}</time>
                </header>
                <p>{update.body}</p>
              </article>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export function NvnLiveDesk({
  enabled,
  realtimeInvalidationVersion,
  radio,
}: {
  readonly enabled: boolean
  readonly realtimeInvalidationVersion: number
  readonly radio: NvnRadioController
}) {
  return (
    <div className="nvn-live-broadcast-stack">
      <NvnRadioDesk radio={radio} />
      <NvnIncidentDesk
        enabled={enabled}
        realtimeInvalidationVersion={realtimeInvalidationVersion}
      />
    </div>
  )
}
