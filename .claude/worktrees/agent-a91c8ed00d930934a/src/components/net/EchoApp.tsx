import {
  Bookmark,
  Compass,
  Radio,
  RotateCcw,
  ShieldCheck,
  Skull,
  UserRound,
  Users,
  Waves,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, useState, type CSSProperties } from 'react'

import type { NetEchoMapNode } from '../../lib/netEchoTypes'
import { SharedMediaImage } from '../shared/SharedMediaImage'
import type { NetAppAccount, NetAppAccountResolution } from './accounts/netAppAccountTypes'
import { EchoDetailPanel } from './EchoDetailPanel'
import { EchoGmControl } from './EchoGmControl'
import { EchoOnboarding } from './EchoOnboarding'
import { createCurrentEchoIdentity } from './echoCurrentIdentity'
import type { NetActiveIdentityState } from './identity/netActiveIdentity'
import type { NetAppAccessMode } from './netAppCatalog'
import { useNetEchoBrowser } from './useNetEchoBrowser'

type EchoSection = 'discover' | 'frequencies' | 'saved' | 'deadEchoes' | 'profile' | 'gmControl'

interface EchoAppProps {
  readonly onNotice: (message: string) => void
  readonly activeIdentity: NetActiveIdentityState
  readonly accountResolution: NetAppAccountResolution
  readonly accounts: readonly NetAppAccount[]
  readonly accountSessionKey: string | null
  readonly isWindowOpen: boolean
  readonly accessMode: NetAppAccessMode
  readonly onContextChanged: () => void | Promise<void>
  readonly onActivateAccount: (input: {
    readonly handle: string
  }) => Promise<string | null>
}

const SECTIONS: { id: EchoSection; label: string; icon: LucideIcon }[] = [
  { id: 'discover', label: 'Discover', icon: Compass },
  { id: 'frequencies', label: 'Frequencies', icon: Radio },
  { id: 'saved', label: 'Saved', icon: Bookmark },
  { id: 'deadEchoes', label: 'Dead Echoes', icon: Skull },
  { id: 'profile', label: 'Profile', icon: Users },
]

const GM_SYSTEM_SECTIONS: { id: EchoSection; label: string; icon: LucideIcon }[] = [
  { id: 'gmControl', label: 'Signal Control', icon: ShieldCheck },
]

const SECTION_TITLES: Record<EchoSection, string> = {
  discover: 'NEW VEGA RESONANCE MAP',
  frequencies: 'FREQUENCY SWEEP',
  saved: 'SAVED SIGNALS',
  deadEchoes: 'DEAD ECHOES // RECOVERED SIGNAL',
  profile: 'ECHO PRESENCE',
  gmControl: 'SIGNAL CONTROL',
}

function initials(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'NV'
}

function nodeTitle(node: NetEchoMapNode): string {
  return node.accessState === 'locked' ? 'ENCRYPTED SIGNAL' : node.title
}

function nodeDescription(node: NetEchoMapNode): string {
  if (node.accessState === 'locked') {
    return `Encrypted signal. ${node.lockedTeaser}`
  }
  return [node.title, node.kind, node.districtLabel].filter(Boolean).join(' — ')
}

function EchoProfileUnavailable({
  state,
  onActivate,
}: {
  readonly state: ReturnType<typeof createCurrentEchoIdentity>
  readonly onActivate: () => void
}) {
  if (state.status === 'needs-onboarding') {
    return (
      <div className="net-echo-profile net-echo-profile--unavailable" role="status">
        <UserRound size={24} aria-hidden="true" />
        <strong>YOUR SIGNAL HAS NO PRESENCE YET</strong>
        <p>Create an ECHO account before discovering intelligence or saving signals.</p>
        <button type="button" onClick={onActivate}>Activate presence</button>
      </div>
    )
  }

  const title = state.status === 'gm-no-persona'
    ? 'NO ACTIVE PERSONA'
    : state.status === 'loading'
      ? 'RESOLVING ECHO IDENTITY'
      : state.status === 'restricted'
        ? 'ECHO PRESENCE RESTRICTED'
        : 'IDENTITY REQUIRED'
  const detail = state.status === 'gm-no-persona'
    || state.status === 'loading'
    || state.status === 'restricted'
    || state.status === 'identity-required'
      ? state.message
      : 'A personal ECHO presence is not available.'

  return (
    <div className="net-echo-profile net-echo-profile--unavailable" role="status">
      <Waves size={24} aria-hidden="true" />
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  )
}

