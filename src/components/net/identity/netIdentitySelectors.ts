import type { Profile } from '../../../types/domain'
import type {
  NetAccountIdentitySource,
  NetIdentityResolution,
  NetIdentitySubject,
  NetResolvedIdentity,
} from './netIdentityTypes'

/**
 * Sheet Workspace already supplies `sheetSource` for its authorised directory
 * entries. Callers must provide that explicit discriminator; no synthetic
 * `npc:<id>` email parsing occurs in THE NET identity layer.
 */
export function getNetIdentitySubjectFromSheetProfile(
  profile: Pick<Profile, 'id' | 'sheetSource'>,
): NetIdentitySubject | undefined {
  if (profile.sheetSource === 'profile') {
    return { kind: 'profile-sheet', profileId: profile.id }
  }

  if (profile.sheetSource === 'npc') {
    return { kind: 'npc-card', npcCardId: profile.id }
  }

  return undefined
}

export function createProfileSheetNetIdentitySubject(
  profileId: string,
): NetIdentitySubject {
  return { kind: 'profile-sheet', profileId }
}

export function getNetIdentitySubjectId(subject: NetIdentitySubject): string {
  switch (subject.kind) {
    case 'profile-sheet':
      return subject.profileId
    case 'npc-card':
      return subject.npcCardId
    case 'character':
      return subject.characterId
  }
}

export function isResolvedNetIdentity(
  resolution: NetIdentityResolution,
): resolution is Extract<NetIdentityResolution, { status: 'resolved' }> {
  return resolution.status === 'resolved'
}

export function getNetIdentityDisplayName(identity: NetResolvedIdentity): string {
  return identity.displayName
}

export function getNetIdentityHandle(identity: NetResolvedIdentity): string | undefined {
  return identity.defaultHandle
}

export function getNetIdentityAvatar(identity: NetResolvedIdentity): string | undefined {
  return identity.avatarUrl
}

export function toNetAccountIdentitySource(
  identity: NetResolvedIdentity,
): NetAccountIdentitySource {
  return {
    subject: identity.subject,
    ...(identity.worldEntityId ? { entityId: identity.worldEntityId } : {}),
    displayName: identity.displayName,
    ...(identity.defaultHandle ? { defaultHandle: identity.defaultHandle } : {}),
    ...(identity.avatarUrl ? { avatarUrl: identity.avatarUrl } : {}),
  }
}
