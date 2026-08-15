import {
  ArrowLeft,
  ChevronUp,
  CircleUserRound,
  Globe2,
  LayoutGrid,
  RefreshCw,
  ShieldCheck,
  Wifi,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '../../hooks/useAuth'
import type { NetResolvedOsSession } from '../../lib/netOsService'
import { ALTARA_NEWS_PRODUCT_NAME } from '../../lib/netAltaraNewsTypes'
import { wallpaperPositionToCss } from '../../lib/netWallpaperStore'
import { NetAppWindow } from './NetAppWindow'
import { AltaraSettingsApp } from './altara/AltaraAppSurfaces'
import { AltaraBankApp, type AltaraBankMode } from './altara/AltaraBankApp'
import { AltaraStoreApp } from './altara/AltaraStoreApp'
import { AltaraMessengerApp } from './altara/AltaraMessengerApp'
import { AltaraNewsApp, type AltaraNewsMode } from './altara/AltaraNewsApp'
import {
  altaraAppCatalog,
  getAltaraAppDefinition,
  type AltaraAppDefinition,
  type AltaraAppId,
} from './altara/altaraAppCatalog'
import {
  altaraWallpaperPresetToTheme,
  isAltaraWallpaperPresetId,
} from './altara/altaraWallpaperPresets'
import { useAltaraWindowManager } from './altara/useAltaraWindowManager'
import { NetGmSystemEnvironmentControl } from './identity/NetGmSystemEnvironmentControl'
import { useNetActiveIdentitySession } from './identity/useNetActiveIdentitySession'
import { useNetGmPersona } from './identity/useNetGmPersona'
import { useNetPlayableIdentityCandidates } from './identity/useNetPlayableIdentityCandidates'
import { useNetIdentitySystem } from './system/useNetIdentitySystem'

import '../../styles/altaraOs.css'

function initials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'AO'
}

function AltaraDesktopShortcut({
  app,
  running,
  disabled,
  onOpen,
}: {
  readonly app: AltaraAppDefinition
  readonly running: boolean
  readonly disabled: boolean
  readonly onOpen: () => void
}) {
  const Icon = app.icon
  return (
    <button
      type="button"
      className="altara-desktop-app"
      style={{ '--app-rgb': app.accentRgb } as CSSProperties}
      data-running={running ? 'true' : 'false'}
      disabled={disabled}
      onClick={onOpen}
      aria-label={`Open ${app.name}${app.status === 'placeholder' ? ', coming next' : ''}${running ? ', running' : ''}`}
    >
      <span className="altara-desktop-app__icon"><Icon size={25} strokeWidth={1.5} aria-hidden="true" /></span>
      <span className="altara-desktop-app__copy">
        <strong>{app.name}</strong>
        <small>{app.status === 'placeholder' ? 'COMING NEXT' : app.category}</small>
      </span>
      {running ? <i aria-hidden="true" /> : null}
    </button>
  )
}

function AltaraLauncher({
  apps,
  identityName,
  launcherRef,
  onOpen,
  onChangeIdentity,
  onRequestClose,
}: {
  readonly apps: readonly AltaraAppDefinition[]
  readonly identityName: string
  readonly launcherRef: RefObject<HTMLElement | null>
  readonly onOpen: (id: AltaraAppId) => void
  readonly onChangeIdentity: () => void
  readonly onRequestClose: () => void
}) {
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onRequestClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')]
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable.at(-1)
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <section
      ref={launcherRef}
      id="altara-launcher"
      className="altara-launcher"
      role="dialog"
      aria-modal="false"
      aria-label="ALTARA applications"
      onKeyDown={handleKeyDown}
    >
      <header>
        <div className="altara-launcher__brand"><Globe2 size={17} aria-hidden="true" /><span>ALTARA OS</span></div>
        <span>APPLICATIONS</span>
      </header>
      <div className="altara-launcher__apps">
        {apps.map((app) => {
          const Icon = app.icon
          return (
            <button
              key={app.id}
              type="button"
              style={{ '--app-rgb': app.accentRgb } as CSSProperties}
              onClick={() => onOpen(app.id)}
            >
              <span><Icon size={18} strokeWidth={1.6} aria-hidden="true" /></span>
              <span><strong>{app.name}</strong><small>{app.subtitle}</small></span>
              {app.status === 'placeholder' ? <i>COMING NEXT</i> : <ChevronUp size={14} aria-hidden="true" />}
            </button>
          )
        })}
      </div>
      <footer>
        <button type="button" onClick={onChangeIdentity}>
          <CircleUserRound size={15} aria-hidden="true" />
          <span><small>ACTIVE IDENTITY</small><strong>{identityName}</strong></span>
        </button>
        <Link to="/app/sheets"><ArrowLeft size={14} aria-hidden="true" /> SHEETS</Link>
      </footer>
    </section>
  )
}

