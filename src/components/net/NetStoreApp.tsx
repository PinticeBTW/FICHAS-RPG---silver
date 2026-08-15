import {
  Check,
  Download,
  ExternalLink,
  Grid2X2,
  HardDrive,
  Landmark,
  Newspaper,
  Search,
  ShieldCheck,
  Store,
  Video,
  Waves,
  X,
} from 'lucide-react'
import { useMemo, useState, type CSSProperties } from 'react'

import {
  netAppCatalog,
  type NetAppDefinition,
  type NetAppId,
  type NetOptionalAppId,
} from './netAppCatalog'
import { useNetDialog } from './netDialogStack'
import { netAppScopeAllows, type NetOsId } from '../../lib/netOsTypes'

import '../../styles/netStore.css'

type StoreView =
  | 'featured'
  | 'networks'
  | 'social'
  | 'identity'
  | 'news'
  | 'creator'
  | 'finance'
  | 'installed'

type InstallJob = { appId: NetOptionalAppId; progress: number } | null

interface NetStoreAppProps {
  osId: NetOsId
  installedAppIds: readonly NetAppId[]
  openAppIds: readonly NetAppId[]
  installJob: InstallJob
  onOpenApp: (appId: NetAppId) => void
  onInstallApp: (appId: NetOptionalAppId) => void
  onUninstallApp: (appId: NetOptionalAppId) => void
  onUnavailable: (appId: NetAppId) => void
  /** Apps explicitly exposed by the shell as GM/system tools; never installations. */
  gmSystemAccessAppIds?: readonly NetAppId[]
  /** Narrative compromised-session mounts remain inspection-only. */
  readOnly?: boolean
}

const catalogueNavigation: ReadonlyArray<{
  id: StoreView
  label: string
  icon: typeof Grid2X2
}> = [
  { id: 'featured', label: 'Featured', icon: Grid2X2 },
  { id: 'networks', label: 'Networks', icon: Store },
  { id: 'social', label: 'Social', icon: Waves },
  { id: 'identity', label: 'Identity', icon: ShieldCheck },
  { id: 'news', label: 'News', icon: Newspaper },
  { id: 'creator', label: 'Creator', icon: Video },
  { id: 'finance', label: 'Finance', icon: Landmark },
  { id: 'installed', label: 'Installed', icon: Check },
]

function matchesQuery(app: NetAppDefinition, query: string) {
  const candidate = [
    app.name,
    app.owner,
    app.category,
    app.description,
    ...app.searchAliases,
  ].join(' ').toLocaleLowerCase()
  return candidate.includes(query)
}

function belongsToView(app: NetAppDefinition, view: StoreView) {
  if (view === 'featured' || view === 'networks') return true
  if (view === 'installed') return false
  return app.category.toLocaleLowerCase() === view
}

function AppStatus({
  app,
  installed,
  gmSystemAccess = false,
}: {
  app: NetAppDefinition
  installed: boolean
  gmSystemAccess?: boolean
}) {
  if (!app.available) return <span className="net-store__status" data-status="soon">Coming soon</span>
  if (gmSystemAccess && app.gmSystemAccess) {
    return <span className="net-store__status" data-status="system">{app.gmSystemAccess.statusLabel}</span>
  }
  if (app.systemApp) return <span className="net-store__status" data-status="system">System</span>
  if (installed) return <span className="net-store__status" data-status="installed">Installed</span>
  return <span className="net-store__status">Available</span>
}

