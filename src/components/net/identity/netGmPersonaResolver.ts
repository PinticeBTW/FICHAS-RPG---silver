import type { Profile } from '../../../types/domain'
import type { NetIdentityLink } from '../../../lib/netIdentityService'
import { resolveNetIdentity } from './netIdentityResolver'
import { getNetIdentitySubjectId } from './netIdentitySelectors'
import type {
  NetIdentitySubject,
  NetPlayableIdentityCandidate,
  NetPlayableIdentityCandidateState,
} from './netIdentityTypes'
import type {
  NetGmPersonaSession,
  NetGmPersonaState,
} from './netGmPersonaTypes'

function subjectKey(subject: NetIdentitySubject): string {
  return `${subject.kind}:${getNetIdentitySubjectId(subject)}`
}

function resolveCandidate(
  profile: Profile,
  candidate: NetPlayableIdentityCandidate,
  identityLink?: NetIdentityLink,
) {
  const resolution = resolveNetIdentity({
    authenticatedProfile: profile,
    subject: candidate.subject,
    ...(identityLink ? { identityKind: identityLink.identityKind } : {}),
    ...(candidate.subject.kind === 'profile-sheet'
      ? {
          profileSheet: {
            id: candidate.subject.profileId,
            role: 'player' as const,
            displayName: candidate.displayName,
            ...(candidate.avatarUrl ? { avatarUrl: candidate.avatarUrl } : {}),
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
  })

  return resolution.status === 'resolved'
    ? {
        ...resolution.identity,
        ...(identityLink ? { identityLinkId: identityLink.id } : {}),
      }
    : undefined
}

/**
 * Resolves a server-approved persona session against records already loaded
 * through authorised sheet reads. Visibility remains descriptive, not control.
 */
export function resolveNetGmPersonaState(input: {
  readonly profile: Profile | null
  readonly authLoading: boolean
  readonly session: NetGmPersonaSession | null
  readonly candidates: NetPlayableIdentityCandidateState
  readonly identityLinks?: readonly NetIdentityLink[]
}): NetGmPersonaState {
  const { profile, authLoading, session, candidates, identityLinks = [] } = input

  if (authLoading) return { status: 'loading' }
  if (!profile || profile.role !== 'gm') {
    return { status: 'none', ...(profile ? { authenticatedProfileId: profile.id } : {}) }
  }
  if (!session || session.mode === 'none') {
    return { status: 'none', authenticatedProfileId: profile.id }
  }
  if (session.gmProfileId !== profile.id) {
    return { status: 'error', reason: 'The GM persona session does not belong to this account.' }
  }
  if (candidates.status === 'loading') return { status: 'loading' }
  if (candidates.status === 'error') return { status: 'error', reason: candidates.reason }
  if (candidates.authenticatedProfileId !== profile.id) return { status: 'loading' }

  const candidate = candidates.candidates.find((entry) => {
    if (entry.subject.kind === 'character') return false
    return subjectKey(entry.subject) === subjectKey(session.subject)
  })
  if (!candidate || candidate.subject.kind === 'character') {
    return { status: 'error', reason: 'The selected GM persona source is no longer available.' }
  }

  const identityLink = identityLinks.find((link) => subjectKey(link.subject) === subjectKey(candidate.subject))
  const identity = resolveCandidate(profile, candidate, identityLink)
  if (!identity) {
    return { status: 'error', reason: 'The selected GM persona could not be resolved.' }
  }

  if (session.mode === 'inspect') {
    return {
      status: 'inspect',
      authenticatedProfileId: profile.id,
      identity,
    }
  }

  if (session.mode === 'compromised-session') {
    return {
      status: 'compromised',
      authenticatedProfileId: profile.id,
      mode: 'compromised-session',
      identity,
    }
  }

  if (session.mode === 'take-control') {
    return {
      status: 'controlled',
      authenticatedProfileId: profile.id,
      mode: 'take-control',
      identity,
    }
  }

  return {
    status: 'active',
    authenticatedProfileId: profile.id,
    mode: 'gm-persona',
    identity,
  }
}
