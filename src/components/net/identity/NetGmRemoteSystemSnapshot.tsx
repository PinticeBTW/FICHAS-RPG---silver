import { RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import {
  fetchNetIdentitySystemForInspection,
  type NetIdentitySystemSnapshot,
} from '../../../lib/netIdentitySystemService'
import { fetchNetGmIdentityOs } from '../../../lib/netOsService'
import { netAppScopeAllows, type NetOsId } from '../../../lib/netOsTypes'
import { wallpaperPositionToCss } from '../../../lib/netWallpaperStore'
import {
  getNetAppDefinition,
  netAppCatalog,
  systemNetAppIds,
} from '../netAppCatalog'

type RemoteSnapshotState =
  | {
      readonly status: 'loading'
      readonly authenticatedProfileId: string
      readonly identityLinkId: string
    }
  | {
      readonly status: 'ready'
      readonly authenticatedProfileId: string
      readonly identityLinkId: string
      readonly snapshot: NetIdentitySystemSnapshot
      readonly primaryOsId: NetOsId | null
    }
  | {
      readonly status: 'error'
      readonly authenticatedProfileId: string
      readonly identityLinkId: string
      readonly reason: string
    }

interface NetGmRemoteSystemSnapshotProps {
  readonly authenticatedProfileId: string
  readonly identityLinkId?: string
  readonly identityName: string
}

function formatSnapshotTimestamp(value: string | null): string {
  if (!value) return 'NOT RECORDED'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'NOT RECORDED'

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date).toUpperCase()
}

function remoteSnapshotError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'The remote system snapshot could not be loaded.'
}

/**
 * Diagnostic read surface only. The inspection service is protected by server
 * RLS; this component never turns a selected candidate into control authority.
 */
