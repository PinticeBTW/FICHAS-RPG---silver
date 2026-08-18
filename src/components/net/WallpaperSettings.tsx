import { AlertTriangle, ImagePlus, RotateCcw, Upload } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import {
  validateWallpaperFile,
  wallpaperPositionToCss,
  type WallpaperFit,
  type WallpaperPosition,
} from '../../lib/netWallpaperStore'
import { NetIdentitySettings } from './identity/NetIdentitySettings'
import { NetSystemSecurityControl } from './identity/NetSystemSecurityControl'
import type { NetActiveIdentityState } from './identity/netActiveIdentity'
import type { NetActiveIdentitySession } from './identity/useNetActiveIdentitySession'
import type { NetGmPersonaController } from './identity/useNetGmPersona'
import type { NetPlayableIdentityCandidateState } from './identity/netIdentityTypes'
import { NetUniversalProfileSettings } from './profile/NetUniversalProfileSettings'
import type { NetUniversalProfileController } from './profile/netUniversalProfileTypes'

export type WallpaperApplyInput =
  | { kind: 'default' }
  | {
      kind: 'custom'
      file: File | null
      fit: WallpaperFit
      position: WallpaperPosition
    }

interface WallpaperSettingsProps {
  current: {
    url: string | null
    fit: WallpaperFit
    position: WallpaperPosition
  }
  onApply: (input: WallpaperApplyInput) => Promise<void>
  onCancel: () => void
  onResetWindowLayout: () => void
  activeIdentity: NetActiveIdentityState
  identityCandidates: NetPlayableIdentityCandidateState
  activeIdentitySession: NetActiveIdentitySession
  gmPersona: NetGmPersonaController
  gmSystemEnvironmentControl?: ReactNode
  accountProfile: {
    readonly displayName: string
    readonly handle: string
  } | null
  universalProfile: NetUniversalProfileController
  systemContext: {
    readonly identityLinkId?: string
    readonly profileId?: string
    readonly identityName?: string
    readonly status: 'unavailable' | 'loading' | 'ready' | 'error'
    readonly saving: boolean
    readonly error?: string
    readonly readOnly?: boolean
  }
}

const FIT_OPTIONS: { value: WallpaperFit; label: string }[] = [
  { value: 'cover', label: 'Fill / Cover' },
  { value: 'contain', label: 'Fit / Contain' },
]

const POSITION_OPTIONS: { value: WallpaperPosition; label: string }[] = [
  { value: 'center', label: 'Center' },
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
]

