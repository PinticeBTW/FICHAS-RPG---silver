import { useEffect, useMemo, useState } from 'react'
import { SharedMediaImage } from '../../shared/SharedMediaImage'
import { uploadSharedImage } from '../../../lib/media/mediaStorage'

import type { NetActiveIdentityState } from '../identity/netActiveIdentity'
import type { NetUniversalProfileController } from './netUniversalProfileTypes'

interface NetUniversalProfileSettingsProps {
  readonly activeIdentity: NetActiveIdentityState
  readonly controller: NetUniversalProfileController
}

interface ProfileDraft {
  readonly displayNameOverride: string
  readonly bio: string
  readonly status: string
  readonly avatarUrlOverride: string
}

function profileDraft(controller: NetUniversalProfileController): ProfileDraft {
  if (controller.state.status !== 'ready') {
    return { displayNameOverride: '', bio: '', status: '', avatarUrlOverride: '' }
  }

  return {
    displayNameOverride: controller.state.profile?.displayNameOverride ?? '',
    bio: controller.state.profile?.bio ?? '',
    status: controller.state.profile?.status ?? '',
    avatarUrlOverride: controller.state.profile?.avatarUrlOverride ?? '',
  }
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'NV'
}

function EmptyProfileState({ activeIdentity }: { readonly activeIdentity: NetActiveIdentityState }) {
  const isGm = activeIdentity.status === 'gm-no-persona'
  const selectionRequired = activeIdentity.status === 'selection-required'

  return (
    <section className="net-universal-profile" aria-labelledby="net-profile-title">
      <header className="net-universal-profile__header">
        <div>
          <h2 id="net-profile-title">Profile</h2>
          <p>Shared presentation defaults are attached to an active fictional identity.</p>
        </div>
      </header>
      <div className="net-universal-profile__empty" role="status">
        <strong>{isGm ? 'NO ACTIVE PERSONA' : selectionRequired ? 'SELECT A CHARACTER' : 'NO ACTIVE IDENTITY'}</strong>
        <span>{isGm
          ? 'GM Session does not edit a fictional Universal NET Profile.'
          : 'Open Characters / Identity to select an authorised playable character.'}</span>
      </div>
    </section>
  )
}

