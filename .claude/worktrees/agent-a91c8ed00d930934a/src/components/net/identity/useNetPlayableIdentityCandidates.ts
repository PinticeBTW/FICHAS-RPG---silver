import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Profile } from '../../../types/domain'
import { fetchCampaignBundle } from '../../../lib/dataService'
import {
  clearNetGmIdentityDirectoryCache,
  fetchNetGmIdentityDirectory,
} from '../../../lib/netGmIdentityDirectoryService'
import {
  fetchSheetSummaryBatch,
  listSheetProfiles,
  type SheetSummaryRecord,
} from '../../../lib/webSheetService'
import {
  createCampaignCharacterIdentityCandidate,
  createNpcCardIdentityCandidate,
  createProfileSheetIdentityCandidate,
} from './netPlayableIdentityCandidates'
import type {
  NetPlayableIdentityCandidate,
  NetPlayableIdentityCandidateState,
} from './netIdentityTypes'

const SUMMARY_RETRY_DELAY_MS = 700
const SUMMARY_RETRY_ATTEMPTS = 1
const GM_DIRECTORY_RETRY_DELAY_MS = 900

type SummaryCacheEntry = SheetSummaryRecord | null

function sortCandidates(
  left: NetPlayableIdentityCandidate,
  right: NetPlayableIdentityCandidate,
) {
  if (left.accessKind === 'self-profile') return -1
  if (right.accessKind === 'self-profile') return 1
  return left.displayName.localeCompare(right.displayName)
}

function loadingState(
  profile: Profile | null,
  authLoading: boolean,
): NetPlayableIdentityCandidateState {
  if (authLoading) return { status: 'loading' }
  if (!profile) {
    return {
      status: 'error',
      authenticatedProfileId: '',
      reason: 'No authenticated profile is available.',
    }
  }
  return { status: 'loading' }
}

function profileKey(profile: Pick<Profile, 'id' | 'sheetSource'>) {
  return `${profile.sheetSource === 'npc' ? 'npc-card' : 'profile-sheet'}:${profile.id}`
}

function sleep(delayMs: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, delayMs))
}

/**
 * Loads compact Sheet Workspace facts through bounded authorised queries. A
 * failed request remains an explicit unresolved candidate; it never changes a
 * fictional character into the site's account display name.
 */
