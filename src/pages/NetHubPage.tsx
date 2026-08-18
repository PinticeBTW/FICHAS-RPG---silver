import {
  Activity,
  Bell,
  CircleUserRound,
  Grid2X2,
  Landmark,
  HeartPulse,
  LockKeyhole,
  Network,
  Newspaper,
  Radio,
  Search,
  Settings,
  ShieldCheck,
  WalletCards,
  Wifi,
} from 'lucide-react'

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type CSSProperties,
} from 'react'

import { useAuth } from '../hooks/useAuth'
import { useNetActiveIdentitySession } from '../components/net/identity/useNetActiveIdentitySession'
import type { NetActiveIdentityState } from '../components/net/identity/netActiveIdentity'
import { useNetGmPersona } from '../components/net/identity/useNetGmPersona'
import { useNetPlayableIdentityCandidates } from '../components/net/identity/useNetPlayableIdentityCandidates'
import { useNetCompromisedPulseSession } from '../components/net/useNetCompromisedPulseSession'
import { useNetUniversalProfile } from '../components/net/profile/useNetUniversalProfile'
import { useNetIdentitySystem } from '../components/net/system/useNetIdentitySystem'
import { useNetCompromisedIdentitySystem } from '../components/net/system/useNetCompromisedIdentitySystem'
import { useNetSystemHackingRuntime } from '../components/net/system/useNetSystemHackingRuntime'
import { NetGmSystemEnvironmentControl } from '../components/net/identity/NetGmSystemEnvironmentControl'
import { NetSystemHackingBanner } from '../components/net/identity/NetSystemHackingBanner'
import { applyUniversalNetProfilePresentation } from '../components/net/profile/netUniversalProfileResolver'
import { useNetServerAppAccounts } from '../components/net/accounts/useNetServerAppAccounts'
import { resolveNetAppAccount } from '../components/net/accounts/netAppAccountResolver'
import {
  getNetAppAccountOwnerForIdentity,
  getNetAppAccountOwnerKey,
} from '../components/net/accounts/netAppAccountSelectors'
import type { PulseProfileDraft } from '../components/net/pulseCurrentIdentity'

import { NetAppWindow } from '../components/net/NetAppWindow'
import { SharedMediaImage } from '../components/shared/SharedMediaImage'
import { NetLauncher, type NetLauncherApp } from '../components/net/NetLauncher'
import { PulseApp } from '../components/net/PulseApp'
import { VltApp } from '../components/net/VltApp'
import { VoxBankApp } from '../components/net/VoxBankApp'
import { ShneiderBankApp } from '../components/net/ShneiderBankApp'
import { NvnApp } from '../components/net/NvnApp'
import { NetStoreApp } from '../components/net/NetStoreApp'
import { VoxAudioApp } from '../components/net/VoxAudioApp'
import { VoxAudioAudioEngine } from '../components/net/VoxAudioAudioEngine'
import { useVoxAudioPlayer } from '../components/net/useVoxAudioPlayer'
import {
  getNetAppDefinition,
  isNetOptionalAppId,
  isNetRunnableAppId,
  netAppCatalog,
  resolveNetAppAccessMode,
  systemNetAppIds,
  type NetAppAccessMode,
  type NetAppDefinition,
  type NetAppId,
  type NetOptionalAppId,
} from '../components/net/netAppCatalog'
import {
  WallpaperSettings,
  type WallpaperApplyInput,
} from '../components/net/WallpaperSettings'
import {
  wallpaperPositionToCss,
} from '../lib/netWallpaperStore'
import type { NetResolvedOsSession } from '../lib/netOsService'
import {
  deleteNetWindowLayouts,
  loadNetWindowLayouts,
  saveNetWindowLayout,
  type NetWindowRect,
  type NetWindowSnap,
  type StoredNetWindowLayout,
  type StoredNetWindowLayouts,
} from '../lib/netWindowLayoutStore'
import {
  clampNetWindowRect,
  getMaximizedNetWindowRect,
  getNetDesktopBounds,
  getSnappedNetWindowRect,
  type NetDesktopBounds,
  type NetWindowConstraints,
} from '../components/net/netWindowGeometry'

import '../styles/net.css'

type NetWindowId = Exclude<NetAppId, 'loop'> | 'wallpaper'

type DefaultWindow = NetWindowConstraints & {
  width: number
  height: number
}

interface AppWindowState {
  open: boolean
  minimized: boolean
  maximized: boolean
  zIndex: number
  rect?: NetWindowRect
  restoreRect?: NetWindowRect
  snap: NetWindowSnap
}

const CLOSED_WINDOW: AppWindowState = {
  open: false,
  minimized: false,
  maximized: false,
  zIndex: 0,
  snap: 'none',
}

const WINDOW_BASE_Z_INDEX = 32

const WALLPAPER_WINDOW: DefaultWindow = {
  width: 620,
  height: 610,
  minWidth: 440,
  minHeight: 420,
}

const WINDOW_IDS: readonly NetWindowId[] = [
  'pulse',
  'vlt',
  'vox-bank',
  'shneider-bank',
  'nvn',
  'vox-audio',
  'net-store',
  'wallpaper',
]

function getDefaultWindow(id: NetWindowId): DefaultWindow {
  if (id === 'wallpaper') return WALLPAPER_WINDOW
  return getNetAppDefinition(id)?.defaultWindow ?? WALLPAPER_WINDOW
}

function createDefaultRect(id: NetWindowId, bounds: NetDesktopBounds): NetWindowRect {
  const defaults = getDefaultWindow(id)
  const cascade = Math.max(0, WINDOW_IDS.indexOf(id)) * 28
  const width = Math.min(defaults.width, bounds.width)
  const height = Math.min(defaults.height, bounds.height)

  return clampNetWindowRect(
    {
      x: bounds.left + 72 + cascade,
      y: bounds.top + 36 + cascade,
      width,
      height,
    },
    defaults,
    bounds,
  )
}

const liveEvents = [
  {
    source: 'PULSE',
    text: '#District04 entered the citywide trend grid.',
    time: '02M',
    accentRgb: '255, 78, 96',
  },

  {
    source: 'VEGA MESH',
    text: 'Secure district routing remains operational.',
    time: '11M',
    accentRgb: '201, 210, 223',
  },
]

function initials(value: string) {
  return (
    value
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'NV'
  )
}

