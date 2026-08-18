import { useCallback, useEffect, useRef, useState } from 'react'

import {
  fetchNetAppIdentityProfileEditor,
  resolveNetAppProfileAvatarUrls,
  saveNetAppIdentityPresentation,
  type NetAppIdentityProfile,
} from '../../../lib/netAppIdentityPresentationService'
import { removeSharedMediaReference, uploadSharedImage } from '../../../lib/media/mediaStorage'

export type NetAppProfileState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready'
      readonly profile: NetAppIdentityProfile
      readonly effectiveAvatarUrl?: string
      readonly canonicalAvatarUrl?: string
    }
  | { readonly status: 'identity-required' }
  | { readonly status: 'error'; readonly reason: string }

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

/**
 * One small controller reused by every app's embedded APP PROFILE editor.
 * Avatar replacement follows the same upload -> commit -> clean-up-old (or
 * roll-back-new-on-failure) shape already established for shared media
 * elsewhere in this codebase (e.g. ALTARA/VOX AUDIO artwork replacement):
 * the new object is uploaded first, the DB row is the atomic commit point,
 * and only the object no longer referenced afterward is removed.
 */
export function useNetAppIdentityPresentation({
  appId,
  expectedIdentityLinkId,
  onSaved,
}: {
  readonly appId: string
  readonly expectedIdentityLinkId?: string
  readonly onSaved?: () => void
}) {
  const [state, setState] = useState<NetAppProfileState>({ status: 'idle' })
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generationRef = useRef(0)

  const load = useCallback(async () => {
    if (!expectedIdentityLinkId) {
      setState({ status: 'identity-required' })
      return
    }
    generationRef.current += 1
    const generation = generationRef.current
    setState({ status: 'loading' })
    setError(null)
    try {
      const profile = await fetchNetAppIdentityProfileEditor(appId, expectedIdentityLinkId)
      const resolved = await resolveNetAppProfileAvatarUrls(profile)
      if (generationRef.current !== generation) return
      setState({ status: 'ready', profile, ...resolved })
    } catch (loadError) {
      if (generationRef.current !== generation) return
      setState({ status: 'error', reason: errorMessage(loadError, 'APP PROFILE could not load.') })
    }
  }, [appId, expectedIdentityLinkId])

  useEffect(() => {
    void load()
  }, [load])

  const applySave = useCallback(async (displayName: string, avatarRef: string) => {
    if (!expectedIdentityLinkId || saving) return false
    const generation = generationRef.current
    const previousAvatarRef = state.status === 'ready' ? state.profile.customAvatarRef : undefined
    setSaving(true)
    setError(null)
    try {
      const profile = await saveNetAppIdentityPresentation(appId, expectedIdentityLinkId, displayName, avatarRef)
      if (generationRef.current !== generation) return false
      const resolved = await resolveNetAppProfileAvatarUrls(profile)
      if (generationRef.current !== generation) return false
      setState({ status: 'ready', profile, ...resolved })
      // Best-effort: the previous custom avatar object is only ever removed
      // once the new state is durably saved, and only when it is no longer
      // referenced by the saved row -- never blocks the visible save.
      if (previousAvatarRef && previousAvatarRef !== profile.customAvatarRef) {
        void removeSharedMediaReference(previousAvatarRef).catch(() => {
          // A stray orphaned object is a private-storage cost only, never a
          // correctness or security issue; the reference is already gone.
        })
      }
      onSaved?.()
      return true
    } catch (saveError) {
      if (generationRef.current === generation) setError(errorMessage(saveError, 'APP PROFILE could not be saved.'))
      return false
    } finally {
      if (generationRef.current === generation) setSaving(false)
    }
  }, [appId, expectedIdentityLinkId, onSaved, saving, state])

  const uploadAvatar = useCallback(async (file: File): Promise<string | null> => {
    setUploading(true)
    setError(null)
    let reference: string | undefined
    try {
      const uploaded = await uploadSharedImage(
        { subjectKind: 'universal-profile', subjectId: expectedIdentityLinkId ?? '', mediaKind: 'avatar', slot: appId },
        file,
        'avatar',
      )
      reference = uploaded.reference
      return reference
    } catch (uploadError) {
      setError(errorMessage(uploadError, 'Photo upload failed.'))
      return null
    } finally {
      setUploading(false)
    }
  }, [appId, expectedIdentityLinkId])

  /** Rolls back a freshly uploaded (but never saved) avatar reference. */
  const discardUpload = useCallback((reference: string) => {
    void removeSharedMediaReference(reference).catch(() => undefined)
  }, [])

  const reset = useCallback(() => applySave('', ''), [applySave])

  return {
    state,
    saving,
    uploading,
    error,
    reload: load,
    save: applySave,
    reset,
    uploadAvatar,
    discardUpload,
  }
}
