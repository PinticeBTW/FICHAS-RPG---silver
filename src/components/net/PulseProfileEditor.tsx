import { Check, ChevronLeft } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import type {
  NetPulseProfile,
  NetPulsePublicProfileInput,
} from '../../lib/netPulseProfileService'
import { normalizeNetHandle } from './accounts/netAppAccountSelectors'

interface PulseProfileEditorProps {
  readonly profile: NetPulseProfile
  readonly saving: boolean
  readonly compromised?: boolean
  readonly onSave: (input: NetPulsePublicProfileInput) => Promise<void>
  readonly onCancel: () => void
}

function toInput(profile: NetPulseProfile): NetPulsePublicProfileInput {
  return {
    handle: profile.handle,
    bio: profile.bio,
    visibility: profile.visibility,
    showDistrict: profile.showDistrict,
    discoverable: profile.discoverable,
    defaultFeed: profile.defaultFeed,
  }
}

export function PulseProfileEditor({
  profile,
  saving,
  compromised = false,
  onSave,
  onCancel,
}: PulseProfileEditorProps) {
  const [draft, setDraft] = useState<NetPulsePublicProfileInput>(() => toInput(profile))
  const [error, setError] = useState<string | null>(null)
  const [remoteChanged, setRemoteChanged] = useState(false)
  const baselineRef = useRef<NetPulsePublicProfileInput>(toInput(profile))
  const draftRef = useRef(draft)
  const titleId = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => { titleRef.current?.focus() }, [])
  draftRef.current = draft
  useEffect(() => {
    const next = toInput(profile)
    const hasLocalChanges = JSON.stringify(draftRef.current) !== JSON.stringify(baselineRef.current)
    if (hasLocalChanges) {
      baselineRef.current = next
      setRemoteChanged(true)
      return
    }
    baselineRef.current = next
    setDraft(next)
    setError(null)
    setRemoteChanged(false)
  }, [profile])

  const normalizedHandle = normalizeNetHandle(draft.handle)
  const normalizedDraft = useMemo(() => ({
    ...draft,
    handle: normalizeNetHandle(draft.handle) ?? draft.handle.trim(),
    bio: draft.bio.trim(),
  }), [draft])
  const dirty = JSON.stringify(normalizedDraft) !== JSON.stringify(baselineRef.current)
  const rawHandle = draft.handle.trim().replace(/^@+/, '')
  const handleError = rawHandle.length > 32
    ? 'Keep the handle to 32 characters or fewer.'
    : !normalizedHandle
      ? 'Use letters, numbers, periods, underscores, or hyphens.'
      : null
  const bioError = draft.bio.length > 240 ? 'PULSE bios are limited to 240 characters.' : null

  const submit = async () => {
    if (bioError || handleError || !normalizedHandle || !dirty || saving) return
    setError(null)
    try {
      await onSave({ ...normalizedDraft, handle: normalizedHandle })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'PULSE profile could not be saved.')
    }
  }

  return (
    <section className="pulse-profile-editor" data-compromised={compromised ? 'true' : 'false'} aria-labelledby={titleId} aria-busy={saving}>
      <header className="pulse-profile-editor__head">
        <button type="button" onClick={onCancel} disabled={saving}>
          <ChevronLeft size={14} /> Profile
        </button>
        <div>
          <h2 id={titleId} ref={titleRef} tabIndex={-1}>{compromised ? 'CONTROL PUBLIC PROFILE' : 'EDIT PUBLIC PROFILE'}</h2>
          <p>{compromised ? 'Compromised-session changes are server-authorised and audit logged.' : 'Display identity and PULSE address remain separate.'}</p>
        </div>
      </header>

      <div className="pulse-profile-editor__fields">
        <label htmlFor="pulse-profile-handle">
          PULSE handle
          <span className="pulse-profile-editor__handle" data-invalid={handleError ? 'true' : 'false'}>
            <b>@</b>
            <input
              id="pulse-profile-handle"
              value={draft.handle}
              maxLength={32}
              autoComplete="off"
              onChange={(event) => setDraft((current) => ({
                ...current,
                handle: event.target.value.replace(/^@+/, ''),
              }))}
              aria-invalid={Boolean(handleError)}
              aria-describedby={handleError ? 'pulse-profile-handle-error' : 'pulse-profile-handle-hint'}
            />
          </span>
          {handleError
            ? <small id="pulse-profile-handle-error" className="pulse-profile-editor__inline-error" role="alert">{handleError}</small>
            : <small id="pulse-profile-handle-hint">Stored as @{normalizedHandle}. Availability is confirmed on save.</small>}
        </label>

        <label htmlFor="pulse-profile-bio">
          Public bio
          <textarea
            id="pulse-profile-bio"
            rows={4}
            maxLength={241}
            value={draft.bio}
            onChange={(event) => setDraft((current) => ({ ...current, bio: event.target.value }))}
            aria-invalid={Boolean(bioError)}
            aria-describedby={bioError ? 'pulse-profile-bio-error' : 'pulse-profile-bio-count'}
          />
          <small id="pulse-profile-bio-count">{draft.bio.length} / 240</small>
        </label>
        {bioError ? <p id="pulse-profile-bio-error" className="pulse-profile-editor__error" role="alert">{bioError}</p> : null}

        <fieldset>
          <legend>Profile visibility</legend>
          <label>
            <input type="radio" name="pulse-profile-visibility" checked={draft.visibility === 'public'} onChange={() => setDraft((current) => ({ ...current, visibility: 'public' }))} />
            <span><strong>Public</strong><small>Visible in PULSE account discovery and public references.</small></span>
          </label>
          <label>
            <input type="radio" name="pulse-profile-visibility" checked={draft.visibility === 'limited'} onChange={() => setDraft((current) => ({ ...current, visibility: 'limited' }))} />
            <span><strong>Limited</strong><small>Public identity remains visible where a Pulse directly references it.</small></span>
          </label>
        </fieldset>

        <fieldset>
          <legend>Public signals</legend>
          <label>
            <input type="checkbox" checked={draft.showDistrict} onChange={(event) => setDraft((current) => ({ ...current, showDistrict: event.target.checked }))} />
            <span><strong>Show district</strong><small>Allow PULSE to present district context when available.</small></span>
          </label>
          <label>
            <input type="checkbox" checked={draft.discoverable} onChange={(event) => setDraft((current) => ({ ...current, discoverable: event.target.checked }))} />
            <span><strong>Allow account discovery</strong><small>Let PULSE search surface this public profile.</small></span>
          </label>
        </fieldset>

        <fieldset>
          <legend>Default feed</legend>
          <div className="pulse-profile-editor__feed">
            {(['city', 'following', 'raw'] as const).map((feed) => (
              <label key={feed}>
                <input type="radio" name="pulse-profile-feed" checked={draft.defaultFeed === feed} onChange={() => setDraft((current) => ({ ...current, defaultFeed: feed }))} />
                <span>{feed}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {remoteChanged ? <p className="pulse-profile-editor__remote" role="status">SERVER PROFILE CHANGED // YOUR UNSAVED DRAFT IS PRESERVED</p> : null}
      {error ? <p className="pulse-profile-editor__error" role="alert">{error}</p> : null}
      <footer className="pulse-profile-editor__actions">
        <span role="status" aria-live="polite">{saving ? 'SAVING PUBLIC PROFILE' : dirty ? 'UNSAVED CHANGES' : 'PROFILE SYNCHRONIZED'}</span>
        <button type="button" onClick={() => { void submit() }} disabled={saving || !dirty || Boolean(bioError) || Boolean(handleError)}>
          <Check size={14} /> {saving ? 'Saving…' : compromised ? 'Apply controlled update' : 'Save profile'}
        </button>
      </footer>
    </section>
  )
}
