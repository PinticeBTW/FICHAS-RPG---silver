import {
  AlertTriangle,
  ArrowLeft,
  MonitorCog,
  Upload,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import {
  validateWallpaperFile,
  wallpaperPositionToCss,
  type WallpaperFit,
  type WallpaperPosition,
} from '../../../lib/netWallpaperStore'
import type { NetIdentitySystemWallpaper } from '../../../lib/netIdentitySystemService'
import { NetSystemSecurityControl } from '../identity/NetSystemSecurityControl'

export function AltaraSettingsApp({
  identityName,
  baseWallpaperVisual,
  customWallpaper,
  status,
  saving,
  systemError,
  onUpload,
  onUpdatePresentation,
  onRetry,
  onChangeIdentity,
  workspaceControl,
  readOnly = false,
  securityIdentityLinkId,
  securityProfileId,
}: {
  readonly identityName: string
  readonly baseWallpaperVisual: 'nocturne' | 'atlas' | 'silk'
  readonly customWallpaper: NetIdentitySystemWallpaper | null
  readonly status: 'unavailable' | 'loading' | 'ready' | 'error'
  readonly saving: boolean
  readonly systemError?: string
  readonly onUpload: (file: File, fit: WallpaperFit, position: WallpaperPosition) => Promise<void>
  readonly onUpdatePresentation: (fit: WallpaperFit, position: WallpaperPosition) => Promise<void>
  readonly onRetry: () => void
  readonly onChangeIdentity?: () => void
  readonly workspaceControl?: ReactNode
  readonly readOnly?: boolean
  readonly securityIdentityLinkId?: string
  readonly securityProfileId?: string
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fit, setFit] = useState<WallpaperFit>(customWallpaper?.fit ?? 'cover')
  const [position, setPosition] = useState<WallpaperPosition>(customWallpaper?.position ?? 'center')
  const [localPreview, setLocalPreview] = useState<string | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setFit(customWallpaper?.fit ?? 'cover')
    setPosition(customWallpaper?.position ?? 'center')
    setPendingFile(null)
    setError(null)
    setLocalPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous)
      return null
    })
  }, [customWallpaper?.fit, customWallpaper?.path, customWallpaper?.position])

  useEffect(() => () => {
    if (localPreview) URL.revokeObjectURL(localPreview)
  }, [localPreview])

  const controlsDisabled = status !== 'ready' || saving || readOnly
  const visibleError = error ?? systemError
  const previewUrl = localPreview ?? customWallpaper?.signedUrl ?? null

  const handleFile = (file: File | undefined) => {
    if (!file) return
    const validationError = validateWallpaperFile(file)
    if (validationError) {
      setError(validationError)
      return
    }
    if (localPreview) URL.revokeObjectURL(localPreview)
    setPendingFile(file)
    setLocalPreview(URL.createObjectURL(file))
    setError(null)
  }

  const saveCustom = async () => {
    try {
      setError(null)
      if (pendingFile) await onUpload(pendingFile, fit, position)
      else if (customWallpaper) await onUpdatePresentation(fit, position)
      else throw new Error('Choose a custom wallpaper before saving.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Wallpaper could not be saved.')
    }
  }

  return (
    <div className="altara-settings">
      <header>
        <span><MonitorCog size={18} aria-hidden="true" /></span>
        <div>
          <p>ALTARA OS</p>
          <h2>Local preferences</h2>
        </div>
      </header>

      {workspaceControl}

      <section aria-labelledby="altara-appearance-title">
        <div className="altara-settings__section-heading">
          <div>
            <p>APPEARANCE</p>
            <h3 id="altara-appearance-title">Wallpaper</h3>
          </div>
          <small>{readOnly ? 'GM SYSTEM' : status === 'loading' ? 'SYNCING PROFILE' : saving ? 'SAVING' : 'IDENTITY-SCOPED'}</small>
        </div>
        <div className="altara-settings__preview" data-custom={previewUrl ? 'true' : 'false'}>
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={pendingFile
                ? 'Selected ALTARA wallpaper preview, not yet saved'
                : 'Current custom ALTARA wallpaper preview'}
              style={{ objectFit: fit, objectPosition: wallpaperPositionToCss(position) }}
            />
          ) : (
            <i data-wallpaper={baseWallpaperVisual} aria-hidden="true" />
          )}
          <span>{pendingFile ? 'NEW IMAGE // NOT SAVED' : customWallpaper ? 'CURRENT WALLPAPER' : 'ALTARA DEFAULT'}</span>
        </div>
        <div className="altara-settings__custom">
          <div>
            <button
              type="button"
              disabled={controlsDisabled}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={14} aria-hidden="true" /> CHOOSE IMAGE
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={controlsDisabled}
              onChange={(event) => {
                handleFile(event.target.files?.[0])
                event.target.value = ''
              }}
              hidden
            />
            <button
              type="button"
              disabled={controlsDisabled || (!pendingFile && !customWallpaper)}
              onClick={() => { void saveCustom() }}
            >
              {saving ? 'SAVING…' : pendingFile ? 'UPLOAD & APPLY' : 'SAVE PRESENTATION'}
            </button>
          </div>
          <div className="altara-settings__presentation">
            <label>FIT
              <select value={fit} disabled={controlsDisabled || (!pendingFile && !customWallpaper)} onChange={(event) => setFit(event.target.value as WallpaperFit)}>
                <option value="cover">Cover</option>
                <option value="contain">Contain</option>
              </select>
            </label>
            <label>POSITION
              <select value={position} disabled={controlsDisabled || (!pendingFile && !customWallpaper)} onChange={(event) => setPosition(event.target.value as WallpaperPosition)}>
                <option value="center">Center</option>
                <option value="top">Top</option>
                <option value="bottom">Bottom</option>
              </select>
            </label>
          </div>
        </div>
        {visibleError ? <div className="altara-settings__error" role="alert"><p><AlertTriangle size={13} aria-hidden="true" /> {visibleError}</p><button type="button" disabled={saving} onClick={onRetry}>RETRY</button></div> : (
          <p className="altara-settings__disclosure">{readOnly
            ? 'GM SYSTEM has no fictional runtime identity. Take control or act as an identity to edit its wallpaper.'
            : 'Private identity wallpaper. PNG, JPG or WEBP up to 10 MB.'}</p>
        )}
      </section>

      <section aria-labelledby="altara-identity-title">
        <div className="altara-settings__section-heading">
          <div>
            <p>NETWORK IDENTITY</p>
            <h3 id="altara-identity-title">{identityName}</h3>
          </div>
          <small>ALTARA NETWORK</small>
        </div>
        <div className="altara-settings__identity-actions">
          {onChangeIdentity ? <button type="button" onClick={onChangeIdentity}>CHANGE ACTIVE CHARACTER</button> : null}
          <Link to="/app/sheets"><ArrowLeft size={14} aria-hidden="true" /> RETURN TO SHEETS</Link>
        </div>
      </section>

      <section aria-labelledby="altara-security-title">
        <div className="altara-settings__section-heading">
          <div>
            <p>SYSTEM</p>
            <h3 id="altara-security-title">Security</h3>
          </div>
          <small>ALTARA NETWORK</small>
        </div>
        <div className="altara-persona-control">
          <NetSystemSecurityControl
            identityLinkId={securityIdentityLinkId}
            profileId={securityProfileId}
          />
        </div>
      </section>
    </div>
  )
}
