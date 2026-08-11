import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import '../../styles/iden.css'

import { createCurrentIdenIdentity } from './idenCurrentIdentity'
import type { NetActiveIdentityState } from './identity/netActiveIdentity'
import type { NetAppAccountResolution } from './accounts/netAppAccountTypes'
import { IdenAccessLog } from './IdenAccessLog'
import { IdenConnections } from './IdenConnections'
import { IdenCredentials } from './IdenCredentials'
import { IdenDirectory } from './IdenDirectory'
import { IdenOverview } from './IdenOverview'
import { IdenProfile } from './IdenProfile'
import { IdenReviewDialog } from './IdenReviewDialog'
import { IdenSidebar } from './IdenSidebar'
import { IdenTrustPanel } from './IdenTrustPanel'
import {
  identities,
  selfAccessEvents,
  selfConnections,
  selfCredentials,
  selfPrivacyFields,
  selfTrustBand,
  selfTrustFactors,
  selfTrustHistory,
  selfTrustScore,
  type AccessEvent,
  type Credential,
  type IdenConnectionRecord,
  type IdenNav,
} from './idenData'

interface IdenAppProps {
  onNotice: (message: string) => void
  activeIdentity: NetActiveIdentityState
  accountResolution: NetAppAccountResolution
}

function PersonalIdentityUnavailable({
  state,
}: {
  state: Exclude<ReturnType<typeof createCurrentIdenIdentity>, { status: 'ready' }>
}) {
  const title = state.status === 'gm-no-persona'
    ? 'NO ACTIVE PERSONA'
    : state.status === 'loading'
      ? 'RESOLVING IDENTITY'
      : 'IDENTITY REQUIRED'

  return (
    <div className="iden-empty-state" role="status">
      <span>
        <strong>{title}</strong>
        <br />
        {state.message}
      </span>
    </div>
  )
}

function PrivacySection({
  visibility,
  onToggle,
  onReset,
  onApply,
}: {
  visibility: Record<string, boolean>
  onToggle: (id: string) => void
  onReset: () => void
  onApply: () => void
}) {
  const categories: { id: 'public' | 'conditional' | 'private' | 'mandatory'; label: string }[] = [
    { id: 'public', label: 'Public' },
    { id: 'conditional', label: 'Conditional' },
    { id: 'private', label: 'Private' },
    { id: 'mandatory', label: 'Mandatory' },
  ]

  const publicPreview = selfPrivacyFields.filter((field) => visibility[field.id])

  return (
    <div className="iden-privacy">
      <div className="iden-privacy__fields">
        {categories.map((category) => (
          <section key={category.id} className="iden-section">
            <h3>{category.label} fields</h3>

            <div className="iden-list iden-list--plain">
              {selfPrivacyFields
                .filter((field) => field.category === category.id)
                .map((field) => {
                  const editable = field.category === 'conditional'
                  const isPublic = visibility[field.id]

                  return (
                    <div key={field.id} className="iden-privacy-row">
                      <span className="iden-privacy-row__label">{field.label}</span>
                      <span className="iden-privacy-row__value">{field.value}</span>

                      <button
                        type="button"
                        className="iden-privacy-row__toggle"
                        data-public={isPublic ? 'true' : 'false'}
                        data-locked={editable ? 'false' : 'true'}
                        onClick={() => onToggle(field.id)}
                        aria-label={
                          editable
                            ? isPublic
                              ? `Make ${field.label} private`
                              : `Make ${field.label} public`
                            : `${field.label} cannot be changed`
                        }
                      >
                        {editable ? (isPublic ? 'Public' : 'Private') : 'Locked'}
                      </button>
                    </div>
                  )
                })}
            </div>
          </section>
        ))}
      </div>

      <aside className="iden-privacy__preview">
        <h3>Public profile preview</h3>
        <div className="iden-privacy__preview-list">
          {publicPreview.map((field) => (
            <div key={field.id}>
              <span>{field.label}</span>
              <strong>{field.value}</strong>
            </div>
          ))}
        </div>

        <p className="iden-privacy__note">
          Some mandatory fields cannot be hidden — they are required for network integrity and
          regulatory compliance.
        </p>

        <p className="iden-privacy__creepy">
          Certain derived identity attributes may be retained for network integrity even when not
          displayed publicly.
        </p>

        <div className="iden-privacy__actions">
          <button type="button" onClick={onReset}>
            Reset changes
          </button>
          <button type="button" className="iden-privacy__apply" onClick={onApply}>
            Apply changes
          </button>
        </div>
      </aside>
    </div>
  )
}