export function NetHubPage({ osSession }: { readonly osSession: NetResolvedOsSession }) {
  const { profile, loading: authLoading } = useAuth()
  const playableIdentityCandidates = useNetPlayableIdentityCandidates(profile, authLoading)
  const gmPersona = useNetGmPersona(profile, authLoading, playableIdentityCandidates)
  const compromisedPulseSession = useNetCompromisedPulseSession(profile?.id, gmPersona)
  const activeIdentitySession = useNetActiveIdentitySession(
    profile,
    authLoading,
    playableIdentityCandidates,
  )
  const refreshActiveIdentity = activeIdentitySession.refresh
  const refreshGmPersona = gmPersona.refresh
  const handlePulseContextMismatch = useCallback(() => {
    void refreshActiveIdentity()
    void refreshGmPersona()
  }, [refreshActiveIdentity, refreshGmPersona])
  const baseActiveIdentity = activeIdentitySession.activeIdentity
  const serverControlledIdentityLinkId = osSession.controlMode === 'take-control'
    ? osSession.identityLinkId
    : undefined
  const isCompromisedSystemMount = gmPersona.state.status === 'compromised'
  const isControlledSystemMount = osSession.controlMode === 'take-control'
  const isGmSystemMount = profile?.role === 'gm' && osSession.controlMode === 'system'
  const hacking = useNetSystemHackingRuntime(profile?.id)
  // Full runtime-takeover parity: a player (never GM/TAKE CONTROL/GM
  // compromised-session -- those already have their own, higher-precedence
  // identity source) whose own hacking session is both active and
  // "entered" (ENTER SYSTEM clicked, not just credentialed) projects this
  // whole OS onto the hacking target, exactly like TAKE CONTROL already
  // projects it onto a GM's controlled identity.
  const hackingSession = hacking.session
  const hackedTarget = useMemo(
    () => !isGmSystemMount && !isControlledSystemMount && !isCompromisedSystemMount
      && hacking.mounted && hackingSession?.active
      ? { identityLinkId: hackingSession.targetIdentityLinkId, osId: hackingSession.targetOsId }
      : undefined,
    [hacking.mounted, hackingSession, isCompromisedSystemMount, isControlledSystemMount, isGmSystemMount],
  )
  const mountedSystemIdentityLinkId = isGmSystemMount
    ? undefined
    : isControlledSystemMount
    ? serverControlledIdentityLinkId
    : isCompromisedSystemMount
      ? gmPersona.state.identity.identityLinkId
      : hackedTarget
        ? hackedTarget.identityLinkId
        : activeIdentitySession.activeIdentityLink?.id
  const identitySystem = useNetIdentitySystem(
    isCompromisedSystemMount ? undefined : mountedSystemIdentityLinkId,
  )
  const gmTargetIdentitySystem = useNetCompromisedIdentitySystem(
    profile?.id,
    gmPersona,
    isCompromisedSystemMount ? mountedSystemIdentityLinkId : undefined,
  )
  const universalProfile = useNetUniversalProfile(
    baseActiveIdentity,
    activeIdentitySession.activeIdentityLink,
    activeIdentitySession.availablePlayableIdentities,
  )
  const activeIdentity = useMemo(
    () => applyUniversalNetProfilePresentation(baseActiveIdentity, universalProfile.state),
    [baseActiveIdentity, universalProfile.state],
  )
  const controlledIdentityMatchesSession = isControlledSystemMount
    && gmPersona.state.status === 'controlled'
    && gmPersona.state.identity.identityLinkId === serverControlledIdentityLinkId
  const isRemoteSystemMount = isCompromisedSystemMount || isControlledSystemMount || Boolean(hackedTarget)
  const runtimeSystemState = isCompromisedSystemMount
    ? gmTargetIdentitySystem.state
    : identitySystem.state
  const runtimeSystemIdentityName = isRemoteSystemMount
    ? hackedTarget && hacking.targetIdentity?.status === 'ready'
      ? hacking.targetIdentity.identity.displayName
      : gmPersona.state.status === 'controlled' || gmPersona.state.status === 'compromised'
        ? gmPersona.state.identity.displayName
        : undefined
    : activeIdentity.status === 'ready'
      ? activeIdentity.identity.displayName
      : undefined
  const controlledRuntimeIdentityLink = controlledIdentityMatchesSession
    ? gmPersona.identityLinks.find((link) => (
        link.id === serverControlledIdentityLinkId
        && (
          (link.identityKind === 'player' && link.playability === 'playable')
          || (link.identityKind === 'npc' && link.playability === 'non-playable')
        )
      ))
    : undefined
  const mountedRuntimeAppIdentity = useMemo<NetActiveIdentityState>(() => {
    if (isGmSystemMount) {
      return { status: 'gm-no-persona', authenticatedProfileId: profile?.id ?? '' }
    }
    if (hackedTarget) {
      if (hacking.targetIdentity?.status === 'ready') {
        return {
          status: 'ready',
          authenticatedProfileId: profile?.id ?? '',
          identity: hacking.targetIdentity.identity,
          source: 'explicit',
        }
      }
      if (hacking.targetIdentity?.status === 'error') {
        return { status: 'error', reason: hacking.targetIdentity.reason }
      }
      return { status: 'loading' }
    }
    if (!isControlledSystemMount) {
      if (
        osSession.actorMode === 'player'
        && activeIdentity.status === 'ready'
        && activeIdentity.identity.identityLinkId !== osSession.identityLinkId
      ) {
        return {
          status: 'error',
          reason: 'The mounted VEIL identity changed before its application context was confirmed.',
        }
      }
      return activeIdentity
    }

    if (gmPersona.state.status === 'loading' || runtimeSystemState.status === 'loading') {
      return { status: 'loading' }
    }
    if (
      !controlledIdentityMatchesSession
      || gmPersona.state.status !== 'controlled'
      || !controlledRuntimeIdentityLink
    ) {
      return {
        status: 'gm-no-persona',
        authenticatedProfileId: profile?.id ?? '',
      }
    }
    if (runtimeSystemState.status === 'error') {
      return { status: 'error', reason: runtimeSystemState.reason }
    }
    if (
      runtimeSystemState.status !== 'ready'
      || runtimeSystemState.system.identityLinkId !== controlledRuntimeIdentityLink.id
    ) {
      return {
        status: 'error',
        reason: 'The controlled VEIL application context could not be matched to the mounted system.',
      }
    }

    return {
      status: 'ready',
      authenticatedProfileId: gmPersona.state.authenticatedProfileId,
      identity: gmPersona.state.identity,
      source: 'explicit',
    }
  }, [
    activeIdentity,
    controlledIdentityMatchesSession,
    controlledRuntimeIdentityLink,
    gmPersona.state,
    hackedTarget,
    hacking.targetIdentity,
    isGmSystemMount,
    isControlledSystemMount,
    osSession.actorMode,
    osSession.identityLinkId,
    profile?.id,
    runtimeSystemState,
  ])
  const pulseActiveIdentity = useMemo<NetActiveIdentityState>(() => {
    if (
      isControlledSystemMount
      && mountedRuntimeAppIdentity.status === 'ready'
      && (
        runtimeSystemState.status !== 'ready'
        || !runtimeSystemState.system.installedOptionalAppIds.includes('pulse')
      )
    ) {
      return {
        status: 'gm-no-persona',
        authenticatedProfileId: profile?.id ?? '',
      }
    }
    return mountedRuntimeAppIdentity
  }, [isControlledSystemMount, mountedRuntimeAppIdentity, profile?.id, runtimeSystemState])
  const appAccountIdentityContext = useMemo(() => {
    if (
      mountedRuntimeAppIdentity.status !== 'ready'
      || !mountedRuntimeAppIdentity.identity.identityLinkId
    ) return undefined

    // Full-control parity for an active hacking session: the effective
    // financial/app-account identity becomes the hacking TARGET's, sourced
    // from the same server-confirmed resolution mountedRuntimeAppIdentity
    // already used (see hackedTarget above), never the source hacker's own
    // activeIdentitySession link.
    if (hackedTarget) {
      if (
        hacking.targetIdentity?.status !== 'ready'
        || hacking.targetIdentity.identity.identityLinkId !== mountedRuntimeAppIdentity.identity.identityLinkId
      ) return undefined

      return {
        identityLinkId: mountedRuntimeAppIdentity.identity.identityLinkId,
        ...(hacking.targetIdentity.identity.worldEntityId
          ? { entityId: hacking.targetIdentity.identity.worldEntityId }
          : {}),
      }
    }

    const exactLink = isControlledSystemMount
      ? controlledRuntimeIdentityLink
      : activeIdentitySession.activeIdentityLink
    if (!exactLink || exactLink.id !== mountedRuntimeAppIdentity.identity.identityLinkId) {
      return undefined
    }

    return {
      identityLinkId: exactLink.id,
      ...(exactLink.entityId ? { entityId: exactLink.entityId } : {}),
    }
  }, [
    activeIdentitySession.activeIdentityLink,
    controlledRuntimeIdentityLink,
    hackedTarget,
    hacking.targetIdentity,
    isControlledSystemMount,
    mountedRuntimeAppIdentity,
  ])
  const financeIdentityLinkId = appAccountIdentityContext?.identityLinkId
  const financeIdentitySessionKey = financeIdentityLinkId
    ? [
        profile?.id ?? 'anonymous',
        osSession.controlMode,
        financeIdentityLinkId,
        gmPersona.session?.sessionGeneration ?? 'none',
      ].join(':')
    : null
  const shellIdentityTelemetry = useMemo(() => {
    if (profile?.role === 'gm') {
      switch (gmPersona.state.status) {
        case 'inspect':
          return {
            label: 'MASTER CONTROL',
            value: `INSPECTING ${gmPersona.state.identity.displayName}`,
            ariaLabel: `GM system operator: inspecting ${gmPersona.state.identity.displayName}`,
          }
        case 'active':
          return {
            label: 'MASTER CONTROL',
            value: `LEGACY PERSONA ${gmPersona.state.identity.displayName}`,
            ariaLabel: `GM system operator: legacy presentation persona ${gmPersona.state.identity.displayName}; no operating-system routing override`,
          }
        case 'compromised':
          return {
            label: 'MASTER CONTROL',
            value: `COMPROMISED ${gmPersona.state.identity.displayName}`,
            ariaLabel: `GM system operator: compromised PULSE authority for ${gmPersona.state.identity.displayName}`,
          }
        case 'controlled':
          return gmPersona.state.identity.identityKind === 'npc'
            ? {
                label: 'ACTING AS',
                value: osSession.primaryOsId
                  ? gmPersona.state.identity.displayName
                  : `${gmPersona.state.identity.displayName} · NO NETWORK OS`,
                ariaLabel: osSession.primaryOsId
                  ? `GM system operator: acting as ${gmPersona.state.identity.displayName} in ${osSession.effectiveOsId.toUpperCase()} OS`
                  : `GM system operator: acting as ${gmPersona.state.identity.displayName}; this NPC has no network operating system`,
              }
            : {
                label: 'TAKE CONTROL',
                value: gmPersona.state.identity.displayName,
                ariaLabel: `GM system operator: controlling ${gmPersona.state.identity.displayName} in ${osSession.effectiveOsId.toUpperCase()} OS`,
              }
        case 'loading':
          return { label: 'MASTER CONTROL', value: 'RESOLVING', ariaLabel: 'GM system operator context is loading' }
        case 'error':
          return { label: 'MASTER CONTROL', value: 'PERSONA UNAVAILABLE', ariaLabel: 'GM persona context is unavailable; system authority remains separate' }
        case 'none':
          return { label: 'MASTER CONTROL', value: 'GM SYSTEM', ariaLabel: 'GM system operator; no persona selected' }
      }
    }

    switch (activeIdentity.status) {
      case 'ready':
        return {
          label: 'IDENTITY',
          value: activeIdentity.identity.displayName,
          ariaLabel: `Fictional identity: ${activeIdentity.identity.displayName}`,
        }
      case 'selection-required':
        return { label: 'IDENTITY', value: 'SELECT CHARACTER', ariaLabel: 'Character selection required' }
      case 'loading':
        return { label: 'IDENTITY', value: 'RESOLVING', ariaLabel: 'Fictional identity is loading' }
      default:
        return { label: 'IDENTITY', value: 'NOT LINKED', ariaLabel: 'Fictional identity not linked' }
    }
  }, [
    activeIdentity,
    gmPersona.state,
    osSession.effectiveOsId,
    osSession.primaryOsId,
    profile?.role,
  ])
  const serverAppAccounts = useNetServerAppAccounts(
    profile?.id,
    appAccountIdentityContext,
  )
  const accountResolverAccounts = useMemo(
    () => [...serverAppAccounts.accounts],
    [serverAppAccounts.accounts],
  )
  const pulseResolverAccounts = useMemo(() => {
    const identityLinkId = pulseActiveIdentity.status === 'ready'
      ? pulseActiveIdentity.identity.identityLinkId
      : undefined
    return accountResolverAccounts.filter((account) => (
      account.appId !== 'pulse'
      || (
        Boolean(identityLinkId)
        && account.owner.type === 'identity-link'
        && account.owner.identityLinkId === identityLinkId
      )
    ))
  }, [accountResolverAccounts, pulseActiveIdentity])
  const pulseAccountResolution = useMemo(
    () => resolveNetAppAccount({
      appId: 'pulse',
      ...(pulseActiveIdentity.status === 'ready'
        ? { identity: pulseActiveIdentity.identity }
        : {}),
      accounts: pulseResolverAccounts,
      loading: serverAppAccounts.loading,
      ...(serverAppAccounts.error ? { error: serverAppAccounts.error } : {}),
    }),
    [
      pulseActiveIdentity,
      pulseResolverAccounts,
      serverAppAccounts.error,
      serverAppAccounts.loading,
    ],
  )
  const pulseAccountSessionKey = pulseActiveIdentity.status === 'ready'
    ? getNetAppAccountOwnerKey(getNetAppAccountOwnerForIdentity(pulseActiveIdentity.identity))
    : null

  const [now, setNow] = useState(() => new Date())

  const [notice, setNotice] = useState(
    'SYSTEM READY // SELECT AN APPLICATION',
  )

  const mountedRef = useRef(true)

  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))
  const desktopBounds = useMemo(
    () => getNetDesktopBounds(viewport.width, viewport.height),
    [viewport.height, viewport.width],
  )
  const desktopBoundsRef = useRef(desktopBounds)
  const isMobileDesktop = viewport.width <= 760
  const [windows, setWindows] = useState<Partial<Record<NetWindowId, AppWindowState>>>({})
  const [installJob, setInstallJob] = useState<{
    appId: NetOptionalAppId
    progress: number
  } | null>(null)
  const savedLayoutsRef = useRef<StoredNetWindowLayouts>({})
  const layoutWriteRef = useRef<Promise<void>>(Promise.resolve())
  const layoutUserIdRef = useRef<string | null>(profile?.id ?? null)
  const installationIdentityLinkIdRef = useRef<string | null>(mountedSystemIdentityLinkId ?? null)
  const installTimerRef = useRef<number | null>(null)
  const [snapPreview, setSnapPreview] = useState<{
    id: NetWindowId
    snap: 'left' | 'right' | 'maximize'
  } | null>(null)
  const [isLauncherOpen, setIsLauncherOpen] = useState(false)
  const [recentAppIds, setRecentAppIds] = useState<
    Exclude<NetWindowId, 'wallpaper'>[]
  >([])
  const launcherButtonRef = useRef<HTMLButtonElement | null>(null)
  const zIndexCounterRef = useRef(0)

  desktopBoundsRef.current = desktopBounds
  layoutUserIdRef.current = profile?.id ?? null
  installationIdentityLinkIdRef.current = mountedSystemIdentityLinkId ?? null

  const installedOptionalAppIds = useMemo(
    () => runtimeSystemState.status === 'ready'
      ? runtimeSystemState.system.installedOptionalAppIds
      : [],
    [runtimeSystemState],
  )
  const installedAppIds = useMemo<NetAppId[]>(
    () => [...systemNetAppIds, ...installedOptionalAppIds],
    [installedOptionalAppIds],
  )
  const installedAppIdSet = useMemo(() => new Set(installedAppIds), [installedAppIds])
  const hasGmSystemAccess = isGmSystemMount && gmPersona.state.status === 'none'
  const shellAppAccessModes = useMemo(() => {
    const next = new Map<NetAppId, NetAppAccessMode>()
    for (const app of netAppCatalog) {
      if (!app.available) continue
      const accessMode = resolveNetAppAccessMode(
        app,
        installedAppIdSet.has(app.id),
        hasGmSystemAccess,
        'veil',
      )
      if (accessMode) next.set(app.id, accessMode)
    }
    return next
  }, [hasGmSystemAccess, installedAppIdSet])
  const shellAppIdSet = useMemo(
    () => new Set(shellAppAccessModes.keys()),
    [shellAppAccessModes],
  )
  const gmSystemAccessAppIds = useMemo(
    () => hasGmSystemAccess
      ? netAppCatalog
        .filter((app) => (
          app.available
          && app.gmSystemAccess
        ))
        .map((app) => app.id)
      : [],
    [hasGmSystemAccess],
  )
  const gmSystemAccessAppIdSet = useMemo(
    () => new Set(gmSystemAccessAppIds),
    [gmSystemAccessAppIds],
  )
  const shellApps = useMemo(
    () => netAppCatalog.filter((app) => shellAppIdSet.has(app.id) && app.available),
    [shellAppIdSet],
  )

  const voxAudioMode = shellAppAccessModes.get('vox-audio')
  const voxAudioAccessIdentityLinkId = voxAudioMode === 'player'
    ? appAccountIdentityContext?.identityLinkId
    : undefined
  const voxAudioSessionState = voxAudioMode === 'player'
    ? 'installed'
    : voxAudioMode === 'gm-system'
      ? 'gm-system'
      : 'uninstalled'
  const voxAudioIdentitySessionKey = voxAudioAccessIdentityLinkId
    ? [
        'vox-audio',
        voxAudioSessionState,
        profile?.id ?? 'anonymous',
        osSession.controlMode,
        voxAudioAccessIdentityLinkId,
        gmPersona.session?.sessionGeneration ?? 'none',
      ].join(':')
    : voxAudioMode === 'gm-system'
      ? [
          'vox-audio',
          voxAudioSessionState,
          profile?.id ?? 'anonymous',
          osSession.controlMode,
          gmPersona.session?.sessionGeneration ?? 'none',
        ].join(':')
      : `vox-audio:${voxAudioSessionState}:${profile?.id ?? 'anonymous'}:${osSession.controlMode}`
  const voxAudioPlayer = useVoxAudioPlayer(
    voxAudioIdentitySessionKey,
    voxAudioAccessIdentityLinkId,
  )

  const bumpZIndex = () => {
    zIndexCounterRef.current += 1
    return zIndexCounterRef.current
  }

  const getWindowState = (id: NetWindowId): AppWindowState =>
    windows[id] ?? CLOSED_WINDOW

  const getWindowRect = (id: NetWindowId, state = getWindowState(id)) => {
    if (isMobileDesktop) return getMaximizedNetWindowRect(desktopBounds)
    if (state.maximized) return getMaximizedNetWindowRect(desktopBounds)
    if (state.snap !== 'none') return getSnappedNetWindowRect(state.snap, desktopBounds)
    return clampNetWindowRect(
      state.rect ?? createDefaultRect(id, desktopBounds),
      getDefaultWindow(id),
      desktopBounds,
    )
  }

  const persistWindowLayout = useCallback((id: NetWindowId, state: AppWindowState) => {
    const userId = profile?.id
    const rect = state.rect

    if (!userId || !rect) return

    const layout: StoredNetWindowLayout = {
      rect,
      ...(state.restoreRect ? { restoreRect: state.restoreRect } : {}),
      snap: state.snap,
      maximized: state.maximized,
      updatedAt: Date.now(),
    }

    savedLayoutsRef.current = { ...savedLayoutsRef.current, [id]: layout }
    layoutWriteRef.current = layoutWriteRef.current
      .catch(() => undefined)
      .then(() => saveNetWindowLayout(userId, id, layout))
      .catch(() => {
        // Layout persistence is a local convenience; current geometry remains usable.
      })
  }, [profile?.id])

  const getRememberedWindowState = (id: NetWindowId): AppWindowState => {
    const stored = savedLayoutsRef.current[id]

    if (!stored) {
      return { ...CLOSED_WINDOW, rect: createDefaultRect(id, desktopBounds) }
    }

    const constraints = getDefaultWindow(id)
    const restoreRect = stored.restoreRect
      ? clampNetWindowRect(stored.restoreRect, constraints, desktopBounds)
      : undefined
    const rect = stored.maximized
      ? getMaximizedNetWindowRect(desktopBounds)
      : stored.snap !== 'none'
        ? getSnappedNetWindowRect(stored.snap, desktopBounds)
        : clampNetWindowRect(stored.rect, constraints, desktopBounds)

    return {
      ...CLOSED_WINDOW,
      rect,
      ...(restoreRect ? { restoreRect } : {}),
      snap: stored.snap,
      maximized: stored.maximized,
    }
  }

  const recordRecentApp = (id: NetWindowId) => {
    if (id === 'wallpaper') return
    setRecentAppIds((previous) => [
      id,
      ...previous.filter((candidate) => candidate !== id),
    ].slice(0, 5))
  }

  const openWindow = (id: NetWindowId) => {
    if (id !== 'wallpaper' && !shellAppIdSet.has(id)) {
      const app = getNetAppDefinition(id)
      setNotice(`${app?.name ?? id.toUpperCase()} // NOT INSTALLED`)
      return
    }

    recordRecentApp(id)
    setWindows((prev) => {
      const current = prev[id] ?? getRememberedWindowState(id)

      return {
        ...prev,
        [id]: { ...current, open: true, minimized: false, zIndex: bumpZIndex() },
      }
    })
  }

  const closeWindow = (id: NetWindowId) => {
    setSnapPreview((preview) => (preview?.id === id ? null : preview))
    setWindows((prev) => {
      const current = prev[id] ?? getRememberedWindowState(id)
      return { ...prev, [id]: { ...current, open: false, minimized: false } }
    })
  }

  const minimizeWindow = (id: NetWindowId) => {
    setWindows((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? CLOSED_WINDOW), minimized: true },
    }))
  }

  const toggleMaximizeWindow = (id: NetWindowId) => {
    const current = getWindowState(id)
    const constraints = getDefaultWindow(id)
    const next: AppWindowState = current.maximized
      ? {
          ...current,
          maximized: false,
          minimized: false,
          snap: 'none',
          rect: clampNetWindowRect(
            current.restoreRect ?? current.rect ?? createDefaultRect(id, desktopBounds),
            constraints,
            desktopBounds,
          ),
          restoreRect: undefined,
          zIndex: bumpZIndex(),
        }
      : {
          ...current,
          maximized: true,
          minimized: false,
          snap: 'none',
          rect: getMaximizedNetWindowRect(desktopBounds),
          restoreRect: clampNetWindowRect(
            current.snap !== 'none'
              ? current.restoreRect ?? current.rect ?? createDefaultRect(id, desktopBounds)
              : current.rect ?? createDefaultRect(id, desktopBounds),
            constraints,
            desktopBounds,
          ),
          zIndex: bumpZIndex(),
        }

    setWindows((prev) => ({ ...prev, [id]: { ...(prev[id] ?? next), ...next } }))
    persistWindowLayout(id, next)
  }

  const focusWindow = (id: NetWindowId) => {
    setWindows((prev) => {
      const current = prev[id] ?? CLOSED_WINDOW

      if (!current.open || current.minimized) {
        return prev
      }

      return { ...prev, [id]: { ...current, zIndex: bumpZIndex() } }
    })
  }

  const openWindowOrder = useMemo(
    () =>
      Object.entries(windows)
        .filter(([, state]) => state.open && !state.minimized)
        .sort((a, b) => a[1].zIndex - b[1].zIndex)
        .map(([id]) => id),
    [windows],
  )

  const focusedWindowId =
    openWindowOrder[openWindowOrder.length - 1] ?? null

  const getWindowZIndex = (id: NetWindowId) => {
    const rank = openWindowOrder.indexOf(id)

    return rank === -1 ? WINDOW_BASE_Z_INDEX : WINDOW_BASE_Z_INDEX + rank
  }

  const commitWindowRect = (id: NetWindowId, rect: NetWindowRect) => {
    const current = getWindowState(id)
    const next: AppWindowState = {
      ...current,
      rect: clampNetWindowRect(rect, getDefaultWindow(id), desktopBoundsRef.current),
      restoreRect: undefined,
      snap: 'none',
      maximized: false,
    }

    setWindows((prev) => ({ ...prev, [id]: { ...(prev[id] ?? next), ...next } }))
    persistWindowLayout(id, next)
  }

  const applyWindowSnap = (id: NetWindowId, snap: 'left' | 'right' | 'maximize') => {
    const current = getWindowState(id)
    const constraints = getDefaultWindow(id)
    const normalRect = clampNetWindowRect(
      current.snap !== 'none' || current.maximized
        ? current.restoreRect ?? current.rect ?? createDefaultRect(id, desktopBoundsRef.current)
        : current.rect ?? createDefaultRect(id, desktopBoundsRef.current),
      constraints,
      desktopBoundsRef.current,
    )
    const next: AppWindowState = snap === 'maximize'
      ? {
          ...current,
          maximized: true,
          minimized: false,
          snap: 'none',
          rect: getMaximizedNetWindowRect(desktopBoundsRef.current),
          restoreRect: normalRect,
          zIndex: bumpZIndex(),
        }
      : {
          ...current,
          maximized: false,
          minimized: false,
          snap,
          rect: getSnappedNetWindowRect(snap, desktopBoundsRef.current),
          restoreRect: normalRect,
          zIndex: bumpZIndex(),
        }

    setWindows((prev) => ({ ...prev, [id]: { ...(prev[id] ?? next), ...next } }))
    persistWindowLayout(id, next)
  }

  const prepareWindowDrag = (id: NetWindowId, pointerX: number, pointerY: number) => {
    const current = getWindowState(id)
    const visibleRect = getWindowRect(id, current)
    const normalRect = clampNetWindowRect(
      current.restoreRect ?? current.rect ?? createDefaultRect(id, desktopBoundsRef.current),
      getDefaultWindow(id),
      desktopBoundsRef.current,
    )
    const grabOffset = Math.min(
      normalRect.width - 72,
      Math.max(72, ((pointerX - visibleRect.x) / Math.max(visibleRect.width, 1)) * normalRect.width),
    )
    const restoredRect = clampNetWindowRect(
      {
        ...normalRect,
        x: pointerX - grabOffset,
        y: pointerY - 22,
      },
      getDefaultWindow(id),
      desktopBoundsRef.current,
    )
    const next: AppWindowState = {
      ...current,
      maximized: false,
      snap: 'none',
      rect: restoredRect,
      restoreRect: undefined,
      zIndex: bumpZIndex(),
    }

    setWindows((prev) => ({ ...prev, [id]: { ...(prev[id] ?? next), ...next } }))
    return restoredRect
  }

  const handleSnapPreview = (id: NetWindowId, preview: 'left' | 'right' | 'maximize' | null) => {
    setSnapPreview((current) => {
      if (!preview) return current?.id === id ? null : current
      if (current?.id === id && current.snap === preview) return current
      return { id, snap: preview }
    })
  }

  const resetWindowLayout = async () => {
    const userId = profile?.id
    if (!userId) return

    try {
      const deletion = layoutWriteRef.current
        .catch(() => undefined)
        .then(() => deleteNetWindowLayouts(userId))
      layoutWriteRef.current = deletion.catch(() => undefined)
      await deletion
      if (!mountedRef.current || layoutUserIdRef.current !== userId) return

      savedLayoutsRef.current = {}
      setWindows((prev) => {
        const next: Partial<Record<NetWindowId, AppWindowState>> = {}
        for (const id of WINDOW_IDS) {
          const current = prev[id]
          if (!current) continue
          next[id] = {
            ...current,
            maximized: false,
            snap: 'none',
            rect: createDefaultRect(id, desktopBoundsRef.current),
            restoreRect: undefined,
          }
        }
        return next
      })
      setNotice('WINDOW LAYOUT // RESTORED DEFAULT ARRANGEMENT')
    } catch {
      if (mountedRef.current && layoutUserIdRef.current === userId) {
        setNotice('WINDOW LAYOUT // FAILED TO RESET ON THIS DEVICE')
      }
    }
  }

  const getManagedWindowProps = (id: NetWindowId) => {
    const state = getWindowState(id)

    return {
      isOpen: id === 'wallpaper' || shellAppIdSet.has(id) ? state.open : false,
      isMinimized: state.minimized,
      isMaximized: state.maximized,
      isSnapped: state.snap !== 'none',
      isFocused: focusedWindowId === id,
      zIndex: getWindowZIndex(id),
      rect: getWindowRect(id, state),
      bounds: desktopBounds,
      constraints: getDefaultWindow(id),
      isMobile: isMobileDesktop,
      onClose: () => closeWindow(id),
      onMinimize: () => minimizeWindow(id),
      onToggleMaximize: () => toggleMaximizeWindow(id),
      onFocus: () => focusWindow(id),
      onPrepareDrag: (pointerX: number, pointerY: number) =>
        prepareWindowDrag(id, pointerX, pointerY),
      onRectCommit: (rect: NetWindowRect) => commitWindowRect(id, rect),
      onSnap: (snap: 'left' | 'right' | 'maximize') => applyWindowSnap(id, snap),
      onSnapPreviewChange: (preview: 'left' | 'right' | 'maximize' | null) =>
        handleSnapPreview(id, preview),
    }
  }

  useEffect(() => {
    const updateViewport = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight })
    }

    window.addEventListener('resize', updateViewport)
    return () => window.removeEventListener('resize', updateViewport)
  }, [])

  useEffect(() => {
    const userId = profile?.id ?? null
    let cancelled = false

    layoutUserIdRef.current = userId
    savedLayoutsRef.current = {}
    setWindows({})
    setSnapPreview(null)
    setRecentAppIds([])
    setIsLauncherOpen(false)

    if (!userId) {
      return () => {
        cancelled = true
      }
    }

    loadNetWindowLayouts(userId, WINDOW_IDS)
      .then((layouts) => {
        if (cancelled || !mountedRef.current || layoutUserIdRef.current !== userId) return
        savedLayoutsRef.current = layouts
      })
      .catch(() => {
        // Default placement remains available if IndexedDB is unavailable.
      })

    return () => {
      cancelled = true
    }
  }, [profile?.id])

  useEffect(() => {
    const identityLinkId = mountedSystemIdentityLinkId ?? null
    installationIdentityLinkIdRef.current = identityLinkId
    if (installTimerRef.current !== null) {
      window.clearInterval(installTimerRef.current)
      installTimerRef.current = null
    }
    setInstallJob(null)
    setRecentAppIds((previous) => {
      const next = previous.filter((id) =>
        systemNetAppIds.includes(id) || gmSystemAccessAppIdSet.has(id))
      return next.length === previous.length ? previous : next
    })
    setWindows((previous) => {
      let changed = false
      const next = { ...previous }
      for (const appId of ['pulse', 'nvn', 'vox-audio'] as const) {
        if (gmSystemAccessAppIdSet.has(appId)) continue
        const current = next[appId]
        if (!current?.open) continue
        next[appId] = { ...current, open: false, minimized: false }
        changed = true
      }
      return changed ? next : previous
    })
  }, [gmSystemAccessAppIdSet, mountedSystemIdentityLinkId])

  useEffect(() => {
    if (runtimeSystemState.status !== 'ready') return

    const installed = new Set<NetAppId>([
      ...systemNetAppIds,
      ...runtimeSystemState.system.installedOptionalAppIds,
    ])
    for (const appId of gmSystemAccessAppIds) installed.add(appId)
    setRecentAppIds((previous) => {
      const next = previous.filter((id) => installed.has(id))
      return next.length === previous.length ? previous : next
    })
    setWindows((previous) => {
      let changed = false
      const next = { ...previous }
      for (const appId of ['pulse', 'nvn', 'vox-audio'] as const) {
        const current = next[appId]
        if (!current?.open || installed.has(appId)) continue
        next[appId] = { ...current, open: false, minimized: false }
        changed = true
      }
      return changed ? next : previous
    })
  }, [gmSystemAccessAppIds, runtimeSystemState])

  useEffect(() => () => {
    if (installTimerRef.current !== null) {
      window.clearInterval(installTimerRef.current)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

  const openWallpaperSettings = () => {
    openWindow('wallpaper')
    setNotice('WALLPAPER SETTINGS // PERSONALIZATION PANEL OPENED')
  }

  const toggleLauncher = () => {
    setIsLauncherOpen((open) => !open)
  }

  const openLauncherSystemTool = (toolId: 'settings' | 'net-search') => {
    if (toolId === 'settings') {
      openWallpaperSettings()
      return
    }

    if (toolId === 'net-search') {
      setNotice('NET SEARCH // INDEXING MODULE COMING SOON')
      return
    }

  }

  const handleWallpaperApply = async (input: WallpaperApplyInput): Promise<void> => {
    if (isCompromisedSystemMount) {
      const error = new Error('Wallpaper changes are unavailable in a compromised session.')
      setNotice('WALLPAPER // COMPROMISED SESSION IS READ ONLY')
      throw error
    }
    if (identitySystem.state.status !== 'ready') {
      const error = new Error('Select an active character and wait for its system profile to synchronize.')
      setNotice('WALLPAPER // CHARACTER SYSTEM PROFILE UNAVAILABLE')
      throw error
    }

    try {
      const applied = input.kind === 'default'
        ? await identitySystem.clearWallpaper()
        : input.file
          ? await identitySystem.setWallpaper(input.file, input.fit, input.position)
          : await identitySystem.updateWallpaperPresentation(input.fit, input.position)

      if (!applied) throw new Error('The active character changed before the wallpaper was confirmed.')
      if (!mountedRef.current) return
      closeWindow('wallpaper')
      setNotice(input.kind === 'default'
        ? 'WALLPAPER // CHARACTER DEFAULT RESTORED'
        : 'WALLPAPER // CHARACTER SYSTEM PROFILE UPDATED')
    } catch (error) {
      if (mountedRef.current) setNotice('WALLPAPER // SERVER UPDATE FAILED')
      throw error
    }
  }

  const characterWallpaper = runtimeSystemState.status === 'ready'
    ? runtimeSystemState.system.wallpaper
    : null
  const hasCustomWallpaper = characterWallpaper !== null

  useEffect(() => {
    const oldTitle = document.title

    document.title = 'VEIL OS // NEW VEGA'

    const timer = window.setInterval(() => {
      setNow(new Date())
    }, 1000)

    return () => {
      document.title = oldTitle

      window.clearInterval(timer)
    }
  }, [])

  const displayName =
    profile?.displayName || 'OPERATIVE'

  // The OS taskbar chip and launcher pair displayName with the authenticated
  // account's own handle/avatar, so those stay on the real account. The
  // ACTIVE SESSION widget below is the exact spot the bug report identifies:
  // it must reflect the effective fictional identity (TAKE CONTROL/ACT AS),
  // never silently claim auth.uid() changed.
  const welcomeIdentityName =
    runtimeSystemIdentityName || profile?.displayName || 'OPERATIVE'

  const handle = profile?.handle
    ? profile.handle.startsWith('@')
      ? profile.handle
      : `@${profile.handle}`
    : '@secure-user'

  const time = useMemo(
    () =>
      now.toLocaleTimeString('pt-PT', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }),
    [now],
  )

  const date = useMemo(
    () =>
      now
        .toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
        })
        .toUpperCase(),
    [now],
  )

  const openApp = (app: NetAppDefinition) => {
    if (!app.available) {
      setNotice(`${app.name} // NOT YET AVAILABLE`)
      return
    }

    if (!shellAppIdSet.has(app.id)) {
      setNotice(`${app.name} // NOT INSTALLED`)
      return
    }

    if (!isNetRunnableAppId(app.id)) return

    openWindow(app.id)
    const accessMode = shellAppAccessModes.get(app.id)
    setNotice(
      accessMode === 'gm-system'
        ? app.gmSystemAccess?.onlineNotice ?? `${app.name} // GM SYSTEM ONLINE`
        : app.onlineNotice ?? `${app.name} // MODULE ONLINE`,
    )
  }

  const handleOpenAppById = (appId: string) => {
    const app = getNetAppDefinition(appId)
    if (!app) {
      setNotice(`${appId.toUpperCase()} // APPLICATION MODULE NOT INSTALLED YET`)
      return
    }
    openApp(app)
  }

  const toggleTaskbarApp = (app: NetAppDefinition) => {
    if (getWindowState(app.id as NetWindowId).open) {
      closeWindow(app.id as NetWindowId)
      return
    }
    openApp(app)
  }

  const handleActivatePulseAccount = useCallback(async (input: {
    readonly handle: string
    readonly profile: PulseProfileDraft
  }): Promise<string> => {
    if (
      isCompromisedSystemMount
      || pulseActiveIdentity.status !== 'ready'
      || pulseAccountResolution.status !== 'needs-onboarding'
      || pulseActiveIdentity.identity.identityLinkId !== appAccountIdentityContext?.identityLinkId
    ) {
      throw new Error('The active character is no longer ready to create a PULSE identity.')
    }

    const account = await serverAppAccounts.createPulseAccount({
      handle: input.handle,
      profile: {
        bio: input.profile.bio,
        visibility: input.profile.visibility,
        showDistrict: input.profile.showDistrict,
        discoverable: input.profile.discoverable,
        defaultFeed: input.profile.feedPreference,
      },
    })
    return account.id
  }, [
    appAccountIdentityContext?.identityLinkId,
    isCompromisedSystemMount,
    pulseAccountResolution.status,
    pulseActiveIdentity,
    serverAppAccounts,
  ])

  const handleInstallApp = (appId: NetOptionalAppId) => {
    if (isCompromisedSystemMount) {
      setNotice('NET STORE // COMPROMISED SESSION IS READ ONLY')
      return
    }
    const app = getNetAppDefinition(appId)
    const identityLinkId = identitySystem.state.status === 'ready'
      ? identitySystem.state.system.identityLinkId
      : null

    if (!app || !app.available || !isNetOptionalAppId(appId)) return
    if (!identityLinkId) {
      setNotice(identitySystem.state.status === 'loading'
        ? 'SYSTEM PROFILE // SYNCHRONIZATION IN PROGRESS'
        : 'SYSTEM PROFILE // ACTIVE CHARACTER REQUIRED')
      return
    }
    if (identitySystem.mutating) {
      setNotice('SYSTEM PROFILE // ANOTHER UPDATE IS IN PROGRESS')
      return
    }
    if (installedAppIdSet.has(appId)) {
      setNotice(`${app.name} // ALREADY INSTALLED`)
      return
    }
    if (installJob) {
      setNotice('SYSTEM INSTALLER // ANOTHER JOB IN PROGRESS')
      return
    }

    setNotice(`${app.name} // INSTALL STARTED`)
    setInstallJob({ appId, progress: 0 })
    const expectedIdentityLinkId = identityLinkId
    let progress = 0
    installTimerRef.current = window.setInterval(() => {
      if (!mountedRef.current || installationIdentityLinkIdRef.current !== expectedIdentityLinkId) {
        if (installTimerRef.current !== null) window.clearInterval(installTimerRef.current)
        installTimerRef.current = null
        return
      }

      progress = Math.min(100, progress + 10)
      setInstallJob((current) => current?.appId === appId ? { ...current, progress } : current)
      if (progress < 100) return

      if (installTimerRef.current !== null) window.clearInterval(installTimerRef.current)
      installTimerRef.current = null

      void identitySystem.setAppInstalled(appId, true)
        .then((installed) => {
          if (!mountedRef.current || installationIdentityLinkIdRef.current !== expectedIdentityLinkId) return
          setInstallJob(null)
          setNotice(installed
            ? `${app.name} // INSTALL COMPLETE`
            : `${app.name} // INSTALL NOT CONFIRMED`)
        })
        .catch(() => {
          if (!mountedRef.current || installationIdentityLinkIdRef.current !== expectedIdentityLinkId) return
          setInstallJob(null)
          setNotice(`${app.name} // SERVER INSTALL FAILED`)
        })
    }, 120)
  }

  const handleUninstallApp = async (appId: NetOptionalAppId) => {
    if (isCompromisedSystemMount) {
      setNotice('NET STORE // COMPROMISED SESSION IS READ ONLY')
      return
    }
    const app = getNetAppDefinition(appId)
    const identityLinkId = identitySystem.state.status === 'ready'
      ? identitySystem.state.system.identityLinkId
      : null
    if (!app || !isNetOptionalAppId(appId)) return
    if (!identityLinkId) {
      setNotice('SYSTEM PROFILE // ACTIVE CHARACTER REQUIRED')
      return
    }
    if (identitySystem.mutating) {
      setNotice('SYSTEM PROFILE // ANOTHER UPDATE IS IN PROGRESS')
      return
    }

    try {
      const removed = await identitySystem.setAppInstalled(appId, false)
      if (!removed) {
        if (mountedRef.current && installationIdentityLinkIdRef.current === identityLinkId) {
          setNotice(`${app.name} // REMOVAL NOT CONFIRMED`)
        }
        return
      }
      if (!mountedRef.current || installationIdentityLinkIdRef.current !== identityLinkId) return
      setRecentAppIds((previous) => previous.filter((id) => id !== appId))
      closeWindow(appId)
      setNotice(`${app.name} // REMOVED`)
    } catch {
      if (mountedRef.current && installationIdentityLinkIdRef.current === identityLinkId) {
        setNotice(`${app.name} // SERVER REMOVAL FAILED`)
      }
    }
  }

  const launcherApps: NetLauncherApp[] = shellApps.map((app) => {
    const state = getWindowState(app.id as NetWindowId)
    return {
      id: app.id,
      name: app.name,
      owner: app.owner,
      category: app.category,
      accentRgb: app.accentRgb,
      icon: app.icon,
      searchAliases: app.searchAliases,
      state: !state.open ? 'closed' : state.minimized ? 'minimized' : 'running',
    }
  })

  const openAppIds = shellApps
    .filter((app) => getWindowState(app.id as NetWindowId).open)
    .map((app) => app.id)

  const handleStoreUnavailable = (appId: NetAppId) => {
    const app = getNetAppDefinition(appId)
    if (!app) return
    setNotice(app.systemApp
      ? 'SYSTEM APPLICATION // CANNOT REMOVE'
      : `${app.name} // NOT YET AVAILABLE`)
  }

  const snapPreviewRect = useMemo(() => {
    if (!snapPreview) return null
    return snapPreview.snap === 'maximize'
      ? getMaximizedNetWindowRect(desktopBounds)
      : getSnappedNetWindowRect(snapPreview.snap, desktopBounds)
  }, [desktopBounds, snapPreview])

  return (
    <main className="net-os">
      {hackedTarget ? (
        <NetSystemHackingBanner
          targetDisplayName={hacking.targetIdentity?.status === 'ready'
            ? hacking.targetIdentity.identity.displayName
            : 'TARGET SYSTEM'}
          sourceDisplayName={activeIdentity.status === 'ready' ? activeIdentity.identity.displayName : 'OPERATIVE'}
          sourceOsId="veil"
          onDisconnect={() => { void hacking.disconnect() }}
          disconnecting={hacking.disconnecting}
          disconnectError={hacking.disconnectError}
        />
      ) : null}
      <VoxAudioAudioEngine {...voxAudioPlayer} />
      {/* WALLPAPER */}
      <div
        className="net-os__wallpaper"
        data-custom={hasCustomWallpaper ? 'true' : 'false'}
        aria-hidden="true"
      >
        {hasCustomWallpaper && characterWallpaper ? (
          <>
            <div
              className="net-os__custom-image"
              style={{
                backgroundImage: `url(${characterWallpaper.signedUrl})`,
                backgroundSize: characterWallpaper.fit,
                backgroundPosition: wallpaperPositionToCss(
                  characterWallpaper.position,
                ),
              }}
            />

            <div className="net-os__custom-overlay" />
          </>
        ) : (
          <>
            <div className="net-os__sun" />

            <div className="net-os__horizon" />

            <div className="net-os__city net-os__city--back" />

            <div className="net-os__city net-os__city--front" />
          </>
        )}

        <div className="net-os__grid" />

        <div className="net-os__grain" />
      </div>

      {/* TOP SYSTEM BAR */}
      <header className="net-osbar">
        <div className="net-osbar__brand">
          <div className="net-osbar__mark">
            <Network size={16} />
          </div>

          <div>
            <strong>VEIL OS</strong>

            <span>NEW VEGA CIVIC SYSTEM</span>
          </div>
        </div>

        <div className="net-osbar__center">
          <span>
            <i className="net-led" />

            MESH NODE ONLINE
          </span>

          <span>
            VEGA MESH // SECURE
          </span>

          <span>
            NV-01 // LOCAL GRID AUTHORITY
          </span>

          {isRemoteSystemMount && runtimeSystemState.status === 'loading' ? (
            <span className="net-osbar__system-sync" data-compromised="true" role="status">
              MOUNTING CONTROLLED SYSTEM
            </span>
          ) : runtimeSystemState.status === 'loading' ? (
            <span className="net-osbar__system-sync" role="status">
              SYNCING SYSTEM PROFILE
            </span>
          ) : runtimeSystemState.status === 'error' ? (
            <span className="net-osbar__system-sync" data-error="true" role="status">
              {isRemoteSystemMount ? 'CONTROLLED SYSTEM UNAVAILABLE' : 'SYSTEM PROFILE UNAVAILABLE'}
            </span>
          ) : null}
        </div>

        <div className="net-osbar__user">
          <Bell size={15} />

          <div
            className="net-osbar__identity-state"
            data-state={activeIdentity.status}
            aria-label={shellIdentityTelemetry.ariaLabel}
          >
            <strong>{shellIdentityTelemetry.label}</strong>
            <span>{shellIdentityTelemetry.value}</span>
          </div>

          <div className="net-osbar__identity">
            <strong>{displayName}</strong>

            <span>{handle}</span>
          </div>

          {profile?.avatarUrl ? (
            <SharedMediaImage
              source={profile.avatarUrl}
              variant="thumbnail"
              alt=""
              className="net-osbar__avatar"
            />
          ) : (
            <div className="net-osbar__avatar net-osbar__avatar--fallback">
              {initials(displayName)}
            </div>
          )}
        </div>
      </header>

      {/* DESKTOP */}
      <section
        className="net-desktop"
        aria-label="VEIL OS desktop"
      >
        {/* APP ICONS */}
        <div className="net-desktop__apps">
          <div className="net-desktop__section-label">
            CIVIC APPLICATIONS
          </div>

          <div className="net-desktop__app-grid">
            {shellApps.map((app) => {
              const Icon = app.icon
              const windowState = getWindowState(app.id as NetWindowId)
              const unreadBadge = app.unreadBadge

              const style = {
                '--app-rgb': app.accentRgb,
              } as CSSProperties

              return (
                <button
                  key={app.id}
                  type="button"
                  className="net-desktop-app"
                  data-featured={
                    app.featured
                      ? 'true'
                      : 'false'
                  }
                  data-running={
                    windowState.open
                      ? 'true'
                      : 'false'
                  }
                  style={style}
                  onClick={() =>
                    openApp(app)
                  }
                  title={`${app.name} — ${app.owner}`}
                >
                  <span className="net-desktop-app__icon">
                    <Icon
                      size={29}
                      strokeWidth={1.65}
                    />

                    {app.featured ? (
                      <i className="net-desktop-app__live" />
                    ) : null}

                    {!windowState.open &&
                    (unreadBadge ?? 0) > 0 ? (
                      <em className="net-desktop-app__badge">
                        {unreadBadge}
                      </em>
                    ) : null}
                  </span>

                  <span className="net-desktop-app__copy">
                    <strong>
                      {app.name}
                    </strong>

                    <small>
                      {app.category}
                    </small>
                  </span>
                </button>
              )
            })}
          </div>

          <div className="net-desktop__system-shortcuts">
            <button
              type="button"
              onClick={() =>
                setNotice(
                  'NET SEARCH // INDEXING MODULE COMING SOON',
                )
              }
            >
              <Search size={17} />

              <span>NET SEARCH</span>
            </button>

            <button
              type="button"
              onClick={openWallpaperSettings}
            >
              <Settings size={17} />

              <span>SETTINGS</span>
            </button>
          </div>
        </div>

        {/* WALLPAPER CENTER */}
        <div
          className="net-desktop__centerpiece"
          data-hidden={hasCustomWallpaper ? 'true' : 'false'}
          aria-hidden="true"
        >
          <div className="net-desktop__city-code">
            NEW VEGA
          </div>

          <div className="net-desktop__city-year">
            VEIL OS
          </div>

          <div className="net-desktop__coordinates">
            VEGA MESH // CIVIC NETWORK LAYER
          </div>
        </div>

        {/* WIDGETS */}
        <aside
          className="net-widgets"
          aria-label="System widgets"
        >
          <section className="net-widget net-widget--welcome">
            <div className="net-widget__eyebrow">
              <CircleUserRound size={14} />

              ACTIVE SESSION
            </div>

            <div className="net-widget__welcome-row">
              <div>
                <span>
                  WELCOME BACK
                </span>

                <strong>
                  {welcomeIdentityName}
                </strong>
              </div>

              <ShieldCheck size={28} />
            </div>

            <p>
              Local-grid access authenticated
              through VEGA MESH.
            </p>
          </section>

          {/* LIVE GRID */}
          <section className="net-widget net-widget--feed">
            <div className="net-widget__head">
              <span>
                <Radio size={14} />

                LIVE GRID
              </span>

              <b>02 EVENTS</b>
            </div>

            <div className="net-live-feed">
              {liveEvents.map(
                (event) => {
                  const style = {
                    '--event-rgb':
                      event.accentRgb,
                  } as CSSProperties

                  return (
                    <div
                      key={`${event.source}-${event.time}`}
                      style={style}
                    >
                      <i />

                      <p>
                        <strong>
                          {event.source}
                        </strong>

                        <span>
                          {event.text}
                        </span>
                      </p>

                      <time>
                        {event.time}
                      </time>
                    </div>
                  )
                },
              )}
            </div>
          </section>

          {/* VEGA MESH */}
          <section className="net-widget net-widget--mesh">
            <div className="net-mesh-brand">
              <LockKeyhole size={15} />

              <span>VEGA MESH</span>
            </div>

            <div className="net-mesh-stats">
              <div>
                <span>NODE</span>
                <strong>ONLINE</strong>
              </div>

              <div>
                <span>ROUTING</span>
                <strong>LOCAL</strong>
              </div>

              <div>
                <span>
                  ISOLATION
                </span>

                <strong>READY</strong>
              </div>
            </div>
          </section>
        </aside>
      </section>

      {/* SYSTEM MESSAGE */}
      <div
        className="net-os-toast"
        role="status"
      >
        <i />

        <span>{notice}</span>
      </div>

      {isLauncherOpen ? (
        <NetLauncher
          apps={launcherApps}
          recentAppIds={recentAppIds}
          user={{
            displayName,
            handle,
            avatarUrl: profile?.avatarUrl,
            initials: initials(displayName),
          }}
          launcherButtonRef={launcherButtonRef}
          onClose={() => setIsLauncherOpen(false)}
          onActivateApp={handleOpenAppById}
          onActivateSystem={openLauncherSystemTool}
        />
      ) : null}

      {/* TASKBAR */}
      <footer className="net-taskbar">
        <button
          ref={launcherButtonRef}
          type="button"
          className="net-taskbar__launcher"
          data-active={isLauncherOpen ? 'true' : 'false'}
          onClick={toggleLauncher}
          aria-label="Application launcher"
          aria-haspopup="dialog"
          aria-controls="net-launcher"
          aria-expanded={isLauncherOpen}
          title={isLauncherOpen ? 'Close application launcher' : 'Open application launcher'}
        >
          <Grid2X2 size={19} />
        </button>

        <div className="net-taskbar__apps">
          {shellApps
            .map((app) => {
              const Icon = app.icon
              const windowState = getWindowState(app.id as NetWindowId)
              const unreadBadge = app.unreadBadge

              const style = {
                '--app-rgb':
                  app.accentRgb,
              } as CSSProperties

              return (
                <button
                  key={app.id}
                  type="button"
                  className="net-taskbar-app"
                  data-featured={
                    app.featured
                      ? 'true'
                      : 'false'
                  }
                  data-running={
                    windowState.open
                      ? 'true'
                      : 'false'
                  }
                  style={style}
                  onClick={() =>
                    toggleTaskbarApp(app)
                  }
                  aria-label={`${windowState.open ? 'Close' : 'Open'} ${app.name}`}
                  title={app.name}
                >
                  <Icon size={18} />

                  {!windowState.open &&
                  (unreadBadge ?? 0) > 0 ? (
                    <em className="net-taskbar-app__badge">
                      {unreadBadge}
                    </em>
                  ) : null}
                </button>
              )
            })}

          <button
            type="button"
            className="net-taskbar-app net-taskbar-app--settings"
            data-running={
              getWindowState('wallpaper').open
                ? 'true'
                : 'false'
            }
            onClick={() => {
              if (getWindowState('wallpaper').open) {
                closeWindow('wallpaper')
                return
              }
              openWallpaperSettings()
            }}
            aria-label={`${getWindowState('wallpaper').open ? 'Close' : 'Open'} Settings`}
            title="Settings"
          >
            <Settings size={18} />
          </button>
        </div>

        <div className="net-taskbar__tray">
          <Wifi size={15} />

          <ShieldCheck size={15} />

          <div>
            <strong>{time}</strong>

            <span>{date}</span>
          </div>
        </div>
      </footer>

      {snapPreviewRect && !isMobileDesktop ? (
        <div
          className="net-window-snap-preview"
          aria-hidden="true"
          style={{
            left: `${snapPreviewRect.x}px`,
            top: `${snapPreviewRect.y}px`,
            width: `${snapPreviewRect.width}px`,
            height: `${snapPreviewRect.height}px`,
            zIndex: WINDOW_BASE_Z_INDEX + openWindowOrder.length + 1,
          }}
        />
      ) : null}

      {/* APPLICATION WINDOWS */}
      <NetAppWindow
        title="PULSE"
        subtitle="VOX NET // PUBLIC NETWORK"
        icon={Activity}
        accentRgb="255, 78, 96"
        {...getManagedWindowProps('pulse')}
      >
        <PulseApp
          onNotice={setNotice}
          activeIdentity={pulseActiveIdentity}
          accountResolution={pulseAccountResolution}
          accounts={pulseResolverAccounts}
          accountSessionKey={pulseAccountSessionKey}
          contentSessionKey={profile?.id ?? null}
          compromisedSession={compromisedPulseSession}
          onContextMismatch={handlePulseContextMismatch}
          onActivateAccount={handleActivatePulseAccount}
        />
      </NetAppWindow>

      <>
          <NetAppWindow
            title="VLT"
            subtitle="NEW VEGA NETWORK // PAYMENTS"
            icon={WalletCards}
            accentRgb="232, 198, 109"
            {...getManagedWindowProps('vlt')}
          >
            <VltApp
              key={financeIdentitySessionKey ?? 'no-finance-runtime'}
              accessMode={shellAppAccessModes.get('vlt') ?? 'player'}
              expectedIdentityLinkId={financeIdentityLinkId}
              identitySessionKey={financeIdentitySessionKey}
              isWindowOpen={shellAppIdSet.has('vlt') && getWindowState('vlt').open}
              onNotice={setNotice}
            />
          </NetAppWindow>

          <NetAppWindow
            title="VOX BANK"
            subtitle="VOX NET // DIGITAL BANKING"
            icon={Landmark}
            accentRgb="105, 198, 220"
            {...getManagedWindowProps('vox-bank')}
          >
            <VoxBankApp
              key={financeIdentitySessionKey ?? 'no-finance-runtime'}
              expectedIdentityLinkId={financeIdentityLinkId}
              identitySessionKey={financeIdentitySessionKey}
              isWindowOpen={shellAppIdSet.has('vox-bank') && getWindowState('vox-bank').open}
              onNotice={setNotice}
            />
          </NetAppWindow>

          <NetAppWindow
            title="SHNEIDER BANK"
            subtitle="SHNEIDER // PRIVATE HEALTH BANKING"
            icon={HeartPulse}
            accentRgb="167, 32, 46"
            {...getManagedWindowProps('shneider-bank')}
          >
            <ShneiderBankApp
              key={financeIdentitySessionKey ?? 'no-finance-runtime'}
              expectedIdentityLinkId={financeIdentityLinkId}
              identitySessionKey={financeIdentitySessionKey}
              isWindowOpen={shellAppIdSet.has('shneider-bank') && getWindowState('shneider-bank').open}
              onNotice={setNotice}
            />
          </NetAppWindow>
      </>

      <NetAppWindow
        title="NVN"
        subtitle="NVN // INDEPENDENT NETWORK"
        icon={Newspaper}
        accentRgb="80, 220, 175"
        {...getManagedWindowProps('nvn')}
      >
        <NvnApp
          key={`nvn:${osSession.controlMode}:${appAccountIdentityContext?.identityLinkId ?? 'gm-system'}:${gmPersona.session?.sessionGeneration ?? 'none'}`}
          accessMode={shellAppAccessModes.get('nvn') ?? 'player'}
          isWindowOpen={shellAppIdSet.has('nvn') && getWindowState('nvn').open}
          expectedIdentityLinkId={appAccountIdentityContext?.identityLinkId}
          identitySessionKey={`${profile?.id ?? 'anonymous'}:${appAccountIdentityContext?.identityLinkId ?? 'gm-system'}:${gmPersona.session?.sessionGeneration ?? 'none'}`}
          onNotice={setNotice}
          onOpenApp={handleOpenAppById}
        />
      </NetAppWindow>

      <NetAppWindow
        title="VOX AUDIO"
        subtitle="VOX NET // NEW VEGA AUDIO"
        icon={getNetAppDefinition('vox-audio')!.icon}
        accentRgb="180, 128, 96"
        {...getManagedWindowProps('vox-audio')}
      >
        <VoxAudioApp
          key={`vox-audio:${voxAudioIdentitySessionKey}:${voxAudioMode ?? 'disabled'}`}
          mode={voxAudioMode === 'gm-system' ? 'studio' : 'reader'}
          enabled={Boolean(voxAudioMode && getWindowState('vox-audio').open)}
          expectedIdentityLinkId={voxAudioAccessIdentityLinkId}
          identityName={
            voxAudioMode === 'gm-system'
              ? 'GM SYSTEM'
              : mountedRuntimeAppIdentity.status === 'ready'
                ? mountedRuntimeAppIdentity.identity.displayName
                : 'VOX AUDIO LISTENER'
          }
          player={voxAudioPlayer}
          onNotice={setNotice}
        />
      </NetAppWindow>

      <NetAppWindow
        title="NET STORE"
        subtitle="VEGA MESH // SOFTWARE CATALOGUE"
        icon={getNetAppDefinition('net-store')!.icon}
        accentRgb="243, 230, 0"
        {...getManagedWindowProps('net-store')}
      >
        <NetStoreApp
          osId="veil"
          installedAppIds={installedAppIds}
          openAppIds={openAppIds}
          installJob={installJob}
          onOpenApp={handleOpenAppById}
          onInstallApp={handleInstallApp}
          onUninstallApp={handleUninstallApp}
          onUnavailable={handleStoreUnavailable}
          gmSystemAccessAppIds={gmSystemAccessAppIds}
          readOnly={isCompromisedSystemMount}
        />
      </NetAppWindow>

      <NetAppWindow
        title="Settings"
        subtitle="SYSTEM // IDENTITY & PERSONALIZATION"
        icon={Settings}
        accentRgb="227, 193, 96"
        {...getManagedWindowProps('wallpaper')}
      >
        <WallpaperSettings
          current={{
            url: characterWallpaper?.signedUrl ?? null,
            fit: characterWallpaper?.fit ?? 'cover',
            position: characterWallpaper?.position ?? 'center',
          }}
          onApply={handleWallpaperApply}
          onCancel={() => closeWindow('wallpaper')}
          onResetWindowLayout={resetWindowLayout}
          activeIdentity={baseActiveIdentity}
          identityCandidates={playableIdentityCandidates}
          activeIdentitySession={activeIdentitySession}
          gmPersona={gmPersona}
          gmSystemEnvironmentControl={profile?.role === 'gm' ? (
            <NetGmSystemEnvironmentControl
              profileId={profile.id}
              effectiveOsId={osSession.effectiveOsId}
              controlPrimaryOsId={osSession.controlMode === 'take-control' ? osSession.primaryOsId : undefined}
              controller={gmPersona}
            />
          ) : undefined}
          accountProfile={profile}
          universalProfile={universalProfile}
          systemContext={{
            identityLinkId: mountedSystemIdentityLinkId,
            profileId: profile?.id,
            identityName: runtimeSystemIdentityName,
            status: runtimeSystemState.status,
            saving: isCompromisedSystemMount ? false : identitySystem.mutating,
            error: runtimeSystemState.status === 'error'
              ? runtimeSystemState.reason
              : undefined,
            readOnly: isCompromisedSystemMount,
          }}
        />
      </NetAppWindow>
    </main>
  )
}