export function WallpaperSettings({
  current,
  onApply,
  onCancel,
  onResetWindowLayout,
  activeIdentity,
  identityCandidates,
  activeIdentitySession,
  gmPersona,
  gmSystemEnvironmentControl,
  accountProfile,
  universalProfile,
  systemContext,
}: WallpaperSettingsProps) {
  const inputId = useId()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [source, setSource] = useState<'default' | 'custom'>(
    current.url ? 'custom' : 'default',
  )

  const [fit, setFit] = useState<WallpaperFit>(current.fit)
  const [position, setPosition] = useState<WallpaperPosition>(
    current.position,
  )

  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [section, setSection] = useState<'appearance' | 'identity' | 'profile' | 'security'>(
    () => (gmSystemEnvironmentControl ? 'identity' : 'appearance'),
  )

  useEffect(() => {
    return () => {
      if (localPreviewUrl) {
        URL.revokeObjectURL(localPreviewUrl)
      }
    }
  }, [localPreviewUrl])

  useEffect(() => {
    if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl)
    setLocalPreviewUrl(null)
    setPendingFile(null)
    setSource(current.url ? 'custom' : 'default')
    setFit(current.fit)
    setPosition(current.position)
    setError(null)
    setApplying(false)
    // Identity and load-state transitions are form boundaries; prior-character
    // drafts must not survive them, and the confirmed server state initializes once ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemContext.identityLinkId, systemContext.status])

  const handleFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    const validationError = validateWallpaperFile(file)

    if (validationError) {
      setError(validationError)
      return
    }

    if (localPreviewUrl) {
      URL.revokeObjectURL(localPreviewUrl)
    }

    setError(null)
    setPendingFile(file)
    setLocalPreviewUrl(URL.createObjectURL(file))
    setSource('custom')
  }

  const handleUseDefault = () => {
    if (localPreviewUrl) {
      URL.revokeObjectURL(localPreviewUrl)
    }

    setSource('default')
    setPendingFile(null)
    setLocalPreviewUrl(null)
    setError(null)
  }

  const handleReset = () => {
    handleUseDefault()
    setFit('cover')
    setPosition('center')
  }

  const handleApply = async () => {
    if (systemContext.status !== 'ready' || !systemContext.identityLinkId) {
      setError('Select an active character and wait for its system profile to synchronize.')
      return
    }

    if (source === 'default') {
      setApplying(true)
      setError(null)
      try {
        await onApply({ kind: 'default' })
      } catch (applyError) {
        setError(applyError instanceof Error ? applyError.message : 'Wallpaper could not be updated.')
      } finally {
        setApplying(false)
      }
      return
    }

    if (!pendingFile && !current.url) {
      setError('Upload an image first.')
      return
    }

    setApplying(true)
    setError(null)
    try {
      await onApply({ kind: 'custom', file: pendingFile, fit, position })
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : 'Wallpaper could not be updated.')
    } finally {
      setApplying(false)
    }
  }

  const previewUrl =
    source === 'custom' ? localPreviewUrl ?? current.url : null
  const controlsDisabled = systemContext.status !== 'ready' || systemContext.saving || applying
  const appearanceReadOnly = Boolean(systemContext.readOnly)
  const appearanceControlsDisabled = controlsDisabled || appearanceReadOnly
  const visibleError = error ?? systemContext.error ?? null

  return (
    <div className="net-wallpaper-settings">
      <nav className="net-wallpaper-settings__nav" aria-label="Settings sections">
        <button
          type="button"
          data-active={section === 'profile' ? 'true' : 'false'}
          aria-pressed={section === 'profile'}
          onClick={() => setSection('profile')}
        >
          Profile
        </button>
        <button
          type="button"
          data-active={section === 'appearance' ? 'true' : 'false'}
          aria-pressed={section === 'appearance'}
          onClick={() => setSection('appearance')}
        >
          Appearance
        </button>
        <button
          type="button"
          data-active={section === 'identity' ? 'true' : 'false'}
          aria-pressed={section === 'identity'}
          onClick={() => setSection('identity')}
        >
          Characters / Identity
        </button>
        <button
          type="button"
          data-active={section === 'security' ? 'true' : 'false'}
          aria-pressed={section === 'security'}
          onClick={() => setSection('security')}
        >
          Security
        </button>
      </nav>

      {section === 'profile' ? (
        <NetUniversalProfileSettings
          activeIdentity={activeIdentity}
          controller={universalProfile}
        />
      ) : section === 'identity' ? (
        <NetIdentitySettings
          activeIdentity={activeIdentity}
          candidates={identityCandidates}
          activeIdentitySession={activeIdentitySession}
          gmPersona={gmPersona}
          accountProfile={accountProfile}
          gmSystemEnvironmentControl={gmSystemEnvironmentControl}
        />
      ) : section === 'security' ? (
        <NetSystemSecurityControl
          identityLinkId={systemContext.identityLinkId}
          profileId={systemContext.profileId}
        />
      ) : <>
      <div className="net-wallpaper-settings__context" aria-live="polite">
        <span>Wallpaper for</span>
        <strong>{systemContext.identityName ?? 'NO ACTIVE CHARACTER'}</strong>
        <em>
          {systemContext.status === 'loading'
            ? 'SYNCING SYSTEM PROFILE'
            : systemContext.status === 'ready'
              ? systemContext.readOnly
                ? 'CONTROLLED SYSTEM MOUNT // READ ONLY'
                : 'SERVER-SYNCED CHARACTER PROFILE'
              : 'CHARACTER SYSTEM UNAVAILABLE'}
        </em>
      </div>

      <div className="net-wallpaper-settings__preview">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="Selected wallpaper preview"
            style={{
              objectFit: fit,
              objectPosition: wallpaperPositionToCss(position),
            }}
          />
        ) : (
          <div className="net-wallpaper-settings__preview-default">
            <strong>NEW VEGA</strong>
            <span>DEFAULT SYSTEM WALLPAPER</span>
          </div>
        )}
      </div>

      <div className="net-wallpaper-settings__section">
        <span className="net-wallpaper-settings__label">Source</span>

        <div className="net-wallpaper-settings__row">
          <button
            type="button"
            className="net-wallpaper-settings__choice"
            data-active={source === 'default' ? 'true' : 'false'}
            disabled={appearanceControlsDisabled}
            onClick={handleUseDefault}
          >
            <RotateCcw size={14} />
            Use default wallpaper
          </button>

          <label
            className="net-wallpaper-settings__choice"
            data-active={source === 'custom' ? 'true' : 'false'}
            data-disabled={appearanceControlsDisabled ? 'true' : 'false'}
            aria-disabled={appearanceControlsDisabled}
            htmlFor={inputId}
          >
            <Upload size={14} />
            Upload image
          </label>

          <input
            ref={fileInputRef}
            id={inputId}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={appearanceControlsDisabled}
            onChange={handleFileChange}
            hidden
          />
        </div>

        {visibleError ? (
          <p className="net-wallpaper-settings__error" role="alert">
            <AlertTriangle size={13} />
            {visibleError}
          </p>
        ) : (
          <p className="net-wallpaper-settings__hint">
            <ImagePlus size={13} />
            {appearanceReadOnly
              ? 'Compromised session. Wallpaper changes remain unavailable.'
              : 'PNG, JPG or WEBP, up to 10 MB.'}
          </p>
        )}
      </div>

      <div className="net-wallpaper-settings__section">
        <span className="net-wallpaper-settings__label">Fit</span>

        <div className="net-wallpaper-settings__row">
          {FIT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className="net-wallpaper-settings__choice"
              data-active={fit === option.value ? 'true' : 'false'}
              aria-pressed={fit === option.value}
              disabled={source === 'default' || appearanceControlsDisabled}
              onClick={() => setFit(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="net-wallpaper-settings__section">
        <span className="net-wallpaper-settings__label">Position</span>

        <div className="net-wallpaper-settings__row">
          {POSITION_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className="net-wallpaper-settings__choice"
              data-active={position === option.value ? 'true' : 'false'}
              aria-pressed={position === option.value}
              disabled={source === 'default' || appearanceControlsDisabled}
              onClick={() => setPosition(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="net-wallpaper-settings__section">
        <span className="net-wallpaper-settings__label">Window layout</span>
        <div className="net-wallpaper-settings__row">
          <button
            type="button"
            className="net-wallpaper-settings__reset"
            onClick={onResetWindowLayout}
          >
            Reset window layout
          </button>
        </div>
      </div>

      <div className="net-wallpaper-settings__footer">
        <button
          type="button"
          className="net-wallpaper-settings__reset"
          disabled={appearanceControlsDisabled}
          onClick={handleReset}
        >
          Reset to default
        </button>

        <div className="net-wallpaper-settings__actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>

          <button
            type="button"
            className="net-wallpaper-settings__apply"
            disabled={appearanceControlsDisabled}
            aria-busy={applying || systemContext.saving}
            onClick={() => { void handleApply() }}
          >
            {applying || systemContext.saving ? 'Saving…' : 'Apply'}
          </button>
        </div>
      </div>
      </>}
    </div>
  )
}
