import { Clock3, MapPin, Radio, RefreshCcw, ShieldCheck } from 'lucide-react'

import type { NewsPlatformIncident } from '../../../lib/newsPlatformTypes'
import { formatNewsPlatformDateTime } from './newsPlatformPresentation'

function classes(prefix: string, token: string) {
  return `${prefix}-${token}`
}

export function NewsPlatformLiveTimeline({
  classNamePrefix,
  incident,
  emptyTitle,
  emptyCopy,
  onRefresh,
  refreshDisabled = false,
}: {
  readonly classNamePrefix: string
  readonly incident?: NewsPlatformIncident
  readonly emptyTitle: string
  readonly emptyCopy: string
  readonly onRefresh?: () => void
  readonly refreshDisabled?: boolean
}) {
  if (!incident) {
    return (
      <section className={classes(classNamePrefix, 'live-empty')}>
        <Radio size={22} aria-hidden="true" /><h2>{emptyTitle}</h2><p>{emptyCopy}</p>
      </section>
    )
  }

  return (
    <section className={classes(classNamePrefix, 'live-desk')} aria-live="polite">
      <header className={classes(classNamePrefix, 'live-desk__header')}>
        <div className={classes(classNamePrefix, 'live-desk__badges')}>
          <span className={classes(classNamePrefix, 'live-desk__live-badge')}><Radio size={12} aria-hidden="true" />Live</span>
          {incident.verificationLabel ? <span data-verification={incident.verificationKey}><ShieldCheck size={12} aria-hidden="true" />{incident.verificationLabel}</span> : null}
        </div>
        <span className={classes(classNamePrefix, 'category-tag')}>{incident.categoryLabel}</span>
        <h2>{incident.headline}</h2>
        {incident.summary ? <p>{incident.summary}</p> : null}
        <dl>
          <div><dt>Desk</dt><dd>{incident.bylineName}{incident.bylineRole ? ` · ${incident.bylineRole}` : ''}</dd></div>
          <div><dt>Started</dt><dd><Clock3 size={12} aria-hidden="true" />{formatNewsPlatformDateTime(incident.startedAt)}</dd></div>
          {incident.locationLabel || incident.coverageLabel ? <div><dt>Coverage</dt><dd><MapPin size={12} aria-hidden="true" />{[incident.locationLabel, incident.coverageLabel].filter(Boolean).join(' · ')}</dd></div> : null}
        </dl>
      </header>
      <div className={classes(classNamePrefix, 'live-ledger__heading')}><div><strong>Incident ledger</strong><span>{incident.updates.length} / 100 updates</span></div>{onRefresh ? <button type="button" onClick={onRefresh} disabled={refreshDisabled}><RefreshCcw size={13} aria-hidden="true" />Refresh</button> : null}</div>
      {incident.updates.length === 0 ? (
        <div className={classes(classNamePrefix, 'live-ledger__empty')}><Radio size={18} aria-hidden="true" /><p>Coverage is active. The newsroom has not filed its first update.</p></div>
      ) : (
        <ol className={classes(classNamePrefix, 'live-ledger')}>
          {incident.updates.map((update, index) => (
            <li key={update.id} data-kind={update.kind} data-latest={index === incident.updates.length - 1 ? 'true' : undefined}>
              <span className={classes(classNamePrefix, 'live-ledger__sequence')}>#{String(update.sequence).padStart(2, '0')}</span>
              <article><header><span>{update.kindLabel}</span>{update.verificationLabel ? <span data-verification={update.verificationKey}>{update.verificationLabel}</span> : null}<time dateTime={update.publishedAt}>{formatNewsPlatformDateTime(update.publishedAt)}</time></header><p>{update.body}</p></article>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
