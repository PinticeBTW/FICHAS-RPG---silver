import { useMemo } from 'react'

import type { Profile } from '../../../types/domain'
import { resolveNetIdentity } from './netIdentityResolver'
import { createProfileSheetNetIdentitySubject } from './netIdentitySelectors'
import type {
  NetPlayableIdentityCandidate,
  NetPlayableIdentityCandidateState,
  NetResolvedIdentity,
} from './netIdentityTypes'

export type NetActiveIdentityState =
  | {
      readonly status: 'ready'
      readonly authenticatedProfileId: string
      readonly identity: NetResolvedIdentity
      readonly source: 'automatic' | 'explicit'
    }
  | { readonly status: 'gm-no-persona'; readonly authenticatedProfileId: string }
  | {
      readonly status: 'selection-required'
      readonly authenticatedProfileId: string
      readonly reason: string
    }
  | { readonly status: 'no-identity'; readonly reason: string }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly reason: string }

/**
 * Current policy is deliberately conservative: a player resolves only their
 * own profile-sheet. Shared or owned NPC cards never become a silent primary
 * NET identity. A future server-backed selection may provide an explicit one.
 */
export function resolveNetActiveIdentity(
  profile: Profile | null,
  isAuthLoading = false,
  candidates?: NetPlayableIdentityCandidateState,
): NetActiveIdentityState {
  if (isAuthLoading) return { status: 'loading' }

  if (!profile) {
    return { status: 'no-identity', reason: 'No authenticated profile is available.' }
  }

  if (profile.role === 'gm') {
    return { status: 'gm-no-persona', authenticatedProfileId: profile.id }
  }

  if (candidates?.status === 'loading') return { status: 'loading' }

  if (candidates?.status === 'error') {
    return { status: 'error', reason: candidates.reason }
  }

  try {
    const candidate = candidates?.status === 'ready'
      ? candidates.currentProfileCandidate
      : undefined
    if (candidate && candidate.summaryStatus !== 'ready') return { status: 'loading' }
    const subject = candidate?.subject.kind === 'profile-sheet'
      ? candidate.subject
      : createProfileSheetNetIdentitySubject(profile.id)
    const hasSheetCharacterName = candidate?.displayNameSource === 'sheet'
    const resolution = resolveNetIdentity({
      authenticatedProfile: profile,
      subject,
      profileSheet: {
        id: profile.id,
        role: profile.role,
        displayName: candidate?.displayName ?? profile.displayName,
        ...(candidate?.avatarUrl ? { avatarUrl: candidate.avatarUrl } : {}),
        // A site handle is only a fallback before a sheet supplies a fictional
        // character name. Character sheets currently have no handle field.
        ...(!hasSheetCharacterName && profile.handle ? { handle: profile.handle } : {}),
      },
    })

    if (resolution.status === 'resolved') {
      return {
        status: 'ready',
        authenticatedProfileId: profile.id,
        identity: resolution.identity,
        source: 'automatic',
      }
    }

    return {
      status: 'no-identity',
      reason: resolution.status === 'inaccessible'
        ? resolution.reason
        : 'No safe player identity is available.',
    }
  } catch {
    return {
      status: 'error',
      reason: 'The current player identity could not be resolved.',
    }
  }
}

/**
 * Resolves a server-authorised subject from its compact, already-authorised
 * candidate data. The identity link supplies only qualification metadata; it
 * never replaces the source sheet as the character-profile source.
 */
export function resolveNetActiveIdentityCandidate(input: {
  readonly profile: Profile
  readonly candidate: NetPlayableIdentityCandidate
  readonly source: 'automatic' | 'explicit'
  readonly identityLinkId?: string
  readonly entityId?: import('../world/netWorldTypes').NetEntityId
  readonly identityKind?: 'player' | 'npc'
}): NetActiveIdentityState {
  const { profile, candidate } = input

  if (profile.role === 'gm') {
    return { status: 'gm-no-persona', authenticatedProfileId: profile.id }
  }

  // A failed or delayed sheet summary is not evidence that the authenticated
  // account name is the character name. Wait for the authorised source.
  if (candidate.summaryStatus !== 'ready') return { status: 'loading' }

  const sheetHandle = candidate.sourceKind === 'profile-sheet'
    && candidate.displayNameSource !== 'sheet'
    ? profile.handle
    : undefined

  const resolution = resolveNetIdentity({
    authenticatedProfile: profile,
    subject: candidate.subject,
    identityKind: input.identityKind,
    ...(input.entityId ? { worldEntityId: input.entityId } : {}),
    ...(candidate.subject.kind === 'profile-sheet'
      ? {
          profileSheet: {
            id: candidate.subject.profileId,
            role: profile.role,
            displayName: candidate.displayName,
            ...(candidate.avatarUrl ? { avatarUrl: candidate.avatarUrl } : {}),
            ...(sheetHandle ? { handle: sheetHandle } : {}),
          },
        }
      : {}),
    ...(candidate.subject.kind === 'npc-card'
      ? {
          npcCard: {
            id: candidate.subject.npcCardId,
            displayName: candidate.displayName,
            ...(candidate.avatarUrl ? { avatarUrl: candidate.avatarUrl } : {}),
            ...(candidate.ownerProfileId ? { ownerProfileId: candidate.ownerProfileId } : {}),
            ...(candidate.campaignId ? { campaignId: candidate.campaignId } : {}),
          },
        }
      : {}),
    ...(candidate.subject.kind === 'character'
      ? {
          character: {
            id: candidate.subject.characterId,
            name: candidate.displayName,
            alias: candidate.alias ?? '',
            portraitUrl: candidate.avatarUrl ?? '',
            ownerProfileId: candidate.ownerProfileId ?? '',
            campaignId: candidate.campaignId ?? '',
            ...(input.identityKind ? { identityKind: input.identityKind } : {}),
          },
        }
      : {}),
  })

  if (resolution.status !== 'resolved') {
    return {
      status: 'no-identity',
      reason: resolution.status === 'inaccessible'
        ? resolution.reason
        : 'The selected fictional identity is unavailable.',
    }
  }

  return {
    status: 'ready',
    authenticatedProfileId: profile.id,
    identity: {
      ...resolution.identity,
      ...(input.identityLinkId ? { identityLinkId: input.identityLinkId } : {}),
    },
    source: input.source,
  }
}

/**
 * A presentation/readiness signal only. It is not server-side authorization.
 */
export function canActiveIdentityAuthorContent(
  state: NetActiveIdentityState,
): boolean {
  return state.status === 'ready' && state.identity.authoringStatus === 'identity-ready'
}

/**
 * No active identity is persisted yet. The value is derived from the current
 * auth profile each render, preventing a prior account identity from flashing.
 */
export function useNetActiveIdentity(
  profile: Profile | null,
  isAuthLoading = false,
  candidates?: NetPlayableIdentityCandidateState,
): NetActiveIdentityState {
  return useMemo(
    () => resolveNetActiveIdentity(profile, isAuthLoading, candidates),
    [candidates, isAuthLoading, profile],
  )
}