export function NetGmRemoteSystemSnapshot({
  authenticatedProfileId,
  identityLinkId,
  identityName,
}: NetGmRemoteSystemSnapshotProps) {
  const [requestVersion, setRequestVersion] = useState(0)
  const [state, setState] = useState<RemoteSnapshotState | null>(null)

  useEffect(() => {
    if (!identityLinkId) {
      return undefined
    }

    let cancelled = false

    void Promise.all([
      fetchNetIdentitySystemForInspection(identityLinkId),
      fetchNetGmIdentityOs(identityLinkId),
    ])
      .then(([snapshot, osAssignment]) => {
        if (cancelled) return
        setState({
          status: 'ready',
          authenticatedProfileId,
          identityLinkId,
          snapshot,
          primaryOsId: osAssignment.primaryOsId,
        })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState({
          status: 'error',
          authenticatedProfileId,
          identityLinkId,
          reason: remoteSnapshotError(error),
        })
      })

    return () => {
      cancelled = true
    }
  }, [authenticatedProfileId, identityLinkId, requestVersion])

  const matchingState = (
    state?.authenticatedProfileId === authenticatedProfileId
    && state.identityLinkId === identityLinkId
  ) ? state : null
  const snapshot = matchingState?.status === 'ready' ? matchingState.snapshot : null
  const primaryOsId = matchingState?.status === 'ready' ? matchingState.primaryOsId : null
  const isLoading = Boolean(identityLinkId) && (!matchingState || matchingState.status === 'loading')
  const loadError = matchingState?.status === 'error' ? matchingState.reason : null
  const installedAppIds = useMemo(() => {
    if (!snapshot || !primaryOsId) return []
    const installed = new Set<string>(snapshot.installedOptionalAppIds)
    return netAppCatalog.filter((app) => (
      app.available
      && netAppScopeAllows(app.scope, primaryOsId)
      && (systemNetAppIds.includes(app.id) || installed.has(app.id))
    ))
  }, [primaryOsId, snapshot])

  return (
    <section className="net-persona-snapshot" aria-labelledby="net-persona-snapshot-title">
      <header className="net-persona-snapshot__header">
        <div>
          <span>REMOTE SNAPSHOT</span>
          <h3 id="net-persona-snapshot-title">{identityName} // SYSTEM</h3>
        </div>
        <strong data-state={isLoading ? 'loading' : loadError || !identityLinkId ? 'unavailable' : 'ready'}>
          {isLoading ? 'SYNCING' : loadError || !identityLinkId ? 'UNAVAILABLE' : 'SYNCED'}
        </strong>
      </header>

      {!identityLinkId ? (
        <p className="net-persona-snapshot__unavailable" role="status">
          SYSTEM PROFILE NOT AVAILABLE. This identity has no server identity link for remote inspection.
        </p>
      ) : null}

      {isLoading ? (
        <div className="net-persona-snapshot__loading" role="status">
          <span>SYNCING REMOTE SYSTEM</span>
          <i />
          <i />
        </div>
      ) : null}

      {loadError ? (
        <div className="net-persona-snapshot__failure" role="alert">
          <p>SYSTEM SNAPSHOT UNAVAILABLE</p>
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => {
              if (!identityLinkId) return
              setState({ status: 'loading', authenticatedProfileId, identityLinkId })
              setRequestVersion((version) => version + 1)
            }}
          >
            <RefreshCw size={13} />
            RETRY SNAPSHOT
          </button>
        </div>
      ) : null}

      {snapshot ? (
        <>
          <div
            className="net-persona-snapshot__wallpaper"
            aria-label={`Remote wallpaper preview for ${identityName}`}
          >
            {snapshot.wallpaper ? (
              <img
                src={snapshot.wallpaper.signedUrl}
                alt={`Remote wallpaper for ${identityName}`}
                style={{
                  objectFit: snapshot.wallpaper.fit,
                  objectPosition: wallpaperPositionToCss(snapshot.wallpaper.position),
                }}
              />
            ) : (
              <div className="net-persona-snapshot__wallpaper-default" aria-label="Default THE NET wallpaper">
                <strong>{primaryOsId === 'altara' ? 'ALTARA' : primaryOsId === 'veil' ? 'NEW VEGA' : 'NO OS'}</strong>
                <span>DEFAULT SYSTEM WALLPAPER</span>
              </div>
            )}
            <span className="net-persona-snapshot__wallpaper-state">
              {snapshot.wallpaper ? 'CUSTOM WALLPAPER' : 'DEFAULT WALLPAPER'}
            </span>
          </div>

          <dl className="net-persona-snapshot__metadata">
            <div><dt>SYSTEM PROFILE</dt><dd>SYNCED</dd></div>
            <div><dt>LAST UPDATE</dt><dd>{formatSnapshotTimestamp(snapshot.updatedAt)}</dd></div>
            <div><dt>WALLPAPER</dt><dd>{snapshot.wallpaper ? 'CUSTOM' : 'DEFAULT'}</dd></div>
            <div><dt>OPTIONAL APPS</dt><dd>{snapshot.installedOptionalAppIds.length}</dd></div>
            <div><dt>SOURCE</dt><dd>{primaryOsId === 'altara' ? 'ALTARA OS' : primaryOsId === 'veil' ? 'NEW VEGA IDENTITY SYSTEM' : 'NO OPERATING SYSTEM'}</dd></div>
          </dl>

          <section className="net-persona-snapshot__applications" aria-labelledby="net-persona-snapshot-applications">
            <header>
              <h4 id="net-persona-snapshot-applications">INSTALLED APPLICATIONS</h4>
              <span>{installedAppIds.length}</span>
            </header>
            <ul>
              {installedAppIds.map((app) => {
                const definition = getNetAppDefinition(app.id) ?? app
                const AppIcon = definition.icon
                return (
                  <li key={definition.id}>
                    <AppIcon size={14} style={{ color: `rgb(${definition.accentRgb})` }} aria-hidden="true" />
                    <span>
                      <strong>{definition.name}</strong>
                      <small>{definition.owner} // {definition.category}</small>
                    </span>
                    <em>{definition.systemApp ? 'SYSTEM' : 'OPTIONAL'}</em>
                  </li>
                )
              })}
            </ul>
          </section>

          <p className="net-persona-snapshot__device-note">
            DEVICE WORKSPACE STATE IS NOT PART OF THE NETWORK SNAPSHOT.
          </p>
        </>
      ) : null}
    </section>
  )
}