export function AltaraOsGateway({
  osSession,
  resolvedIdentityLinkId,
  onChangeIdentity,
}: {
  readonly osSession: NetResolvedOsSession
  readonly resolvedIdentityLinkId?: string
  readonly onChangeIdentity: () => void
}) {
  const { profile, loading: authLoading } = useAuth()
  const candidates = useNetPlayableIdentityCandidates(profile, authLoading)
  const gmPersona = useNetGmPersona(profile, authLoading, candidates)
  const activeIdentitySession = useNetActiveIdentitySession(profile, authLoading, candidates)
  const activeIdentity = activeIdentitySession.activeIdentity
  const playerIdentityLinkMatches = activeIdentity.status === 'ready'
    && activeIdentity.identity.identityLinkId === resolvedIdentityLinkId
  const controlledIdentityLinkMatches = gmPersona.state.status === 'controlled'
    && gmPersona.state.identity.identityLinkId === resolvedIdentityLinkId
  const gmSystemMode = osSession.actorMode === 'gm-system'
    && osSession.controlMode === 'system'
    && gmPersona.state.status === 'none'
  const takeControlMode = osSession.actorMode === 'gm-system' && osSession.controlMode === 'take-control'
  const controlledNpcMode = takeControlMode
    && gmPersona.state.status === 'controlled'
    && gmPersona.state.identity.identityKind === 'npc'
  const shellReady = gmSystemMode
    || (takeControlMode
      ? Boolean(resolvedIdentityLinkId) && controlledIdentityLinkMatches
      : playerIdentityLinkMatches)
  const identityName = takeControlMode && controlledIdentityLinkMatches
    ? gmPersona.state.status === 'controlled' ? gmPersona.state.identity.displayName : 'CONTROLLED IDENTITY'
    : gmSystemMode
      ? 'GM SYSTEM'
      : playerIdentityLinkMatches && activeIdentity.status === 'ready'
        ? activeIdentity.identity.displayName
        : 'ALTARA IDENTITY'
  const playerSystemIdentityLinkId = playerIdentityLinkMatches ? resolvedIdentityLinkId : undefined
  const systemIdentityLinkId = takeControlMode
    ? resolvedIdentityLinkId
    : playerSystemIdentityLinkId
  const identitySystem = useNetIdentitySystem(gmSystemMode ? undefined : systemIdentityLinkId)
  const runtimeSystemState = identitySystem.state
  const messengerIdentityLinkId = gmSystemMode || !shellReady
    ? undefined
    : resolvedIdentityLinkId
  const runtimeMutationsAllowed = !gmSystemMode && shellReady && Boolean(systemIdentityLinkId)
  const [now, setNow] = useState(() => new Date())
  const [launcherOpen, setLauncherOpen] = useState(false)
  const [notice, setNotice] = useState('ALTARA NETWORK // DESKTOP READY')
  const launcherRef = useRef<HTMLElement | null>(null)
  const launcherButtonRef = useRef<HTMLButtonElement | null>(null)
  const windowManager = useAltaraWindowManager()
  const closeWindow = windowManager.closeWindow

  const installedAltaraBank = runtimeSystemState.status === 'ready'
    && runtimeSystemState.system.installedOptionalAppIds.includes('altara-bank')
  const installedAltaraNews = runtimeSystemState.status === 'ready'
    && runtimeSystemState.system.installedOptionalAppIds.includes('altara-news')
  const altaraBankMode: AltaraBankMode = gmSystemMode
    ? 'gm-admin'
    : 'personal'
  const altaraBankAvailable = gmSystemMode || installedAltaraBank
  const altaraNewsMode: AltaraNewsMode = gmSystemMode ? 'newsroom' : 'reader'
  const altaraNewsAvailable = gmSystemMode || installedAltaraNews
  const altaraBankContextKey = [
    profile?.id ?? 'anonymous',
    osSession.actorMode,
    osSession.controlMode,
    resolvedIdentityLinkId ?? 'system',
    gmPersona.session?.sessionGeneration ?? 'none',
  ].join(':')
  const availableApps = useMemo(() => altaraAppCatalog.filter(
    (app) => app.systemApp
      || (app.id === 'altara-bank' && altaraBankAvailable)
      || (app.id === 'altara-news' && altaraNewsAvailable),
  ), [altaraBankAvailable, altaraNewsAvailable])
  const availableAppIdSet = useMemo(
    () => new Set<AltaraAppId>(availableApps.map((app) => app.id)),
    [availableApps],
  )

  const openWindow = useCallback((id: AltaraAppId) => {
    if (!shellReady) {
      setNotice('ALTARA NETWORK // SYSTEM ENVIRONMENT IS STILL RESOLVING')
      return
    }
    if (!availableAppIdSet.has(id)) {
      setNotice(`${getAltaraAppDefinition(id).name} // INSTALL FROM ALTARA STORE`)
      return
    }
    windowManager.openWindow(id)
    setLauncherOpen(false)
    const app = getAltaraAppDefinition(id)
    setNotice(app.status === 'placeholder'
      ? `${app.name} // PRODUCT SHELL AVAILABLE`
      : `${app.name} // ONLINE`)
  }, [availableAppIdSet, shellReady, windowManager])

  const handleIdentityAction = useCallback(() => {
    if (profile?.role === 'gm') {
      openWindow('altara-settings')
      return
    }
    onChangeIdentity()
  }, [onChangeIdentity, openWindow, profile?.role])

  const openWindowFromLauncher = useCallback((id: AltaraAppId) => {
    openWindow(id)
    window.requestAnimationFrame(() => launcherButtonRef.current?.focus())
  }, [openWindow])

  useEffect(() => {
    if (!altaraBankAvailable) closeWindow('altara-bank')
  }, [altaraBankAvailable, closeWindow])

  useEffect(() => {
    if (!altaraNewsAvailable) closeWindow('altara-news')
  }, [altaraNewsAvailable, closeWindow])

  useEffect(() => {
    const previousTitle = document.title
    document.title = 'ALTARA OS // ALTARA NETWORK'
    return () => { document.title = previousTitle }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!launcherOpen) return undefined
    const frame = window.requestAnimationFrame(() => {
      launcherRef.current?.querySelector<HTMLElement>('button:not(:disabled), a[href]')?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [launcherOpen])

  useEffect(() => {
    const closeLauncher = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !launcherOpen) return
      event.preventDefault()
      setLauncherOpen(false)
      launcherButtonRef.current?.focus()
    }
    window.addEventListener('keydown', closeLauncher)
    return () => window.removeEventListener('keydown', closeLauncher)
  }, [launcherOpen])

  const installAltaraBank = async () => {
    if (!runtimeMutationsAllowed) {
      throw new Error('A controlled ALTARA runtime identity is required for installation changes.')
    }
    if (identitySystem.state.status !== 'ready') {
      throw new Error('The active identity system profile is not ready.')
    }
    const installed = await identitySystem.setAppInstalled('altara-bank', true)
    if (!installed) throw new Error('The installation was not confirmed.')
    setNotice('ALTARA BANK // INSTALL COMPLETE')
  }

  const uninstallAltaraBank = async () => {
    if (!runtimeMutationsAllowed) {
      throw new Error('A controlled ALTARA runtime identity is required for installation changes.')
    }
    if (identitySystem.state.status !== 'ready') {
      throw new Error('The active identity system profile is not ready.')
    }
    const removed = await identitySystem.setAppInstalled('altara-bank', false)
    if (!removed) throw new Error('The removal was not confirmed.')
    closeWindow('altara-bank')
    setNotice('ALTARA BANK // REMOVED')
  }

  const installAltaraNews = async () => {
    if (!runtimeMutationsAllowed) {
      throw new Error('A controlled ALTARA runtime identity is required for installation changes.')
    }
    if (identitySystem.state.status !== 'ready') {
      throw new Error('The active identity system profile is not ready.')
    }
    const installed = await identitySystem.setAppInstalled('altara-news', true)
    if (!installed) throw new Error('The installation was not confirmed.')
    setNotice('NEWS // INSTALL COMPLETE')
  }

  const uninstallAltaraNews = async () => {
    if (!runtimeMutationsAllowed) {
      throw new Error('A controlled ALTARA runtime identity is required for installation changes.')
    }
    if (identitySystem.state.status !== 'ready') {
      throw new Error('The active identity system profile is not ready.')
    }
    const removed = await identitySystem.setAppInstalled('altara-news', false)
    if (!removed) throw new Error('The removal was not confirmed.')
    closeWindow('altara-news')
    setNotice('NEWS // REMOVED')
  }

  const uploadWallpaper: Parameters<typeof AltaraSettingsApp>[0]['onUpload'] = async (file, fit, position) => {
    if (!runtimeMutationsAllowed) throw new Error('A controlled ALTARA runtime identity is required.')
    const saved = await identitySystem.setWallpaper(file, fit, position)
    if (!saved) throw new Error('The wallpaper upload was not confirmed.')
    setNotice('SETTINGS // CUSTOM WALLPAPER SAVED')
  }

  const updateWallpaperPresentation: Parameters<typeof AltaraSettingsApp>[0]['onUpdatePresentation'] = async (fit, position) => {
    if (!runtimeMutationsAllowed) throw new Error('A controlled ALTARA runtime identity is required.')
    const saved = await identitySystem.updateWallpaperPresentation(fit, position)
    if (!saved) throw new Error('The wallpaper presentation was not confirmed.')
    setNotice('SETTINGS // WALLPAPER PRESENTATION SAVED')
  }

  const systemSnapshot = runtimeSystemState.status === 'ready'
    ? runtimeSystemState.system
    : null
  const wallpaperPreset = isAltaraWallpaperPresetId(systemSnapshot?.wallpaperPresetId)
    ? systemSnapshot.wallpaperPresetId
    : 'altara-nocturne'
  const customWallpaper = systemSnapshot?.wallpaper ?? null
  const wallpaperTheme = altaraWallpaperPresetToTheme(wallpaperPreset)
  const clock = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const date = now.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' })
  const runningApps = useMemo(() => availableApps.filter(
    (app) => windowManager.windows[app.id]?.open,
  ), [availableApps, windowManager.windows])
  const dockApps = useMemo(() => {
    const byId = new Map<AltaraAppId, AltaraAppDefinition>()
    for (const app of availableApps) {
      if (app.pinned || windowManager.windows[app.id]?.open) byId.set(app.id, app)
    }
    return [...byId.values()]
  }, [availableApps, windowManager.windows])
  const identityFailure = !shellReady
    && gmPersona.state.status !== 'loading'
    && activeIdentity.status !== 'loading'
    ? takeControlMode
      ? gmPersona.state.status === 'error'
        ? gmPersona.state.reason
        : 'The controlled identity no longer matches this authoritative ALTARA session.'
      : activeIdentity.status === 'error' || activeIdentity.status === 'no-identity'
        ? activeIdentity.reason
        : 'The selected identity no longer matches this authoritative ALTARA session.'
    : null

  return (
    <main
      className="altara-os"
      data-wallpaper={wallpaperTheme}
      data-custom-wallpaper={customWallpaper ? 'true' : 'false'}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setLauncherOpen(false)
      }}
    >
      <div className="altara-os__wallpaper" aria-hidden="true">
        {customWallpaper ? (
          <img
            src={customWallpaper.signedUrl}
            alt=""
            style={{
              objectFit: customWallpaper.fit,
              objectPosition: wallpaperPositionToCss(customWallpaper.position),
            }}
          />
        ) : null}
        <i /><i /><i />
      </div>

      <header className="altara-osbar">
        <div className="altara-osbar__brand">
          <span className="altara-osbar__mark"><Globe2 size={17} strokeWidth={1.6} aria-hidden="true" /></span>
          <div><strong>ALTARA OS</strong><small>ALTARA NETWORK</small></div>
        </div>
        <div className="altara-osbar__network"><ShieldCheck size={14} aria-hidden="true" /><span>SYSTEM ACCESS VERIFIED</span></div>
        <button type="button" className="altara-osbar__identity" onClick={handleIdentityAction} aria-label={`${profile?.role === 'gm' ? 'Open GM system settings' : 'Change active identity'}, currently ${identityName}`}>
          <span>{initials(identityName)}</span>
          <div><small>{gmSystemMode
            ? 'ADMIN ENVIRONMENT'
            : takeControlMode
              ? controlledNpcMode
                ? osSession.primaryOsId ? 'ACTING AS' : 'ACTING AS · NO NETWORK OS'
                : 'TAKE CONTROL'
                : 'ACTIVE IDENTITY'}</small><strong>{identityName}</strong></div>
          <ChevronUp size={13} aria-hidden="true" />
        </button>
      </header>

      <section className="altara-desktop" aria-label="ALTARA OS desktop">
        <div className="altara-desktop__intro">
          <p>ALTARA NETWORK</p>
          <h1>Good {now.getHours() < 12 ? 'morning' : now.getHours() < 18 ? 'afternoon' : 'evening'},<br />{identityName.split(' ')[0]}.</h1>
          <span>YOUR GLOBAL ENVIRONMENT IS READY</span>
        </div>

        <div className="altara-desktop__applications" aria-label="Desktop applications">
          {availableApps.map((app) => (
            <AltaraDesktopShortcut
              key={app.id}
              app={app}
              running={Boolean(windowManager.windows[app.id]?.open)}
              disabled={!shellReady}
              onOpen={() => openWindow(app.id)}
            />
          ))}
        </div>

        <aside className="altara-desktop__status" aria-label="ALTARA network status">
          <span><Wifi size={15} aria-hidden="true" /> GLOBAL LINK</span>
          <strong>ONLINE</strong>
          <small>ALTARA NETWORK // SECURE SESSION</small>
        </aside>
      </section>

      {!shellReady ? (
        <section className="altara-session-state" role={identityFailure ? 'alert' : 'status'}>
          <span><CircleUserRound size={20} aria-hidden="true" /></span>
          <p>ALTARA NETWORK // IDENTITY</p>
          <h2>{identityFailure ? 'IDENTITY UNAVAILABLE' : 'PREPARING YOUR DESKTOP'}</h2>
          <small>{identityFailure ?? 'Resolving the active character presentation.'}</small>
          {identityFailure ? (
            <div>
              <button type="button" onClick={() => { void activeIdentitySession.refresh() }}><RefreshCw size={14} aria-hidden="true" /> RETRY</button>
              <button type="button" onClick={handleIdentityAction}>{profile?.role === 'gm' ? 'OPEN SYSTEM SETTINGS' : 'CHANGE CHARACTER'}</button>
            </div>
          ) : <i aria-hidden="true" />}
        </section>
      ) : null}

      {launcherOpen && shellReady ? (
        <AltaraLauncher
          apps={availableApps}
          identityName={identityName}
          launcherRef={launcherRef}
          onOpen={openWindowFromLauncher}
          onChangeIdentity={handleIdentityAction}
          onRequestClose={() => {
            setLauncherOpen(false)
            launcherButtonRef.current?.focus()
          }}
        />
      ) : null}

      <footer className="altara-dock" aria-label="ALTARA taskbar">
        <button
          ref={launcherButtonRef}
          type="button"
          className="altara-dock__home"
          aria-label={launcherOpen ? 'Close ALTARA launcher' : 'Open ALTARA launcher'}
          aria-expanded={launcherOpen}
          aria-controls="altara-launcher"
          aria-haspopup="dialog"
          onClick={() => setLauncherOpen((current) => !current)}
          disabled={!shellReady}
        >
          <LayoutGrid size={18} aria-hidden="true" />
        </button>
        <div className="altara-dock__apps" aria-label="Pinned and running applications">
          {dockApps.map((app) => {
            const Icon = app.icon
            const state = windowManager.windows[app.id]
            const running = Boolean(state?.open)
            const minimized = Boolean(state?.minimized)
            const focused = windowManager.focusedId === app.id
            return (
              <button
                key={app.id}
                type="button"
                style={{ '--app-rgb': app.accentRgb } as CSSProperties}
                data-running={running ? 'true' : 'false'}
                data-focused={focused ? 'true' : 'false'}
                aria-pressed={running && !minimized}
                aria-label={`${!running ? 'Open' : minimized ? 'Restore' : focused ? 'Minimize' : 'Focus'} ${app.name}`}
                title={app.name}
                onClick={() => windowManager.activateTaskbarApp(app.id)}
                disabled={!shellReady}
              >
                <Icon size={19} strokeWidth={1.6} aria-hidden="true" />
                {running ? <i aria-hidden="true" /> : null}
              </button>
            )
          })}
        </div>
        <div className="altara-dock__clock" aria-label={`${date}, ${clock}`}>
          <strong>{clock}</strong><span>{date}</span>
        </div>
      </footer>

      <div className="altara-os__notice" role="status"><span>{notice}</span><small>{runningApps.length} RUNNING</small></div>

      {windowManager.snapPreviewRect ? (
        <div
          className="net-window-snap-preview"
          aria-hidden="true"
          style={{
            left: `${windowManager.snapPreviewRect.x}px`,
            top: `${windowManager.snapPreviewRect.y}px`,
            width: `${windowManager.snapPreviewRect.width}px`,
            height: `${windowManager.snapPreviewRect.height}px`,
            zIndex: 70,
          }}
        />
      ) : null}

      <NetAppWindow
        title="ALTARA"
        subtitle="ALTARA // GLOBAL COMMUNICATIONS"
        icon={getAltaraAppDefinition('altara-messenger').icon}
        accentRgb={getAltaraAppDefinition('altara-messenger').accentRgb}
        {...windowManager.getManagedProps('altara-messenger')}
      >
        <AltaraMessengerApp
          key={`${osSession.controlMode}:${messengerIdentityLinkId ?? 'gm-system'}:${gmPersona.session?.sessionGeneration ?? 'none'}`}
          enabled={Boolean(windowManager.windows['altara-messenger']?.open && shellReady)}
          expectedIdentityLinkId={messengerIdentityLinkId}
        />
      </NetAppWindow>

      <NetAppWindow
        title="ALTARA STORE"
        subtitle="ALTARA OS // SOFTWARE CATALOGUE"
        icon={getAltaraAppDefinition('altara-store').icon}
        accentRgb={getAltaraAppDefinition('altara-store').accentRgb}
        {...windowManager.getManagedProps('altara-store')}
      >
        <AltaraStoreApp
          products={[
            {
              id: 'altara-bank',
              installed: installedAltaraBank,
              running: Boolean(windowManager.windows['altara-bank']?.open),
              disclosure: 'Remove the app? Your account, balance, and financial history will remain intact.',
              onInstall: installAltaraBank,
              onUninstall: uninstallAltaraBank,
              onOpen: () => openWindow('altara-bank'),
            },
            {
              id: 'altara-news',
              installed: installedAltaraNews,
              running: Boolean(windowManager.windows['altara-news']?.open),
              disclosure: 'Remove the app? Saved articles and all newsroom history will remain intact.',
              onInstall: installAltaraNews,
              onUninstall: uninstallAltaraNews,
              onOpen: () => openWindow('altara-news'),
            },
          ]}
          disabled={!runtimeMutationsAllowed || identitySystem.mutating || identitySystem.state.status !== 'ready'}
          error={gmSystemMode
            ? 'ADMINISTRATION MODE // Catalogue viewing is available; installation requires a controlled identity.'
              : identitySystem.state.status === 'error' ? identitySystem.state.reason : undefined}
        />
      </NetAppWindow>

      <NetAppWindow
        title={ALTARA_NEWS_PRODUCT_NAME}
        subtitle="ALTARA // GLOBAL NEWSROOM"
        icon={getAltaraAppDefinition('altara-news').icon}
        accentRgb={getAltaraAppDefinition('altara-news').accentRgb}
        {...windowManager.getManagedProps('altara-news')}
      >
        <AltaraNewsApp
          key={`news:${altaraBankContextKey}`}
          mode={altaraNewsMode}
          enabled={Boolean(windowManager.windows['altara-news']?.open && shellReady)}
          identitySessionKey={altaraBankContextKey}
          expectedIdentityLinkId={altaraNewsMode === 'reader' ? resolvedIdentityLinkId : undefined}
          identityName={identityName}
          onNotice={setNotice}
        />
      </NetAppWindow>

      <NetAppWindow
        title="ALTARA BANK"
        subtitle="ALTARA // GLOBAL FINANCE"
        icon={getAltaraAppDefinition('altara-bank').icon}
        accentRgb={getAltaraAppDefinition('altara-bank').accentRgb}
        {...windowManager.getManagedProps('altara-bank')}
      >
        <AltaraBankApp
          key={altaraBankContextKey}
          mode={altaraBankMode}
          enabled={Boolean(windowManager.windows['altara-bank']?.open && shellReady)}
          identitySessionKey={altaraBankContextKey}
          expectedIdentityLinkId={altaraBankMode === 'personal' ? resolvedIdentityLinkId : undefined}
          onNotice={setNotice}
        />
      </NetAppWindow>

      <NetAppWindow
        title="SETTINGS"
        subtitle="ALTARA OS // SYSTEM PREFERENCES"
        icon={getAltaraAppDefinition('altara-settings').icon}
        accentRgb={getAltaraAppDefinition('altara-settings').accentRgb}
        {...windowManager.getManagedProps('altara-settings')}
      >
        <AltaraSettingsApp
          key={`${profile?.id ?? 'anonymous'}:${systemIdentityLinkId ?? 'gm-system'}:${gmPersona.session?.sessionGeneration ?? 'none'}`}
          identityName={identityName}
          baseWallpaperVisual={wallpaperTheme}
          customWallpaper={customWallpaper}
          status={gmSystemMode ? 'ready' : runtimeSystemState.status}
          saving={runtimeMutationsAllowed && identitySystem.mutating}
          systemError={runtimeSystemState.status === 'error' ? runtimeSystemState.reason : undefined}
          onUpload={uploadWallpaper}
          onUpdatePresentation={updateWallpaperPresentation}
          onRetry={identitySystem.reload}
          {...(profile?.role === 'player' ? { onChangeIdentity } : {})}
          readOnly={!runtimeMutationsAllowed}
          workspaceControl={profile?.role === 'gm' ? (
            <NetGmSystemEnvironmentControl
              profileId={profile.id}
              effectiveOsId={osSession.effectiveOsId}
              controlPrimaryOsId={takeControlMode ? osSession.primaryOsId : undefined}
              controller={gmPersona}
              candidates={candidates.status === 'ready' ? candidates.candidates : []}
              showControlPicker
            />
          ) : undefined}
        />
      </NetAppWindow>
    </main>
  )
}
