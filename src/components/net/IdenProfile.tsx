import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  Copy,
  Lock,
  MapPin,
  Pin,
  PinOff,
  ShieldAlert,
  ShieldQuestion,
} from 'lucide-react'
import { SharedMediaImage } from '../shared/SharedMediaImage'
import { useState } from 'react'

import type { Identity } from './idenData'

interface IdenProfileProps {
  identity: Identity
  isPinned: boolean
  onTogglePin: () => void
  onBack: () => void
  onOpenProfile: (id: string) => void
  onOpenCredentials: () => void
  onNotice: (message: string) => void
  identitiesById: Map<string, Identity>
  isCurrentIdentity: boolean
}

function verificationLabel(identity: Identity): string {
  switch (identity.verification) {
    case 'verified':
      return 'Verified'
    case 'infrastructure-authority':
      return 'Infrastructure authority'
    case 'authority-verified':
      return 'Authority verified'
    case 'anomalous':
      return 'Anomalous'
    case 'pending':
      return 'Pending'
    default:
      return 'Unverified'
  }
}

export function IdenProfile({
  identity,
  isPinned,
  onTogglePin,
  onBack,
  onOpenProfile,
  onOpenCredentials,
  onNotice,
  identitiesById,
  isCurrentIdentity,
}: IdenProfileProps) {
  const [channelRequested, setChannelRequested] = useState(false)

  const handleCopyId = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(identity.displayId)
        onNotice('IDEN // DISPLAY ID COPIED')
      } else {
        onNotice('IDEN // CLIPBOARD UNAVAILABLE')
      }
    } catch {
      onNotice('IDEN // COPY FAILED')
    }
  }

  const handleOpenCredential = (name: string) => {
    if (isCurrentIdentity) {
      onOpenCredentials()
      return
    }
    onNotice(`IDEN // "${name}" DETAIL NOT PUBLICLY AVAILABLE`)
  }

  const handleRequestChannel = () => {
    if (channelRequested) {
      onNotice('IDEN // VERIFIED CHANNEL ALREADY REQUESTED THIS SESSION')
      return
    }
    setChannelRequested(true)
    onNotice(`IDEN // VERIFIED CHANNEL REQUESTED — ${identity.name.toUpperCase()}`)
  }

  return (
    <div className="iden-profile">
      <button type="button" className="iden-back" onClick={onBack}>
        <ArrowLeft size={14} />
        Back to directory
      </button>

      <div className="iden-profile__card" data-type={identity.type} data-corrupted={identity.corrupted ? 'true' : 'false'}>
        <span className="iden-profile__avatar" data-type={identity.type}>
          {identity.avatarUrl ? (
            <SharedMediaImage source={identity.avatarUrl} variant="thumbnail" alt="" />
          ) : identity.type === 'unresolved' ? (
            <ShieldQuestion size={22} />
          ) : identity.type === 'corporation' || identity.type === 'authority' ? (
            <Building2 size={20} />
          ) : (
            identity.name.slice(0, 1).toUpperCase()
          )}
        </span>

        <div className="iden-profile__identity">
          <div className="iden-profile__name-row">
            <strong>{identity.name}</strong>
            {identity.verification === 'verified' ||
            identity.verification === 'authority-verified' ||
            identity.verification === 'infrastructure-authority' ? (
              <BadgeCheck size={15} className="iden-verified-badge" />
            ) : null}
          </div>

          <span className="iden-profile__handle">@{identity.handle}</span>

          <div className="iden-profile__tags">
            <span className="iden-tag" data-tone="type">
              {identity.type}
            </span>
            <span className="iden-tag" data-tone="verification">
              {verificationLabel(identity)}
            </span>
            {identity.district ? (
              <span className="iden-tag">
                <MapPin size={10} /> {identity.district}
              </span>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          className="iden-pin-toggle"
          data-active={isPinned ? 'true' : 'false'}
          onClick={onTogglePin}
          aria-label={isPinned ? 'Unpin identity' : 'Pin identity'}
          title={isPinned ? 'Unpin' : 'Pin'}
        >
          {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
        </button>
      </div>

      <div className="iden-profile__idrow">
        <span>IDEN display id</span>
        <strong>{identity.displayId}</strong>
        <button type="button" onClick={handleCopyId} aria-label="Copy display id" title="Copy">
          <Copy size={13} />
        </button>
      </div>

      <p className="iden-profile__bio" data-corrupted={identity.corrupted ? 'true' : 'false'}>
        {identity.bio}
      </p>

      <div className="iden-profile__grid">
        {identity.trustScore !== undefined ? (
          <div className="iden-stat-card">
            <span>Trust Index</span>
            <strong>{identity.trustScore}</strong>
            <em data-band={identity.trustBand}>{identity.trustBand} band</em>
          </div>
        ) : identity.corporateTrust ? (
          <div className="iden-stat-card">
            <span>Corporate Trust</span>
            <strong>{identity.corporateTrust.replace('-', ' ')}</strong>
          </div>
        ) : (
          <div className="iden-stat-card" data-unavailable="true">
            <span>Trust Index</span>
            <strong>Unavailable</strong>
            <em data-band="unknown">unknown band</em>
          </div>
        )}

        <div className="iden-stat-card">
          <span>Security risk</span>
          <strong data-risk={identity.securityRisk}>{identity.securityRisk}</strong>
        </div>

        {identity.networkReputation ? (
          <div className="iden-stat-card">
            <span>Network reputation</span>
            <strong>{identity.networkReputation}</strong>
          </div>
        ) : null}

        <div className="iden-stat-card">
          <span>Last verified</span>
          <strong>{identity.lastVerified}</strong>
        </div>
      </div>

      {identity.corrupted && identity.restrictedSections?.length ? (
        <div className="iden-restricted">
          <ShieldAlert size={14} />
          <div>
            <strong>Sections restricted by NetWatch monitoring</strong>
            <ul>
              {identity.restrictedSections.map((section) => (
                <li key={section}>
                  <Lock size={11} /> {section}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {identity.flags?.length ? (
        <section className="iden-section">
          <h3>Flags</h3>
          <div className="iden-flag-list">
            {identity.flags.map((flag) => (
              <div key={flag.id} className="iden-flag" data-severity={flag.severity}>
                <ShieldAlert size={12} />
                {flag.label}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {identity.credentialNames?.length ? (
        <section className="iden-section">
          <h3>Credentials</h3>
          <div className="iden-chip-row">
            {identity.credentialNames.map((name) => (
              <button key={name} type="button" onClick={() => handleOpenCredential(name)}>
                {name}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {identity.networkIdentities?.length ? (
        <section className="iden-section">
          <h3>Network identities</h3>
          <div className="iden-list iden-list--plain">
            {identity.networkIdentities.map((ref) => (
              <div key={ref.service} className="iden-network-ref">
                <strong>{ref.service}</strong>
                {ref.handle ? <span>{ref.handle}</span> : null}
                <em>{ref.status}</em>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {identity.organisations?.length ? (
        <section className="iden-section">
          <h3>Known organisations &amp; licensing</h3>
          <div className="iden-list iden-list--plain">
            {identity.organisations.map((org) => (
              <div key={org.id} className="iden-network-ref">
                <strong>{org.name}</strong>
                <em>{org.relationship}</em>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {identity.connections?.length ? (
        <section className="iden-section">
          <h3>Connections</h3>
          <div className="iden-chip-row">
            {identity.connections.map((connId) => {
              const related = identitiesById.get(connId)
              if (!related) return null
              return (
                <button key={connId} type="button" onClick={() => onOpenProfile(connId)}>
                  {related.name}
                </button>
              )
            })}
          </div>
        </section>
      ) : null}

      <section className="iden-section">
        <h3>Public access history</h3>
        <p className="iden-lead">
          {identity.corrupted
            ? 'Access history could not be reconciled with a verified issuer.'
            : identity.type === 'corporation' || identity.type === 'authority'
              ? 'Institutional access is logged under standard NetWatch data-sharing agreements.'
              : 'Standard NetWatch monitoring applies. Detailed history is private.'}
        </p>
      </section>

      {!isCurrentIdentity ? (
        <button
          type="button"
          className="iden-request-channel"
          data-requested={channelRequested ? 'true' : 'false'}
          onClick={handleRequestChannel}
        >
          {channelRequested ? 'Verified channel requested' : 'Request verified channel'}
        </button>
      ) : null}

      <p className="iden-profile__footnote">
        Identity handshake secured by VEGA MESH.
      </p>
    </div>
  )
}
