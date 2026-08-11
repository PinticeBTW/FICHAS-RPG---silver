import type { NetActiveIdentityState } from '../identity/netActiveIdentity'
import type {
  NetResolvedUniversalProfile,
  NetUniversalProfileBase,
  NetUniversalProfileResolutionInput,
  NetUniversalProfileState,
} from './netUniversalProfileTypes'

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

/**
 * Sheet candidate facts remain authoritative. This resolver overlays only the
 * small, server-backed presentation fields that belong to Universal NET Profile.
 */
export function resolveUniversalNetProfile(
  input: NetUniversalProfileResolutionInput,
): NetResolvedUniversalProfile {
  const { activeIdentity, candidate, identityLinkId, profile } = input
  const displayName = nonEmpty(profile?.displayNameOverride)
    ?? candidate?.displayName
    ?? activeIdentity.identity.displayName
  const avatarUrl = nonEmpty(profile?.avatarUrlOverride)
    ?? candidate?.avatarUrl
    ?? activeIdentity.identity.avatarUrl

  return {
    identityLinkId,
    displayName,
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(candidate?.age ? { age: candidate.age } : {}),
    ...(candidate?.gender ? { gender: candidate.gender } : {}),
    ...(candidate?.occupation ? { occupation: candidate.occupation } : {}),
    ...(candidate?.city ? { city: candidate.city } : {}),
    ...(nonEmpty(profile?.bio) ? { bio: nonEmpty(profile?.bio) } : {}),
    ...(nonEmpty(profile?.status) ? { status: nonEmpty(profile?.status) } : {}),
    displayNameSource: nonEmpty(profile?.displayNameOverride)
      ? 'net-override'
      : 'character-sheet',
    avatarSource: nonEmpty(profile?.avatarUrlOverride)
      ? 'net-override'
      : candidate?.avatarUrl || activeIdentity.identity.avatarUrl
        ? 'character-sheet'
        : 'fallback',
  }
}

export function getUniversalProfileBase(
  state: Extract<NetUniversalProfileState, { readonly status: 'ready' }>,
): NetUniversalProfileBase {
  const { resolved } = state
  return {
    identityLinkId: resolved.identityLinkId,
    displayName: resolved.displayName,
    ...(resolved.avatarUrl ? { avatarUrl: resolved.avatarUrl } : {}),
    ...(resolved.age ? { age: resolved.age } : {}),
    ...(resolved.gender ? { gender: resolved.gender } : {}),
    ...(resolved.occupation ? { occupation: resolved.occupation } : {}),
    ...(resolved.city ? { city: resolved.city } : {}),
  }
}

/** Applies presentation only; fictional subject, owner, and World Core link stay untouched. */
export function applyUniversalNetProfilePresentation(
  activeIdentity: NetActiveIdentityState,
  state: NetUniversalProfileState,
): NetActiveIdentityState {
  if (activeIdentity.status !== 'ready' || state.status !== 'ready') return activeIdentity

  return {
    ...activeIdentity,
    identity: {
      ...activeIdentity.identity,
      displayName: state.resolved.displayName,
      ...(state.resolved.avatarUrl ? { avatarUrl: state.resolved.avatarUrl } : {}),
    },
  }
}