export function NetUniversalProfileSettings({
  activeIdentity,
  controller,
}: NetUniversalProfileSettingsProps) {
  const [draft, setDraft] = useState<ProfileDraft>(() => profileDraft(controller))
  const [saveNotice, setSaveNotice] = useState<{ readonly identityLinkId: string; readonly text: string } | null>(null)
  const [avatarUpload, setAvatarUpload] = useState<'idle' | 'processing'>('idle')
  const [avatarUploadError, setAvatarUploadError] = useState<string | null>(null)

  const readyProfile = controller.state.status === 'ready' ? controller.state : undefined
  const profileRevision = readyProfile
    ? `${readyProfile.identityLinkId}:${readyProfile.profile?.updatedAt ?? 'new'}`
    : 'inactive'
  const draftSource = useMemo(
    () => profileDraft(controller),
    [profileRevision],
  )

  useEffect(() => {
    setDraft(draftSource)
  }, [draftSource, profileRevision])

  if (controller.state.status === 'loading') {
    return (
      <section className="net-universal-profile" aria-labelledby="net-profile-title">
        <header className="net-universal-profile__header">
          <div>
            <h2 id="net-profile-title">Profile</h2>
            <p>Reading profile defaults for the selected character.</p>
          </div>
        </header>
        <div className="net-universal-profile__empty" aria-live="polite">
          <strong>READING NET PROFILE</strong>
          <span>Character-sheet facts remain available as the profile source.</span>
        </div>
      </section>
    )
  }

  if (controller.state.status === 'no-active-identity') {
    return <EmptyProfileState activeIdentity={activeIdentity} />
  }

  if (controller.state.status === 'error') {
    return (
      <section className="net-universal-profile" aria-labelledby="net-profile-title">
        <header className="net-universal-profile__header">
          <div>
            <h2 id="net-profile-title">Profile</h2>
            <p>Shared presentation defaults are attached to an active fictional identity.</p>
          </div>
        </header>
        <div className="net-universal-profile__empty" role="alert">
          <strong>PROFILE UNAVAILABLE</strong>
          <span>{controller.state.reason}</span>
        </div>
      </section>
    )
  }

  const { identityLinkId, resolved, profile } = controller.state
  const sourceDraft = profileDraft(controller)
  const isDirty = draft.displayNameOverride !== sourceDraft.displayNameOverride
    || draft.bio !== sourceDraft.bio
    || draft.status !== sourceDraft.status
    || draft.avatarUrlOverride !== sourceDraft.avatarUrlOverride
  const displayNameInvalid = draft.displayNameOverride.trim().length > 40
  const bioInvalid = draft.bio.trim().length > 240
  const statusInvalid = draft.status.trim().length > 100
  const invalid = displayNameInvalid || bioInvalid || statusInvalid

  const save = async () => {
    if (invalid || !isDirty) return
    const saved = await controller.save({
      ...(draft.displayNameOverride.trim() ? { displayNameOverride: draft.displayNameOverride } : {}),
      ...(draft.bio.trim() ? { bio: draft.bio } : {}),
      ...(draft.status.trim() ? { status: draft.status } : {}),
      ...(draft.avatarUrlOverride.trim() ? { avatarUrlOverride: draft.avatarUrlOverride } : {}),
    })
    if (saved) {
      setSaveNotice({ identityLinkId, text: 'NET PROFILE SAVED' })
    }
  }

  const updateDraft = (update: (current: ProfileDraft) => ProfileDraft) => {
    setSaveNotice(null)
    setDraft(update)
  }

  const uploadAvatar = async (file: File | undefined) => {
    if (!file) return
    setAvatarUpload('processing')
    setAvatarUploadError(null)
    try {
      const uploaded = await uploadSharedImage({
        subjectKind: 'universal-profile',
        subjectId: identityLinkId,
        mediaKind: 'avatar',
        slot: 'primary',
      }, file, 'avatar')
      updateDraft((current) => ({ ...current, avatarUrlOverride: uploaded.reference }))
    } catch (error) {
      setAvatarUploadError(error instanceof Error ? error.message : 'Avatar upload failed.')
    } finally {
      setAvatarUpload('idle')
    }
  }

  const sheetFacts = [
    ['Name', resolved.displayNameSource === 'character-sheet' ? resolved.displayName : activeIdentity.status === 'ready' ? activeIdentity.identity.displayName : resolved.displayName],
    ['Age', resolved.age],
    ['Gender', resolved.gender],
    ['Occupation', resolved.occupation],
    ['City', resolved.city],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]))

  return (
    <section className="net-universal-profile" aria-labelledby="net-profile-title">
      <header className="net-universal-profile__header">
        <div>
          <h2 id="net-profile-title">Profile</h2>
          <p>Presentation defaults for THE NET. Application accounts retain their own handles and settings.</p>
        </div>
        <span className="net-universal-profile__service">SYNCED TO IDENTITY</span>
      </header>

      <section className="net-universal-profile__preview" aria-label="Profile preview">
        <div className="net-universal-profile__portrait" data-source={resolved.avatarSource}>
          {resolved.avatarUrl ? <SharedMediaImage source={resolved.avatarUrl} variant="thumbnail" alt={`${resolved.displayName} portrait`} /> : <span>{initials(resolved.displayName)}</span>}
        </div>
        <div className="net-universal-profile__preview-copy">
          <span>Profile preview</span>
          <strong>{resolved.displayName}</strong>
          {resolved.status ? <em>{resolved.status}</em> : <em>NO STATUS SET</em>}
          {resolved.bio ? <p>{resolved.bio}</p> : <p>No NET bio set.</p>}
        </div>
      </section>

      <section className="net-universal-profile__section">
        <div className="net-universal-profile__section-heading">
          <h3>Base identity</h3>
          <span>SOURCE: CHARACTER SHEET</span>
        </div>
        <dl className="net-universal-profile__facts">
          {sheetFacts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="net-universal-profile__section">
        <div className="net-universal-profile__section-heading">
          <h3>NET profile</h3>
          <span>SHARED DEFAULTS</span>
        </div>

        <div className="net-universal-profile__fields">
          <label>
            <span>Display name override</span>
            <input
              value={draft.displayNameOverride}
              maxLength={40}
              onChange={(event) => updateDraft((current) => ({ ...current, displayNameOverride: event.target.value }))}
              aria-invalid={displayNameInvalid || undefined}
              placeholder="Use character-sheet name"
            />
            <small>{draft.displayNameOverride.trim() ? 'NET OVERRIDE' : 'USING CHARACTER SHEET'}</small>
            {draft.displayNameOverride ? (
              <button
                type="button"
                className="net-universal-profile__field-reset"
                onClick={() => updateDraft((current) => ({ ...current, displayNameOverride: '' }))}
                disabled={controller.saving}
              >
                USE CHARACTER NAME
              </button>
            ) : null}
          </label>

          <label>
            <span>Status</span>
            <input
              value={draft.status}
              maxLength={100}
              onChange={(event) => updateDraft((current) => ({ ...current, status: event.target.value }))}
              aria-invalid={statusInvalid || undefined}
              placeholder="Optional general status"
            />
            <small>{draft.status.length}/100</small>
          </label>

          <label className="net-universal-profile__bio-field">
            <span>Bio</span>
            <textarea
              value={draft.bio}
              maxLength={240}
              rows={4}
              onChange={(event) => updateDraft((current) => ({ ...current, bio: event.target.value }))}
              aria-invalid={bioInvalid || undefined}
              placeholder="Optional NET profile bio"
            />
            <small>{draft.bio.length}/240</small>
          </label>
        </div>

        <div className="net-universal-profile__avatar-source">
          <div>
            <strong>Avatar source</strong>
            <span>{profile?.avatarUrlOverride
              ? 'NET OVERRIDE'
              : resolved.avatarSource === 'fallback'
                ? 'INITIALS FALLBACK'
                : 'CHARACTER SHEET PHOTO'}</span>
          </div>
          <div>
            <label>
              <span>{avatarUpload === 'processing' ? 'PROCESSING IMAGE…' : profile?.avatarUrlOverride ? 'REPLACE NET AVATAR' : 'UPLOAD NET AVATAR'}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                disabled={controller.saving || avatarUpload !== 'idle'}
                className="sr-only"
                onChange={(event) => {
                  void uploadAvatar(event.target.files?.[0])
                  event.target.value = ''
                }}
              />
            </label>
            {profile?.avatarUrlOverride ? (
              <button
                type="button"
                onClick={() => updateDraft((current) => ({ ...current, avatarUrlOverride: '' }))}
                disabled={controller.saving}
              >
                USE CHARACTER PHOTO
              </button>
            ) : null}
          </div>
        </div>

        {avatarUploadError ? <p className="net-universal-profile__error" role="alert">{avatarUploadError}</p> : null}

        {invalid ? (
          <p className="net-universal-profile__error" role="alert">
            Keep display name within 40 characters, bio within 240, and status within 100.
          </p>
        ) : null}
        {controller.error ? <p className="net-universal-profile__error" role="alert">{controller.error}</p> : null}
        {saveNotice?.identityLinkId === identityLinkId ? (
          <p className="net-universal-profile__notice" role="status">{saveNotice.text}</p>
        ) : null}

        <div className="net-universal-profile__actions">
          <button
            type="button"
            onClick={() => {
              setSaveNotice(null)
              setDraft(sourceDraft)
            }}
            disabled={!isDirty || controller.saving}
          >
            RESET CHANGES
          </button>
          <button
            type="button"
            className="net-universal-profile__save"
            onClick={() => { void save() }}
            disabled={!isDirty || invalid || controller.saving}
          >
            {controller.saving ? 'SAVING…' : 'SAVE NET PROFILE'}
          </button>
        </div>
      </section>
    </section>
  )
}
