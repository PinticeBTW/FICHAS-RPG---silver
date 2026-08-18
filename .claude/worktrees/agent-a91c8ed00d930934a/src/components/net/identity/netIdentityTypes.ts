import type { Character, Profile } from '../../../types/domain'
import type { NetEntityId } from '../world/netWorldTypes'

/**
 * THE NET supports the live profile-sheet/npc-card workspace and the separate
 * campaign character model. Supporting all three does not declare one canonical.
 * Site authentication and a fictional NET identity remain separate concepts.
 */
export type NetIdentitySubject =
  | { readonly kind: 'profile-sheet'; readonly profileId: string }
  | { readonly kind: 'npc-card'; readonly npcCardId: string }
  | { readonly kind: 'character'; readonly characterId: string }

export type NetIdentityKind = 'player' | 'npc'

export type NetWorldLinkStatus = 'linked' | 'unlinked'

/**
 * This is descriptive client state, not authorization. Server/RLS will later
 * decide whether an authenticated actor may act through an identity.
 */
export type NetIdentityAuthoringStatus = 'identity-ready' | 'view-only'

export interface NetResolvedIdentity {
  readonly subject: NetIdentitySubject
  /** Server identity qualification; never derived from the subject or auth id. */
  readonly identityLinkId?: string
  readonly identityKind: NetIdentityKind
  readonly displayName: string
  readonly defaultHandle?: string
  readonly avatarUrl?: string
  readonly ownerProfileId?: string
  readonly campaignId?: string
  readonly worldEntityId?: NetEntityId
  readonly worldLinkStatus: NetWorldLinkStatus
  readonly authoringStatus: NetIdentityAuthoringStatus
}

export type NetIdentityResolution =
  | { readonly status: 'resolved'; readonly identity: NetResolvedIdentity }
  | { readonly status: 'no-character' }
  | { readonly status: 'inaccessible'; readonly reason: string }

export type NetIdentityProfileRecord = Pick<
  Profile,
  'id' | 'displayName' | 'avatarUrl' | 'role'
> & {
  /** Site handles are only a fallback while a sheet has no character data. */
  readonly handle?: string
}

export type NetPlayableIdentitySourceKind =
  | 'profile-sheet'
  | 'npc-card'
  | 'character'

export type NetPlayableIdentityAccessKind =
  | 'self-profile'
  | 'owner'
  | 'shared'
  | 'gm'

export type NetPlayableIdentityPlayability =
  | 'confirmed'
  | 'candidate'
  | 'not-playable'

/**
 * Compact, read-only character facts for identity inspection and future
 * selection. Candidate visibility describes authorised reads only; it never
 * grants permission to act as the subject.
 */
export interface NetPlayableIdentityCandidate {
  readonly subject: NetIdentitySubject
  readonly sourceKind: NetPlayableIdentitySourceKind
  readonly displayName: string
  /** Pending summaries deliberately never masquerade as site-account names. */
  readonly displayNameSource: 'sheet' | 'account-fallback' | 'campaign' | 'pending'
  readonly summaryStatus: 'ready' | 'loading' | 'unavailable'
  readonly avatarUrl?: string
  readonly alias?: string
  readonly age?: string
  readonly gender?: string
  readonly occupation?: string
  readonly city?: string
  readonly ownerProfileId?: string
  readonly ownerDisplayName?: string
  readonly ownerHandle?: string
  readonly campaignId?: string
  readonly accessKind: NetPlayableIdentityAccessKind
  readonly playability: NetPlayableIdentityPlayability
  /** Lightweight GM-directory metadata; descriptive only, never client authority. */
  readonly summaryUpdatedAt?: string
  readonly gmCapabilities?: {
    readonly inspect: boolean
    readonly takeControl: boolean
    readonly actAs: boolean
  }
  /** Snapshot of the authoritative link returned by the GM-only directory RPC. */
  readonly authoritativeLink?: {
    readonly id: string
    readonly identityKind: NetIdentityKind
    readonly playability: 'playable' | 'non-playable'
    readonly entityId?: NetEntityId
    readonly ownerProfileId?: string
    readonly campaignId?: string
    readonly createdAt: string
    readonly updatedAt: string
  }
}

export type NetPlayableIdentityCandidateState =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready'
      readonly authenticatedProfileId: string
      readonly candidates: readonly NetPlayableIdentityCandidate[]
      readonly currentProfileCandidate?: NetPlayableIdentityCandidate
      readonly warning?: string
      /** Refreshes authorised summary reads only; it grants no new access. */
      readonly retry?: () => void
    }
  | {
      readonly status: 'error'
      readonly authenticatedProfileId: string
      readonly reason: string
      readonly retry?: () => void
    }

/**
 * Mirrors only the identity fields currently available from an authorised
 * npc_cards caller. The resolver intentionally does not query or parse fields.
 */
export interface NetIdentityNpcCardRecord {
  readonly id: string
  readonly displayName: string
  readonly ownerProfileId?: string
  readonly avatarUrl?: string
  readonly campaignId?: string
}

/**
 * `characters` is supported for future compatibility, but is not made
 * authoritative by this identity layer.
 */
export type NetIdentityCharacterRecord = Pick<
  Character,
  'id' | 'campaignId' | 'ownerProfileId' | 'name' | 'alias' | 'portraitUrl'
> & {
  readonly identityKind?: NetIdentityKind
}

export interface NetIdentityResolutionInput {
  readonly authenticatedProfile: Pick<Profile, 'id' | 'role'> | null
  readonly subject?: NetIdentitySubject | null
  /** Server classification may identify an NPC-card subject as a playable player identity. */
  readonly identityKind?: NetIdentityKind
  readonly profileSheet?: NetIdentityProfileRecord
  readonly npcCard?: NetIdentityNpcCardRecord
  readonly character?: NetIdentityCharacterRecord
  /** Explicit only; this layer never derives a World Core link from a name. */
  readonly worldEntityId?: NetEntityId
}

/** Minimal account-facing source for the next app-account batch. */
export interface NetAccountIdentitySource {
  readonly subject: NetIdentitySubject
  readonly entityId?: NetEntityId
  readonly displayName: string
  readonly defaultHandle?: string
  readonly avatarUrl?: string
}
