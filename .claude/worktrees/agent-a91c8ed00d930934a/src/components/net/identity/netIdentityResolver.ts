import type {
  NetIdentityAuthoringStatus,
  NetIdentityResolution,
  NetIdentityResolutionInput,
  NetResolvedIdentity,
} from './netIdentityTypes'

function authoringStatus(
  authenticatedProfileId: string,
  ownerProfileId: string | undefined,
): NetIdentityAuthoringStatus {
  return ownerProfileId === authenticatedProfileId
    ? 'identity-ready'
    : 'view-only'
}

function resolved(
  identity: Omit<NetResolvedIdentity, 'worldLinkStatus'>,
): NetIdentityResolution {
  return {
    status: 'resolved',
    identity: {
      ...identity,
      worldLinkStatus: identity.worldEntityId ? 'linked' : 'unlinked',
    },
  }
}

/**
 * Pure resolution for records the caller has already loaded through an
 * authorised flow. It performs no Supabase request and grants no authority.
 */
export function resolveNetIdentity(
  input: NetIdentityResolutionInput,
): NetIdentityResolution {
  const { authenticatedProfile, subject, worldEntityId } = input

  if (!subject) return { status: 'no-character' }
  if (!authenticatedProfile) {
    return { status: 'inaccessible', reason: 'No authenticated profile is available.' }
  }

  switch (subject.kind) {
    case 'profile-sheet': {
      const record = input.profileSheet
      if (!record || record.id !== subject.profileId) {
        return { status: 'inaccessible', reason: 'The requested profile sheet was not supplied.' }
      }

      return resolved({
        subject,
        identityKind: input.identityKind ?? 'player',
        displayName: record.displayName,
        ...(record.handle ? { defaultHandle: record.handle } : {}),
        ...(record.avatarUrl ? { avatarUrl: record.avatarUrl } : {}),
        ownerProfileId: record.id,
        ...(worldEntityId ? { worldEntityId } : {}),
        authoringStatus: authoringStatus(authenticatedProfile.id, record.id),
      })
    }

    case 'npc-card': {
      const record = input.npcCard
      if (!record || record.id !== subject.npcCardId) {
        return { status: 'inaccessible', reason: 'The requested NPC card was not supplied.' }
      }

      return resolved({
        subject,
        identityKind: input.identityKind ?? 'npc',
        displayName: record.displayName,
        ...(record.avatarUrl ? { avatarUrl: record.avatarUrl } : {}),
        ...(record.ownerProfileId ? { ownerProfileId: record.ownerProfileId } : {}),
        ...(record.campaignId ? { campaignId: record.campaignId } : {}),
        ...(worldEntityId ? { worldEntityId } : {}),
        authoringStatus: authoringStatus(authenticatedProfile.id, record.ownerProfileId),
      })
    }

    case 'character': {
      const record = input.character
      if (!record || record.id !== subject.characterId) {
        return { status: 'inaccessible', reason: 'The requested campaign character was not supplied.' }
      }

      return resolved({
        subject,
        identityKind: input.identityKind ?? record.identityKind ?? 'player',
        displayName: record.name,
        ...(record.alias ? { defaultHandle: record.alias } : {}),
        ...(record.portraitUrl ? { avatarUrl: record.portraitUrl } : {}),
        ownerProfileId: record.ownerProfileId,
        campaignId: record.campaignId,
        ...(worldEntityId ? { worldEntityId } : {}),
        authoringStatus: authoringStatus(authenticatedProfile.id, record.ownerProfileId),
      })
    }
  }
}