function UninstallConfirmation({
  app,
  isRunning,
  onCancel,
  onConfirm,
}: {
  app: NetAppDefinition
  isRunning: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const { dialogRef, onFocusCapture } = useNetDialog<HTMLDivElement>(onCancel)

  return (
    <div className="net-store-confirmation" role="presentation">
      <div
        ref={dialogRef}
        className="net-store-confirmation__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="net-store-uninstall-title"
        tabIndex={-1}
        onFocusCapture={onFocusCapture}
      >
        <div>
          <h2 id="net-store-uninstall-title">Remove {app.name}?</h2>
          <p>
            {isRunning
              ? `${app.name} is open and will close before it is removed from this character's system profile.`
              : `${app.name} will be removed from this character's system profile. Its mock content and device-local window layout remain untouched.`}
          </p>
        </div>
        <div className="net-store-confirmation__actions">
          <button type="button" className="net-store__ghost-button" data-net-dialog-initial-focus onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="net-store__danger-button" onClick={onConfirm}>
            Remove application
          </button>
        </div>
      </div>
    </div>
  )
}

export function NetStoreApp({
  osId,
  installedAppIds,
  openAppIds,
  installJob,
  onOpenApp,
  onInstallApp,
  onUninstallApp,
  onUnavailable,
  gmSystemAccessAppIds = [],
  readOnly = false,
}: NetStoreAppProps) {
  const [view, setView] = useState<StoreView>('featured')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<NetAppId>('echo')
  const [pendingUninstallId, setPendingUninstallId] = useState<NetOptionalAppId | null>(null)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const installedSet = useMemo(() => new Set(installedAppIds), [installedAppIds])
  const gmSystemAccessSet = useMemo(
    () => new Set(gmSystemAccessAppIds),
    [gmSystemAccessAppIds],
  )
  const scopedCatalog = useMemo(
    () => netAppCatalog.filter((app) => netAppScopeAllows(app.scope, osId)),
    [osId],
  )

  const visibleApps = useMemo(() => {
    if (normalizedQuery) {
      return scopedCatalog.filter((app) => matchesQuery(app, normalizedQuery))
    }
    if (view === 'installed') {
      return scopedCatalog.filter((app) => installedSet.has(app.id))
    }
    return scopedCatalog.filter((app) => belongsToView(app, view))
  }, [installedSet, normalizedQuery, scopedCatalog, view])

  const effectiveSelectedId = visibleApps.some((app) => app.id === selectedId)
    ? selectedId
    : visibleApps[0]?.id ?? 'echo'
  const selectedApp = scopedCatalog.find((app) => app.id === effectiveSelectedId) ?? scopedCatalog[0]
  const SelectedIcon = selectedApp.icon

  const isInstalled = installedSet.has(selectedApp.id)
  const selectedGmSystemAccess = gmSystemAccessSet.has(selectedApp.id)
    ? selectedApp.gmSystemAccess
    : undefined
  const activeJob = installJob?.appId === selectedApp.id ? installJob : null
  const pendingUninstallApp = pendingUninstallId
    ? scopedCatalog.find((app) => app.id === pendingUninstallId)
    : undefined

  const selectView = (nextView: StoreView) => {
    setView(nextView)
    setQuery('')
  }

  const requestUninstall = () => {
    if (readOnly) return
    if (selectedApp.systemApp || !selectedApp.removable) return
    setPendingUninstallId(selectedApp.id as NetOptionalAppId)
  }

  return (
    <section className="net-store" aria-label="NET STORE catalogue">
      <aside className="net-store__navigation" aria-label="NET STORE navigation">
        <div className="net-store__brand">
          <Store size={19} aria-hidden="true" />
          <h1>NET STORE</h1>
          <p>VEIL OS approved software</p>
        </div>

        <nav>
          {catalogueNavigation.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                data-active={view === item.id && !normalizedQuery ? 'true' : 'false'}
                onClick={() => selectView(item.id)}
              >
                <Icon size={15} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="net-store__catalogue-status">
          <span>Catalogue status</span>
          <strong><i /> Local grid verified</strong>
          <small>{scopedCatalog.length} VEGA MESH services indexed</small>
        </div>
      </aside>

      <div className="net-store__catalogue">
        <header className="net-store__catalogue-header">
          <div>
            <h2>{normalizedQuery ? 'Search results' : view === 'featured' ? 'VEIL OS catalogue' : view}</h2>
            <p>{normalizedQuery ? `Results for “${query.trim()}”` : 'Approved software for this New Vega terminal.'}</p>
          </div>
          <label className="net-store__search">
            <Search size={15} aria-hidden="true" />
            <span className="sr-only">Search the NET STORE catalogue</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search catalogue"
              aria-label="Search the NET STORE catalogue"
            />
            {query ? (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear NET STORE search">
                <X size={14} aria-hidden="true" />
              </button>
            ) : null}
          </label>
        </header>

        <div className="net-store__catalogue-body">
          {!normalizedQuery && view === 'featured' ? (
            <button
              type="button"
              className="net-store__featured"
              data-selected={selectedApp.id === 'echo' ? 'true' : 'false'}
              onClick={() => setSelectedId('echo')}
            >
              <strong>ECHO</strong>
              <p>Local context, nearby moments, and the Resonance layer.</p>
              <small>Inspection available <ExternalLink size={13} aria-hidden="true" /></small>
            </button>
          ) : null}

          <div className="net-store__list" aria-label="Catalogue applications">
            {visibleApps.map((app) => {
              const Icon = app.icon
              const installed = installedSet.has(app.id)
              return (
                <button
                  key={app.id}
                  type="button"
                  className="net-store__row"
                  data-selected={selectedApp.id === app.id ? 'true' : 'false'}
                  style={{ '--store-app-rgb': app.accentRgb } as CSSProperties}
                  onClick={() => setSelectedId(app.id)}
                >
                  <span className="net-store__row-icon"><Icon size={19} aria-hidden="true" /></span>
                  <span className="net-store__row-copy">
                    <strong>{app.name}</strong>
                    <small>{app.owner} // {app.shortDescription}</small>
                  </span>
                  <AppStatus
                    app={app}
                    installed={installed}
                    gmSystemAccess={gmSystemAccessSet.has(app.id)}
                  />
                </button>
              )
            })}
            {visibleApps.length === 0 ? (
              <div className="net-store__empty">
                <Search size={19} aria-hidden="true" />
                <strong>No catalogue matches</strong>
                <p>Try a service, publisher, category, or feature.</p>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <aside className="net-store__inspection" aria-label="Selected application details">
        <div className="net-store__inspection-title" style={{ '--store-app-rgb': selectedApp.accentRgb } as CSSProperties}>
          <span className="net-store__inspection-icon"><SelectedIcon size={22} aria-hidden="true" /></span>
          <div>
            <h2>{selectedApp.name}</h2>
            <p>{selectedApp.owner}</p>
          </div>
        </div>

        <div className="net-store__inspection-state">
          <AppStatus
            app={selectedApp}
            installed={isInstalled}
            gmSystemAccess={Boolean(selectedGmSystemAccess)}
          />
          <span>{selectedApp.category}</span>
        </div>

        <p className="net-store__description">{selectedApp.description}</p>

        <dl className="net-store__metadata">
          <div><dt>Version</dt><dd>{selectedApp.version}</dd></div>
          <div><dt>Footprint</dt><dd><HardDrive size={13} aria-hidden="true" /> {selectedApp.installSize}</dd></div>
          <div><dt>Publisher</dt><dd>{selectedApp.owner}</dd></div>
        </dl>

        <section className="net-store__features" aria-label={`${selectedApp.name} features`}>
          <h3>Included services</h3>
          <ul>
            {selectedApp.features.map((feature) => <li key={feature}><Check size={13} aria-hidden="true" /> {feature}</li>)}
          </ul>
        </section>

        <div className="net-store__system-note">
          {selectedGmSystemAccess
            ? selectedGmSystemAccess.description
            : selectedApp.systemApp
            ? 'System application. Maintained as part of this VEIL OS terminal.'
            : selectedApp.available
              ? 'Installation follows the active character across authenticated devices.'
              : 'This service is indexed but its application module is not yet available.'}
        </div>

        <div className="net-store__actions">
          {readOnly ? (
            <p className="net-store__system-note" role="status">
              Compromised session // library is read only
            </p>
          ) : activeJob ? (
            <>
              <progress value={activeJob.progress} max={100} aria-label={`Installing ${selectedApp.name}: ${activeJob.progress}%`} />
              <span>Installing // {activeJob.progress}%</span>
            </>
          ) : null}
          {!selectedApp.available ? (
            <button type="button" className="net-store__ghost-button" onClick={() => onUnavailable(selectedApp.id)}>
              Module unavailable
            </button>
          ) : selectedGmSystemAccess ? (
            <button type="button" className="net-store__primary-button" onClick={() => onOpenApp(selectedApp.id)}>
              <ShieldCheck size={15} aria-hidden="true" /> {selectedGmSystemAccess.actionLabel}
            </button>
          ) : isInstalled ? (
            <>
              <button type="button" className="net-store__primary-button" onClick={() => onOpenApp(selectedApp.id)}>
                <ExternalLink size={15} aria-hidden="true" /> Open application
              </button>
              {selectedApp.removable && !readOnly ? (
                <button type="button" className="net-store__danger-button" onClick={requestUninstall}>Uninstall</button>
              ) : !readOnly ? (
                <button type="button" className="net-store__ghost-button" onClick={() => onUnavailable(selectedApp.id)}>
                  System application
                </button>
              ) : null}
            </>
          ) : readOnly ? (
            <p className="net-store__system-note">Installation changes are unavailable in a compromised session.</p>
          ) : (
            <button type="button" className="net-store__primary-button" onClick={() => onInstallApp(selectedApp.id as NetOptionalAppId)}>
              <Download size={15} aria-hidden="true" /> Install for character
            </button>
          )}
        </div>
      </aside>

      {pendingUninstallApp ? (
        <UninstallConfirmation
          app={pendingUninstallApp}
          isRunning={openAppIds.includes(pendingUninstallApp.id)}
          onCancel={() => setPendingUninstallId(null)}
          onConfirm={() => {
            onUninstallApp(pendingUninstallApp.id as NetOptionalAppId)
            setPendingUninstallId(null)
          }}
        />
      ) : null}
    </section>
  )
}