function EchoMapState({
  title,
  detail,
  retry,
  activate,
}: {
  readonly title: string
  readonly detail: string
  readonly retry?: () => void
  readonly activate?: () => void
}) {
  return (
    <div className="net-echo-map__state" role="status">
      <Waves size={22} aria-hidden="true" />
      <strong>{title}</strong>
      <p>{detail}</p>
      {retry ? (
        <button type="button" onClick={retry}>
          <RotateCcw size={13} aria-hidden="true" />
          Retry grid
        </button>
      ) : null}
      {activate ? <button type="button" onClick={activate}>Activate presence</button> : null}
    </div>
  )
}

export function EchoApp({
  onNotice,
  activeIdentity,
  accountResolution,
  accounts,
  accountSessionKey,
  isWindowOpen,
  accessMode,
  onContextChanged,
  onActivateAccount,
}: EchoAppProps) {
  const isGmSystemAccess = accessMode === 'gm-system'
  const currentIdentity = useMemo(
    () => createCurrentEchoIdentity({ activeIdentity, accountResolution }),
    [accountResolution, activeIdentity],
  )
  const accountId = !isGmSystemAccess && currentIdentity.status === 'ready'
    ? currentIdentity.identity.accountId
    : null
  const browser = useNetEchoBrowser({
    accountId,
    enabled: isWindowOpen && !isGmSystemAccess && currentIdentity.status === 'ready',
    onNotice,
    onContextChanged,
  })
  const [selectedSection, setSection] = useState<EchoSection | null>(null)
  const section: EchoSection = isGmSystemAccess
    ? 'gmControl'
    : selectedSection === 'gmControl'
      ? 'discover'
      : selectedSection ?? 'discover'
  const [selectedFrequency, setSelectedFrequency] = useState('')
  const [dismissedOnboardingOwnerKey, setDismissedOnboardingOwnerKey] = useState<string | null>(null)

  const onboardingDismissed = dismissedOnboardingOwnerKey === accountSessionKey
  const shouldShowOnboarding = !isGmSystemAccess
    && currentIdentity.status === 'needs-onboarding'
    && !onboardingDismissed

  const sections = isGmSystemAccess ? GM_SYSTEM_SECTIONS : SECTIONS

  const projection = browser.projection
  const frequencies = useMemo(() => {
    const values = new Set<string>()
    for (const node of projection?.nodes ?? []) {
      if (node.accessState !== 'visible') continue
      for (const frequency of node.frequencies) values.add(frequency)
    }
    return [...values].sort((left, right) => left.localeCompare(right))
  }, [projection])

  const effectiveSelectedFrequency = selectedFrequency
    && frequencies.includes(selectedFrequency)
    ? selectedFrequency
    : frequencies[0] ?? ''

  const visibleNodes = useMemo(() => {
    const nodes = projection?.nodes ?? []
    if (section === 'frequencies') {
      return nodes.filter((node) =>
        node.accessState === 'visible'
        && Boolean(effectiveSelectedFrequency)
        && node.frequencies.includes(effectiveSelectedFrequency))
    }
    if (section === 'saved') {
      return nodes.filter((node) => node.accessState === 'visible' && node.viewerSaved)
    }
    if (section === 'deadEchoes') {
      return nodes.filter((node) =>
        node.accessState === 'visible'
        && (node.kind === 'dead' || node.kind === 'corrupted'))
    }
    return nodes
  }, [effectiveSelectedFrequency, projection, section])

  const visibleNodeIds = useMemo(
    () => new Set(visibleNodes.map((node) => node.id)),
    [visibleNodes],
  )
  const visibleEdges = useMemo(
    () => (projection?.edges ?? []).filter((edge) =>
      visibleNodeIds.has(edge.fromSignalId) && visibleNodeIds.has(edge.toSignalId)),
    [projection, visibleNodeIds],
  )
  const nodesById = useMemo(
    () => new Map((projection?.nodes ?? []).map((node) => [node.id, node])),
    [projection],
  )
  const selectedNode = browser.selectedSignalId
    ? visibleNodes.find((node) => node.id === browser.selectedSignalId) ?? null
    : null
  const activeDetailState = browser.detailState.signalId === selectedNode?.id
    ? browser.detailState
    : {
        phase: 'idle' as const,
        detail: null,
        error: null,
      }

  const handleActivate = async (input: { readonly handle: string }): Promise<string | null> => {
    if (currentIdentity.status !== 'needs-onboarding') return null
    const accountIdResult = await onActivateAccount(input)
    if (accountIdResult) onNotice('ECHO // PRESENCE ACTIVE')
    return accountIdResult
  }

  if (shouldShowOnboarding) {
    return (
      <EchoOnboarding
        identity={currentIdentity.identity}
        accounts={accounts}
        onActivate={handleActivate}
        onCancel={() => setDismissedOnboardingOwnerKey(accountSessionKey)}
      />
    )
  }

  const hasConfirmedMap = Boolean(projection)
  const isRefreshing = hasConfirmedMap
    && (browser.mapPhase === 'refreshing' || browser.mapPhase === 'loading')
  const mapIsEmpty = projection?.nodes.length === 0
  const filterIsEmpty = Boolean(projection?.nodes.length) && visibleNodes.length === 0
  const filterEmptyTitle = section === 'saved'
    ? 'NO SAVED SIGNALS'
    : section === 'deadEchoes'
      ? 'NO DEAD SIGNALS DETECTED'
      : 'NO SIGNALS ON THIS FREQUENCY'
  const filterEmptyDetail = section === 'saved'
    ? 'Open a discovered signal and Save it to bind it to this ECHO account.'
    : section === 'deadEchoes'
      ? 'No represented dead or corrupted records are present on this grid.'
      : 'Choose another confirmed frequency to continue the sweep.'

  return (
    <div className="net-echo-app">
      <aside className="net-echo-sidebar" aria-label="ECHO navigation">
        {sections.map((entry) => {
          const Icon = entry.icon
          return (
            <button
              key={entry.id}
              type="button"
              data-active={section === entry.id ? 'true' : 'false'}
              onClick={() => {
                if (entry.id === 'profile' && currentIdentity.status === 'needs-onboarding') {
                  setDismissedOnboardingOwnerKey(null)
                }
                setSection(entry.id)
              }}
            >
              <Icon size={14} aria-hidden="true" />
              <span>{entry.label}</span>
            </button>
          )
        })}
      </aside>

      {section === 'gmControl' && isGmSystemAccess ? (
        <EchoGmControl
          enabled={isWindowOpen}
          onDirtyChange={() => undefined}
          onNotice={onNotice}
        />
      ) : section === 'profile' ? (
        currentIdentity.status === 'ready' ? (
          <div className="net-echo-profile">
            <div className="net-echo-profile__identity">
              <span className="net-echo-profile__avatar">
                {currentIdentity.identity.avatarUrl ? (
                  <SharedMediaImage
                    source={currentIdentity.identity.avatarUrl}
                    variant="thumbnail"
                    alt=""
                  />
                ) : initials(currentIdentity.identity.displayName)}
              </span>
              <div>
                <strong>{currentIdentity.identity.displayName}</strong>
                <span>{currentIdentity.identity.displayHandle} // ECHO PRESENCE</span>
              </div>
            </div>
            <dl className="net-echo-profile__facts">
              <div>
                <dt>Account status</dt>
                <dd>{currentIdentity.identity.accountStatus}</dd>
              </div>
              <div>
                <dt>Investigation state</dt>
                <dd>Character-bound</dd>
              </div>
              <div>
                <dt>Signal authority</dt>
                <dd>Server-backed</dd>
              </div>
            </dl>
            <p>
              Discoveries and saved signals belong only to this active ECHO account.
              ECHO carries no follower counts or public popularity profile.
            </p>
          </div>
        ) : (
          <EchoProfileUnavailable
            state={currentIdentity}
            onActivate={() => setDismissedOnboardingOwnerKey(null)}
          />
        )
      ) : (
        <>
          <div className="net-echo-map-wrap">
            <header className="net-echo-map-header">
              <h2>{SECTION_TITLES[section]}</h2>
              <span aria-live="polite">
                {hasConfirmedMap
                  ? `${visibleNodes.length} REPRESENTED // ${visibleEdges.length} LINKS${isRefreshing ? ' // SYNCING' : ''}`
                  : currentIdentity.status === 'ready' ? 'SYNCHRONIZING GRID' : 'PRESENCE REQUIRED'}
              </span>
            </header>

            {section === 'frequencies' && frequencies.length > 0 ? (
              <div className="net-echo-frequencies" role="tablist" aria-label="Frequencies">
                {frequencies.map((frequency) => (
                  <button
                    key={frequency}
                    type="button"
                    role="tab"
                    aria-selected={effectiveSelectedFrequency === frequency}
                    data-active={effectiveSelectedFrequency === frequency ? 'true' : 'false'}
                    onClick={() => setSelectedFrequency(frequency)}
                  >
                    {frequency}
                  </button>
                ))}
              </div>
            ) : null}

            {browser.mapError && hasConfirmedMap ? (
              <div className="net-echo-map-warning" role="status">
                <span>{browser.mapError}</span>
                <button type="button" onClick={browser.retryMap}>Retry</button>
              </div>
            ) : null}

            <div
              className="net-echo-map"
              aria-label="ECHO resonance map"
              aria-busy={browser.mapPhase === 'loading' || browser.mapPhase === 'refreshing'}
            >
              {currentIdentity.status !== 'ready' ? (
                <EchoMapState
                  title={currentIdentity.status === 'needs-onboarding'
                    ? 'ECHO PRESENCE REQUIRED'
                    : 'RESONANCE GRID UNAVAILABLE'}
                  detail={currentIdentity.status === 'needs-onboarding'
                    ? 'Activate the current character’s ECHO account to discover and save intelligence.'
                    : currentIdentity.message}
                  activate={currentIdentity.status === 'needs-onboarding'
                    ? () => setDismissedOnboardingOwnerKey(null)
                    : undefined}
                />
              ) : !hasConfirmedMap && browser.mapPhase !== 'failed' ? (
                <EchoMapState
                  title="SYNCING RESONANCE GRID"
                  detail="Requesting the bounded signal projection for this ECHO presence."
                />
              ) : !hasConfirmedMap && browser.mapPhase === 'failed' ? (
                <EchoMapState
                  title="GRID CONNECTION INTERRUPTED"
                  detail={browser.mapError ?? 'The resonance grid could not be synchronized.'}
                  retry={browser.retryMap}
                />
              ) : mapIsEmpty ? (
                <EchoMapState
                  title="NO RESONANCE DETECTED"
                  detail="The local grid contains no revealed signals. Await new transmissions."
                />
              ) : filterIsEmpty ? (
                <EchoMapState title={filterEmptyTitle} detail={filterEmptyDetail} />
              ) : (
                <>
                  <svg
                    className="net-echo-map__edges"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    {visibleEdges.map((edge) => {
                      const from = nodesById.get(edge.fromSignalId)
                      const to = nodesById.get(edge.toSignalId)
                      if (!from || !to) return null
                      return (
                        <line
                          key={`${edge.fromSignalId}:${edge.toSignalId}:${edge.relationshipKind}`}
                          x1={from.mapX}
                          y1={from.mapY}
                          x2={to.mapX}
                          y2={to.mapY}
                          data-kind={edge.relationshipKind}
                          vectorEffect="non-scaling-stroke"
                        />
                      )
                    })}
                  </svg>
                  {visibleNodes.map((node) => {
                    const style = {
                      left: `${node.mapX}%`,
                      top: `${node.mapY}%`,
                    } as CSSProperties
                    return (
                      <button
                        key={node.id}
                        type="button"
                        className="net-echo-node"
                        style={style}
                        data-intensity={node.accessState === 'visible' ? node.intensity : 'locked'}
                        data-type={node.kind}
                        data-access={node.accessState}
                        data-discovered={node.accessState === 'visible' && node.viewerDiscovered ? 'true' : 'false'}
                        data-saved={node.accessState === 'visible' && node.viewerSaved ? 'true' : 'false'}
                        data-selected={browser.selectedSignalId === node.id ? 'true' : 'false'}
                        onClick={() => { void browser.openSignal(node) }}
                        title={nodeDescription(node)}
                        aria-label={nodeDescription(node)}
                      >
                        <i aria-hidden="true" />
                        <small>{nodeTitle(node)}</small>
                      </button>
                    )
                  })}
                </>
              )}
            </div>
          </div>

          <EchoDetailPanel
            node={selectedNode}
            phase={activeDetailState.phase}
            detail={activeDetailState.detail}
            error={activeDetailState.error}
            isSaving={selectedNode ? browser.savingSignalIds.has(selectedNode.id) : false}
            onSave={() => {
              if (selectedNode) void browser.setSaved(selectedNode, activeDetailState.detail)
            }}
            onRetry={() => browser.retryDetail(selectedNode)}
          />
        </>
      )}

    </div>
  )
}