export function IdenApp({ onNotice, activeIdentity, accountResolution }: IdenAppProps) {
  const personalIdentity = useMemo(
    () => createCurrentIdenIdentity({ activeIdentity, accountResolution }),
    [accountResolution, activeIdentity],
  )
  const currentIdentity = personalIdentity.status === 'ready'
    ? personalIdentity.identity
    : undefined
  const identitySessionKey = personalIdentity.status === 'ready'
    ? personalIdentity.account.id
    : activeIdentity.status === 'ready'
      ? `${activeIdentity.identity.subject.kind}:${activeIdentity.identity.subject.kind === 'profile-sheet'
        ? activeIdentity.identity.subject.profileId
        : activeIdentity.identity.subject.kind === 'npc-card'
          ? activeIdentity.identity.subject.npcCardId
          : activeIdentity.identity.subject.characterId}`
    : activeIdentity.status === 'gm-no-persona'
      ? activeIdentity.authenticatedProfileId
      : activeIdentity.status

  const allIdentities = useMemo(
    () => currentIdentity ? [...identities, currentIdentity] : identities,
    [currentIdentity],
  )
  const identitiesById = useMemo(
    () => new Map(allIdentities.map((identity) => [identity.id, identity])),
    [allIdentities],
  )

  const [nav, setNav] = useState<IdenNav>('overview')
  const [viewingIdentityId, setViewingIdentityId] = useState<string | null>(null)
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => new Set())
  const pinnedIdsRef = useRef<Set<string>>(new Set())

  const [credentials, setCredentials] = useState<Credential[]>(() =>
    selfCredentials.map((c) => ({ ...c })),
  )
  const [connections, setConnections] = useState<IdenConnectionRecord[]>(() =>
    selfConnections.map((c) => ({ ...c })),
  )
  const [accessEvents, setAccessEvents] = useState<AccessEvent[]>(() =>
    selfAccessEvents.map((e) => ({ ...e })),
  )

  const [reviewDialogOpen, setReviewDialogOpen] = useState(false)
  const [reviewSubmitted, setReviewSubmitted] = useState(false)

  const [privacyVisibility, setPrivacyVisibility] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(selfPrivacyFields.map((f) => [f.id, f.defaultPublic])),
  )

  useEffect(() => {
    setViewingIdentityId(null)
    const resetPinnedIds = new Set<string>()
    pinnedIdsRef.current = resetPinnedIds
    setPinnedIds(resetPinnedIds)
    setCredentials(selfCredentials.map((credential) => ({ ...credential })))
    setConnections(selfConnections.map((connection) => ({ ...connection })))
    setAccessEvents(selfAccessEvents.map((event) => ({ ...event })))
    setReviewDialogOpen(false)
    setReviewSubmitted(false)
    setPrivacyVisibility(Object.fromEntries(
      selfPrivacyFields.map((field) => [field.id, field.defaultPublic]),
    ))
  }, [identitySessionKey])

  const handleNavChange = (next: IdenNav) => {
    setNav(next)
    setViewingIdentityId(null)
  }

  const handleOpenProfile = (id: string) => {
    setViewingIdentityId(id)
  }

  const handleTogglePin = (id: string) => {
    const next = new Set(pinnedIdsRef.current)
    const nowPinned = !next.has(id)

    if (nowPinned) next.add(id)
    else next.delete(id)

    pinnedIdsRef.current = next
    setPinnedIds(() => next)
    onNotice(nowPinned ? 'IDEN // IDENTITY PINNED' : 'IDEN // IDENTITY UNPINNED')
  }

  const handleToggleCredentialVisibility = (id: string) => {
    setCredentials((prev) =>
      prev.map((c) => (c.id === id ? { ...c, publicVisible: !c.publicVisible } : c)),
    )
    onNotice('IDEN // CREDENTIAL VISIBILITY UPDATED')
  }

  const handleVerifyCredential = (id: string) => {
    setCredentials((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              lastVerified: 'NOW',
              status: c.status === 'expired' || c.status === 'suspended' ? c.status : 'active',
            }
          : c,
      ),
    )
    onNotice('IDEN // CREDENTIAL VERIFIED')
  }

  const handleRevokeConnection = (id: string) => {
    const connection = connections.find((c) => c.id === id)
    if (!connection) return

    if (connection.required) {
      onNotice(`IDEN // ${connection.service.toUpperCase()} IS REQUIRED AND CANNOT BE REVOKED`)
      return
    }

    setConnections((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: 'revoked' } : c)),
    )
    onNotice(`IDEN // ${connection.service.toUpperCase()} CONNECTION REVOKED`)
  }

  const handleEnableConnection = (id: string) => {
    const connection = connections.find((c) => c.id === id)

    setConnections((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: 'connected' } : c)),
    )
    onNotice(`IDEN // ${connection?.service.toUpperCase() ?? 'CONNECTION'} RE-ENABLED`)
  }

  const handleMarkReviewed = (id: string) => {
    setAccessEvents((prev) =>
      prev.map((event) => (event.id === id ? { ...event, reviewed: true } : event)),
    )
    onNotice('IDEN // EVENT MARKED REVIEWED')
  }

  const handleFlagEvent = (id: string) => {
    const target = accessEvents.find((event) => event.id === id)
    const nextFlag = !target?.flaggedLocally

    setAccessEvents((prev) =>
      prev.map((event) => (event.id === id ? { ...event, flaggedLocally: nextFlag } : event)),
    )
    onNotice(nextFlag ? 'IDEN // EVENT FLAGGED' : 'IDEN // FLAG REMOVED')
  }

  const handleOpenReview = () => {
    if (reviewSubmitted) {
      onNotice('IDEN // REVIEW ALREADY REQUESTED THIS SESSION')
      return
    }
    setReviewDialogOpen(true)
  }

  const handleSubmitReview = (reason: string) => {
    setReviewSubmitted(true)
    setReviewDialogOpen(false)
    onNotice(`IDEN // REVIEW REQUESTED — ${reason.toUpperCase()}`)
  }

  const handleTogglePrivacyField = (fieldId: string) => {
    const field = selfPrivacyFields.find((f) => f.id === fieldId)

    if (!field || field.category !== 'conditional') {
      onNotice('IDEN // THIS FIELD CANNOT BE HIDDEN')
      return
    }

    setPrivacyVisibility((prev) => ({ ...prev, [fieldId]: !prev[fieldId] }))
  }

  const handleResetPrivacy = () => {
    setPrivacyVisibility(Object.fromEntries(selfPrivacyFields.map((f) => [f.id, f.defaultPublic])))
    onNotice('IDEN // PRIVACY CHANGES RESET')
  }

  const handleApplyPrivacy = () => {
    onNotice('IDEN // PRIVACY SETTINGS APPLIED (SESSION ONLY)')
  }

  let centerContent: ReactNode

  const viewingIdentity = viewingIdentityId ? identitiesById.get(viewingIdentityId) : null

  if (viewingIdentity) {
    centerContent = (
      <IdenProfile
        key={viewingIdentity.id}
        identity={viewingIdentity}
        isPinned={pinnedIds.has(viewingIdentity.id)}
        onTogglePin={() => handleTogglePin(viewingIdentity.id)}
        onBack={() => setViewingIdentityId(null)}
        onOpenProfile={handleOpenProfile}
        onOpenCredentials={() => {
          setViewingIdentityId(null)
          setNav('credentials')
        }}
        onNotice={onNotice}
        identitiesById={identitiesById}
        isCurrentIdentity={viewingIdentity.id === currentIdentity?.id}
      />
    )
  } else if (personalIdentity.status !== 'ready' && nav !== 'directory') {
    centerContent = <PersonalIdentityUnavailable state={personalIdentity} />
  } else {
    switch (nav) {
      case 'directory':
        centerContent = (
          <IdenDirectory
            identities={identities}
            onOpenProfile={handleOpenProfile}
            onNotice={onNotice}
          />
        )
        break

      case 'credentials':
        centerContent = (
          <IdenCredentials
            key={identitySessionKey}
            credentials={credentials}
            onToggleVisibility={handleToggleCredentialVisibility}
            onVerifyNow={handleVerifyCredential}
            onNotice={onNotice}
          />
        )
        break

      case 'trust':
        centerContent = (
          <IdenTrustPanel
            key={identitySessionKey}
            score={selfTrustScore}
            band={selfTrustBand}
            history={selfTrustHistory}
            factors={selfTrustFactors}
            reviewSubmitted={reviewSubmitted}
            onOpenReview={handleOpenReview}
            onOpenRelatedEvents={() => handleNavChange('access')}
          />
        )
        break

      case 'connections':
        centerContent = (
          <IdenConnections
            key={identitySessionKey}
            connections={connections}
            onRevoke={handleRevokeConnection}
            onEnable={handleEnableConnection}
            onNotice={onNotice}
          />
        )
        break

      case 'access':
        centerContent = (
          <IdenAccessLog
            key={identitySessionKey}
            events={accessEvents}
            connections={connections}
            onMarkReviewed={handleMarkReviewed}
            onFlag={handleFlagEvent}
            onRevokeConnection={handleRevokeConnection}
            onNotice={onNotice}
          />
        )
        break

      case 'privacy':
        centerContent = (
          <PrivacySection
            key={identitySessionKey}
            visibility={privacyVisibility}
            onToggle={handleTogglePrivacyField}
            onReset={handleResetPrivacy}
            onApply={handleApplyPrivacy}
          />
        )
        break

      case 'overview':
      default:
        centerContent = personalIdentity.status === 'ready' ? (
          <IdenOverview
            displayName={personalIdentity.identity.name}
            handle={personalIdentity.displayHandle}
            avatarUrl={personalIdentity.identity.avatarUrl}
            displayId={personalIdentity.identity.displayId}
            district={personalIdentity.identity.district ?? 'Central'}
            trustScore={selfTrustScore}
            trustBand={selfTrustBand}
            factors={selfTrustFactors}
            credentials={credentials}
            accessEvents={accessEvents}
            onNavigate={handleNavChange}
          />
        ) : (
          <PersonalIdentityUnavailable state={personalIdentity} />
        )
    }
  }

  return (
    <div className="iden-app">
      <IdenSidebar
        nav={nav}
        onNavChange={handleNavChange}
        identityStatus={personalIdentity.status}
        displayName={currentIdentity?.name}
        handle={personalIdentity.status === 'ready' ? personalIdentity.displayHandle : undefined}
        avatarUrl={currentIdentity?.avatarUrl}
        trustScore={personalIdentity.status === 'ready' ? selfTrustScore : undefined}
        trustBand={personalIdentity.status === 'ready' ? selfTrustBand : undefined}
        onSearchShortcut={() => handleNavChange('directory')}
      />

      <div className="iden-content">{centerContent}</div>

      {reviewDialogOpen && personalIdentity.status === 'ready' ? (
        <IdenReviewDialog
          onClose={() => setReviewDialogOpen(false)}
          onSubmit={handleSubmitReview}
        />
      ) : null}
    </div>
  )
}