export function useNetPlayableIdentityCandidates(
  profile: Profile | null,
  authLoading = false,
): NetPlayableIdentityCandidateState {
  const [state, setState] = useState<NetPlayableIdentityCandidateState>(
    () => loadingState(profile, authLoading),
  )
  const cacheRef = useRef(new Map<string, SummaryCacheEntry>())
  const cacheOwnerRef = useRef<string | null>(profile?.id ?? null)
  const confirmedGmCandidatesRef = useRef<{
    readonly profileId: string
    readonly candidates: readonly NetPlayableIdentityCandidate[]
  } | null>(null)
  const [retryToken, setRetryToken] = useState(0)
  const retry = useCallback(() => setRetryToken((token) => token + 1), [])

  useEffect(() => {
    let cancelled = false
    if (cacheOwnerRef.current !== (profile?.id ?? null)) {
      if (cacheOwnerRef.current) clearNetGmIdentityDirectoryCache(cacheOwnerRef.current)
      cacheOwnerRef.current = profile?.id ?? null
      cacheRef.current.clear()
      confirmedGmCandidatesRef.current = null
    }

    if (authLoading) {
      setState({ status: 'loading' })
      return () => { cancelled = true }
    }

    if (!profile) {
      setState({
        status: 'error',
        authenticatedProfileId: '',
        reason: 'No authenticated profile is available.',
      })
      return () => { cancelled = true }
    }

    const expectedProfileId = profile.id
    const confirmedGmCandidates = confirmedGmCandidatesRef.current?.profileId === expectedProfileId
      ? confirmedGmCandidatesRef.current.candidates
      : null

    if (profile.role === 'gm') {
      if (confirmedGmCandidates) {
        setState({
          status: 'ready',
          authenticatedProfileId: expectedProfileId,
          candidates: confirmedGmCandidates,
          warning: 'Refreshing the authorised identity directory.',
        })
      } else {
        setState({ status: 'loading' })
      }

      const loadGmDirectory = async () => {
        try {
          return await fetchNetGmIdentityDirectory(expectedProfileId, { force: retryToken > 0 })
        } catch {
          await sleep(GM_DIRECTORY_RETRY_DELAY_MS)
          if (cancelled) return null
          return fetchNetGmIdentityDirectory(expectedProfileId, { force: true })
        }
      }

      void loadGmDirectory()
        .then((candidates) => {
          if (!candidates || cancelled || cacheOwnerRef.current !== expectedProfileId) return
          confirmedGmCandidatesRef.current = { profileId: expectedProfileId, candidates }
          setState({
            status: 'ready',
            authenticatedProfileId: expectedProfileId,
            candidates,
          })
        })
        .catch(() => {
          if (cancelled || cacheOwnerRef.current !== expectedProfileId) return
          if (confirmedGmCandidates) {
            setState({
              status: 'ready',
              authenticatedProfileId: expectedProfileId,
              candidates: confirmedGmCandidates,
              warning: 'The identity directory could not refresh. Confirmed identities remain available.',
            })
            return
          }
          setState({
            status: 'error',
            authenticatedProfileId: expectedProfileId,
            reason: 'The authorised GM identity directory is temporarily unavailable.',
          })
        })

      return () => { cancelled = true }
    }

    setState({ status: 'loading' })

    const loadSummaries = async (entries: readonly Profile[]) => {
      const records = new Map<string, SummaryCacheEntry>()
      const unresolved = new Set<string>()
      const missing = entries.filter((entry) => {
        const key = profileKey(entry)
        const cached = cacheRef.current.get(key)
        if (cached !== undefined) {
          records.set(entry.id, cached)
          return false
        }
        return true
      })

      if (missing.length) {
        const batch = await fetchSheetSummaryBatch(missing)
        for (const [id, summary] of batch.summaries) {
          records.set(id, summary)
          const entry = entries.find((candidate) => candidate.id === id)
          if (entry) cacheRef.current.set(profileKey(entry), summary)
        }
        for (const id of batch.unavailableProfileIds) unresolved.add(id)
      }

      return { records, unresolved }
    }

    const publish = (
      entries: readonly Profile[],
      summaries: ReadonlyMap<string, SummaryCacheEntry>,
      unresolved: ReadonlySet<string>,
      campaignCandidates: readonly NetPlayableIdentityCandidate[],
      retrying: boolean,
    ) => {
      const candidates = entries.map((entry) => {
        const summaryStatus = unresolved.has(entry.id) ? 'unavailable' as const : 'ready' as const
        return entry.sheetSource === 'npc'
          ? createNpcCardIdentityCandidate(entry, summaries.get(entry.id), profile.role === 'gm' ? 'gm' : 'owner', profile.role === 'gm' ? 'not-playable' : 'candidate', summaryStatus)
          : createProfileSheetIdentityCandidate(entry, summaries.get(entry.id), profile.role === 'gm' ? 'gm' : 'self-profile', profile.role === 'gm' ? 'not-playable' : 'confirmed', summaryStatus)
      })
      candidates.push(...campaignCandidates)
      candidates.sort(sortCandidates)

      const currentProfileCandidate = candidates.find((candidate) => (
        candidate.subject.kind === 'profile-sheet' && candidate.subject.profileId === profile.id
      ))

      if (!cancelled) {
        setState({
          status: 'ready',
          authenticatedProfileId: expectedProfileId,
          candidates,
          ...(currentProfileCandidate ? { currentProfileCandidate } : {}),
          ...(unresolved.size
            ? { warning: retrying
              ? 'Some character identities are temporarily unavailable. Retrying authorised summaries.'
              : 'Some character identities are temporarily unavailable.' }
            : {}),
        })
      }
    }

    const load = async () => {
      const directory = await listSheetProfiles(profile)
      if (cancelled) return

      const entries = profile.role === 'player'
        ? [
            profile,
            ...directory.filter((entry) => entry.sheetSource === 'npc' && entry.ownerProfileId === profile.id),
          ]
        : directory.filter((entry) => entry.sheetSource === 'npc' || entry.role === 'player')
      const uniqueEntries = [...new Map(entries.map((entry) => [profileKey(entry), entry])).values()]

      let campaignCandidates: readonly NetPlayableIdentityCandidate[] = []
      if (profile.role === 'player') {
        try {
          const campaignBundle = await fetchCampaignBundle(profile)
          campaignCandidates = campaignBundle.characters.map((character) => (
            createCampaignCharacterIdentityCandidate(character, 'owner')
          ))
        } catch {
          // Campaign characters remain optional compatibility candidates.
        }
      }

      const { records, unresolved: initialUnresolved } = await loadSummaries(uniqueEntries)
      let unresolved = initialUnresolved
      if (cancelled) return
      publish(uniqueEntries, records, unresolved, campaignCandidates, unresolved.size > 0)

      for (let attempt = 0; attempt < SUMMARY_RETRY_ATTEMPTS && unresolved.size; attempt += 1) {
        await sleep(SUMMARY_RETRY_DELAY_MS)
        if (cancelled) return
        const retryEntries = uniqueEntries.filter((entry) => unresolved.has(entry.id))
        const retry = await fetchSheetSummaryBatch(retryEntries)
        if (cancelled) return
        for (const [id, summary] of retry.summaries) {
          records.set(id, summary)
          const entry = uniqueEntries.find((candidate) => candidate.id === id)
          if (entry) cacheRef.current.set(profileKey(entry), summary)
        }
        unresolved = new Set(retry.unavailableProfileIds)
        publish(
          uniqueEntries,
          records,
          unresolved,
          campaignCandidates,
          unresolved.size > 0 && attempt + 1 < SUMMARY_RETRY_ATTEMPTS,
        )
      }
    }

    void load().catch(() => {
      if (!cancelled) {
        setState({
          status: 'error',
          authenticatedProfileId: expectedProfileId,
          reason: 'Character identities could not be loaded through the authorised sheet directory.',
        })
      }
    })

    return () => { cancelled = true }
  }, [authLoading, profile?.id, profile?.role, retryToken])

  return useMemo(() => {
    if (!profile || state.status === 'loading') return state
    if (state.authenticatedProfileId !== profile.id) return { status: 'loading' }
    return { ...state, retry }
  }, [profile?.id, profile, retry, state])
}
