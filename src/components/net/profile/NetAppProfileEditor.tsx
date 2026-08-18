import { RefreshCcw } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useNetAppIdentityPresentation } from './useNetAppIdentityPresentation'

import '../../../styles/netAppProfileEditor.css'

function initials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?'
}

/**
 * Reusable APP-LOCAL presentation editor. Embeddable in any identity/account
 * settings surface: pass the exact app id (matching net_app_identity_
 * presentations' app_id) and the caller's own current legitimate identity
 * for that app (already resolved through the canonical SOURCE/TARGET/TAKE
 * CONTROL/ACT AS authority -- this component never resolves identity
 * itself). Changes are strictly scoped to this one app; the character
 * sheet, the identity canonical record, and every other app's own
 * presentation are never touched.
 */
export function NetAppProfileEditor({
  appId,
  appLabel,
  identityLinkId,
  onClose,
  onSaved,
}: {
  readonly appId: string
  readonly appLabel: string
  readonly identityLinkId?: string
  readonly onClose?: () => void
  /** Called after a successful save or reset -- the host app should refetch its own presentation-bearing data (e.g. its sidebar/conversation list) here. */
  readonly onSaved?: () => void
}) {
  const controller = useNetAppIdentityPresentation({ appId, expectedIdentityLinkId: identityLinkId, onSaved })
  const [nameDraft, setNameDraft] = useState('')
  const [avatarDraft, setAvatarDraft] = useState<{ readonly ref: string; readonly previewUrl: string } | null>(null)
  const [loadedDraftKey, setLoadedDraftKey] = useState<string | null>(null)
  const readyState = controller.state.status === 'ready' ? controller.state : undefined

  // Reset the name draft to match freshly loaded/saved server state, keyed
  // on the exact (identity, saved value) pair. Adjusted during render
  // (React's documented pattern for this) rather than in an effect, so an
  // externally changed identity or a completed save never causes an extra
  // render/commit before the draft catches up.
  const currentDraftKey = readyState
    ? `${readyState.profile.identityLinkId}:${readyState.profile.customDisplayName ?? ''}`
    : null
  if (readyState && currentDraftKey !== loadedDraftKey) {
    setLoadedDraftKey(currentDraftKey)
    setNameDraft(readyState.profile.customDisplayName ?? '')
  }

  useEffect(() => () => {
    if (avatarDraft) URL.revokeObjectURL(avatarDraft.previewUrl)
  }, [avatarDraft])

  if (controller.state.status === 'identity-required') {
    return (
      <section className="net-app-profile-editor" aria-labelledby="net-app-profile-title">
        <header><h3 id="net-app-profile-title">APP PROFILE</h3></header>
        <p className="net-app-profile-editor__empty">No controlled {appLabel} identity is active.</p>
      </section>
    )
  }
  if (controller.state.status === 'loading' || controller.state.status === 'idle') {
    return (
      <section className="net-app-profile-editor" aria-labelledby="net-app-profile-title" aria-busy="true">
        <header><h3 id="net-app-profile-title">APP PROFILE</h3></header>
        <p className="net-app-profile-editor__empty">Reading {appLabel} presentation…</p>
      </section>
    )
  }
  if (controller.state.status === 'error') {
    return (
      <section className="net-app-profile-editor" aria-labelledby="net-app-profile-title" role="alert">
        <header><h3 id="net-app-profile-title">APP PROFILE</h3></header>
        <p className="net-app-profile-editor__error">{controller.state.reason}</p>
        <button type="button" onClick={() => { void controller.reload() }}><RefreshCcw size={13} aria-hidden="true" /> RETRY</button>
      </section>
    )
  }
  if (!readyState) return null

  const { profile } = readyState
  const hasOverride = Boolean(profile.customDisplayName || profile.customAvatarRef)
  const previewAvatarUrl = avatarDraft?.previewUrl ?? readyState.effectiveAvatarUrl
  const previewName = nameDraft.trim() || profile.effectiveDisplayName
  const isDirty = nameDraft.trim() !== (profile.customDisplayName ?? '')
    || Boolean(avatarDraft && avatarDraft.ref !== profile.customAvatarRef)

  const chooseFile = async (file: File | undefined) => {
    if (!file) return
    const reference = await controller.uploadAvatar(file)
    if (!reference) return
    if (avatarDraft) controller.discardUpload(avatarDraft.ref)
    setAvatarDraft({ ref: reference, previewUrl: URL.createObjectURL(file) })
  }

  const submit = async () => {
    const avatarRef = avatarDraft ? avatarDraft.ref : profile.customAvatarRef ?? ''
    const saved = await controller.save(nameDraft, avatarRef)
    if (saved) setAvatarDraft(null)
  }

  const resetToDefault = async () => {
    if (avatarDraft) controller.discardUpload(avatarDraft.ref)
    setAvatarDraft(null)
    setNameDraft('')
    await controller.reset()
  }

  return (
    <section className="net-app-profile-editor" aria-labelledby="net-app-profile-title">
      <header>
        <div>
          <h3 id="net-app-profile-title">APP PROFILE</h3>
          <p>Changes apply only to this app.</p>
        </div>
        {onClose ? <button type="button" className="net-app-profile-editor__close" onClick={onClose} aria-label="Close app profile editor">×</button> : null}
      </header>

      <div className="net-app-profile-editor__preview">
        <span className="net-app-profile-editor__avatar">
          {previewAvatarUrl ? <img src={previewAvatarUrl} alt="" /> : initials(previewName)}
        </span>
        <div>
          <strong>{previewName}</strong>
          <small>{appLabel.toUpperCase()} PRESENTATION</small>
        </div>
      </div>

      <label className="net-app-profile-editor__photo">
        <span>{controller.uploading ? 'PROCESSING IMAGE…' : 'CHANGE PHOTO'}</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
          disabled={controller.saving || controller.uploading}
          onChange={(event) => {
            void chooseFile(event.target.files?.[0])
            event.target.value = ''
          }}
        />
      </label>

      <label className="net-app-profile-editor__name">
        <span>Display name</span>
        <input
          value={nameDraft}
          maxLength={40}
          placeholder={profile.canonicalDisplayName}
          onChange={(event) => setNameDraft(event.target.value)}
          disabled={controller.saving}
        />
        <small>{nameDraft.trim() ? 'APP OVERRIDE' : 'USING CHARACTER SHEET'}</small>
      </label>

      {controller.error ? <p className="net-app-profile-editor__error" role="alert">{controller.error}</p> : null}

      <footer>
        <button
          type="button"
          className="net-app-profile-editor__reset"
          onClick={() => { void resetToDefault() }}
          disabled={controller.saving || controller.uploading || (!hasOverride && !avatarDraft && !nameDraft.trim())}
        >
          RESET TO CHARACTER DEFAULT
        </button>
        <button
          type="button"
          className="net-app-profile-editor__save"
          onClick={() => { void submit() }}
          disabled={controller.saving || controller.uploading || !isDirty}
        >
          {controller.saving ? 'SAVING…' : 'SAVE'}
        </button>
      </footer>
    </section>
  )
}
