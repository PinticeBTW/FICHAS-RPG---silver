import { ShieldAlert } from 'lucide-react'
import { useMemo } from 'react'
import { SharedMediaImage } from '../shared/SharedMediaImage'

import {
  selfPrivacyFields,
  type AccessEvent,
  type Credential,
  type IdenNav,
  type TrustBand,
  type TrustFactor,
} from './idenData'

function QrVisual({ seed }: { seed: string }) {
  const cells = useMemo(() => {
    let hash = 0
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
    }

    const arr: boolean[] = []
    for (let i = 0; i < 64; i += 1) {
      hash = (hash * 1103515245 + 12345) >>> 0
      arr.push(((hash >> 16) & 1) === 0)
    }
    return arr
  }, [seed])

  return (
    <div className="iden-qr" aria-hidden="true">
      {cells.map((filled, index) => (
        <span key={index} data-filled={filled ? 'true' : 'false'} />
      ))}
    </div>
  )
}

interface IdenOverviewProps {
  displayName: string
  handle: string
  avatarUrl?: string
  displayId: string
  district: string
  trustScore: number
  trustBand: TrustBand
  factors: TrustFactor[]
  credentials: Credential[]
  accessEvents: AccessEvent[]
  onNavigate: (nav: IdenNav) => void
}

export function IdenOverview({
  displayName,
  handle,
  avatarUrl,
  displayId,
  district,
  trustScore,
  trustBand,
  factors,
  credentials,
  accessEvents,
  onNavigate,
}: IdenOverviewProps) {
  const positiveFactor = [...factors].sort((a, b) => b.value - a.value)[0]
  const negativeFactor = [...factors].sort((a, b) => a.value - b.value)[0]

  const activeCredentials = credentials.filter((c) => c.status === 'active').length
  const expiringCredentials = credentials.filter((c) => c.status === 'expiring').length
  const suspendedCredentials = credentials.filter(
    (c) => c.status === 'suspended' || c.status === 'expired',
  ).length

  const recentAccess = [...accessEvents].sort((a, b) => a.minutesAgo - b.minutesAgo)[0]
  const hasSuspicious = accessEvents.some((event) => event.risk === 'suspicious')

  const publicFieldsCount = selfPrivacyFields.filter((f) => f.defaultPublic).length
  const privateFieldsCount = selfPrivacyFields.filter(
    (f) => !f.defaultPublic && f.category !== 'mandatory',
  ).length
  const mandatoryFieldsCount = selfPrivacyFields.filter((f) => f.category === 'mandatory').length

  return (
    <div className="iden-overview">
      <section className="iden-id-card">
        <div className="iden-id-card__top">
          <span className="iden-id-card__avatar">
            {avatarUrl ? (
              <SharedMediaImage source={avatarUrl} variant="thumbnail" alt="" />
            ) : (
              displayName.slice(0, 1).toUpperCase()
            )}
          </span>

          <div className="iden-id-card__identity">
            <strong>{displayName}</strong>
            <span>{handle}</span>
            <span className="iden-id-card__id">{displayId}</span>
          </div>

          <QrVisual seed={displayId} />
        </div>

        <div className="iden-id-card__row">
          <span>Citizen status</span>
          <strong>Verified Citizen</strong>
        </div>
        <div className="iden-id-card__row">
          <span>District</span>
          <strong>{district}</strong>
        </div>
        <div className="iden-id-card__row">
          <span>Trust Index</span>
          <strong data-band={trustBand}>
            {trustScore} · {trustBand}
          </strong>
        </div>
        <div className="iden-id-card__row">
          <span>Last identity sync</span>
          <strong>2H AGO</strong>
        </div>

        <p className="iden-id-card__footnote">Secured through VEGA MESH.</p>
      </section>

      <div className="iden-overview__grid">
        <button type="button" className="iden-overview-card" onClick={() => onNavigate('trust')}>
          <span className="iden-overview-card__label">Trust summary</span>
          <strong className="iden-overview-card__score" data-band={trustBand}>
            {trustScore}
          </strong>
          <span className="iden-overview-card__band">{trustBand} band</span>
          <div className="iden-overview-card__lines">
            <span>+ {positiveFactor?.label}</span>
            <span>− {negativeFactor?.label}</span>
          </div>
          <em>View full analysis →</em>
        </button>

        <button
          type="button"
          className="iden-overview-card"
          onClick={() => onNavigate('credentials')}
        >
          <span className="iden-overview-card__label">Credential summary</span>
          <div className="iden-overview-card__stats">
            <div>
              <strong>{activeCredentials}</strong>
              <span>Active</span>
            </div>
            <div>
              <strong>{expiringCredentials}</strong>
              <span>Expiring</span>
            </div>
            <div>
              <strong>{suspendedCredentials}</strong>
              <span>Suspended</span>
            </div>
          </div>
          <em>Open Credentials →</em>
        </button>

        <button type="button" className="iden-overview-card" onClick={() => onNavigate('access')}>
          <span className="iden-overview-card__label">Access summary</span>
          {recentAccess ? (
            <p>
              {recentAccess.service} · {recentAccess.timestamp}
            </p>
          ) : (
            <p>No recent access.</p>
          )}
          {hasSuspicious ? (
            <div className="iden-overview-card__warning">
              <ShieldAlert size={12} /> Suspicious access detected
            </div>
          ) : null}
          <em>Open Access Log →</em>
        </button>

        <button
          type="button"
          className="iden-overview-card"
          onClick={() => onNavigate('connections')}
        >
          <span className="iden-overview-card__label">Connected networks</span>
          <div className="iden-overview-card__networks">
            <span data-status="connected">VEGA MESH</span>
            <span data-status="connected">ECHO</span>
            <span data-status="connected">PULSE</span>
            <span data-status="connected">IDEN Core</span>
            <span data-status="inactive">LOOP</span>
          </div>
          <em>Open Connections →</em>
        </button>

        <button
          type="button"
          className="iden-overview-card"
          onClick={() => onNavigate('privacy')}
        >
          <span className="iden-overview-card__label">Privacy status</span>
          <div className="iden-overview-card__stats">
            <div>
              <strong>{publicFieldsCount}</strong>
              <span>Public</span>
            </div>
            <div>
              <strong>{privateFieldsCount}</strong>
              <span>Private</span>
            </div>
            <div>
              <strong>{mandatoryFieldsCount}</strong>
              <span>Mandatory</span>
            </div>
          </div>
          <em>Open Privacy →</em>
        </button>

        <button
          type="button"
          className="iden-overview-card"
          onClick={() => onNavigate('directory')}
        >
          <span className="iden-overview-card__label">Directory</span>
          <p>Search citizens, corporations and authorities across New Vega.</p>
          <em>Open Directory →</em>
        </button>
      </div>
    </div>
  )
}
