import type { NetAppId } from '../netAppCatalog'
import type { NetIdentitySubject, NetResolvedIdentity } from '../identity/netIdentityTypes'
import type { NetEntityId, NetOrganisationId } from '../world/netWorldTypes'

/**
 * An application account is an in-world account, never a site-auth account.
 * Server-backed playable accounts use an identity-link owner. Entity,
 * organisation, and transitional subject owners remain available for canonical
 * world seeds and compatibility adapters.
 */
export type NetAppAccountOwner =
  | { readonly type: 'identity-link'; readonly identityLinkId: string }
  | { readonly type: 'entity'; readonly entityId: NetEntityId }
  | { readonly type: 'organisation'; readonly organisationId: NetOrganisationId }
  | { readonly type: 'subject'; readonly subject: NetIdentitySubject }

export type NetAppAccountStatus = 'active' | 'suspended' | 'disabled'

export interface NetAppAccount {
  readonly id: string
  readonly appId: NetAppId
  readonly owner: NetAppAccountOwner
  /** Canonical internal format: no leading @ and normalized casing. */
  readonly handle: string
  readonly displayNameOverride?: string
  readonly avatarUrlOverride?: string
  /**
   * Active accounts support normal use. Suspended accounts are retained but
   * may later have authoring restrictions; disabled accounts are unavailable.
   */
  readonly status: NetAppAccountStatus
  readonly createdAt: string
  readonly updatedAt?: string
}

export type NetAppAccountMode =
  | 'none'
  | 'system-identity'
  | 'automatic'
  | 'explicit'
  | 'optional'

export interface NetAppAccountPolicy {
  readonly appId: NetAppId
  readonly mode: NetAppAccountMode
}

export interface NetTransientAppAccountCandidate {
  readonly appId: NetAppId
  readonly owner: NetAppAccountOwner
  readonly displayName: string
  readonly avatarUrl?: string
  /** A suggestion only; availability is resolved by future server storage. */
  readonly suggestedHandle: string
}

export type NetAppAccountResolution =
  | { readonly status: 'loading'; readonly appId: NetAppId }
  | {
      readonly status: 'ready'
      readonly account: NetAppAccount
      readonly source: 'registered'
    }
  | {
      readonly status: 'needs-onboarding'
      readonly appId: NetAppId
      readonly identity: NetResolvedIdentity
      readonly candidate: NetTransientAppAccountCandidate
    }
  | {
      readonly status: 'needs-provisioning'
      readonly appId: NetAppId
      readonly identity: NetResolvedIdentity
      readonly candidate: NetTransientAppAccountCandidate
    }
  | { readonly status: 'identity-required'; readonly appId: NetAppId }
  | { readonly status: 'not-required'; readonly appId: NetAppId }
  | { readonly status: 'unavailable'; readonly appId: NetAppId; readonly reason: string }

/** Future posts/messages reference an account, not copied presentation fields. */
export interface NetContentAuthorRef {
  readonly accountId: string
}

export interface NetSessionAppAccountRegistry {
  readonly accounts: readonly NetAppAccount[]
}

export type NetSessionAppAccountRegistration =
  | { readonly status: 'registered'; readonly registry: NetSessionAppAccountRegistry }
  | { readonly status: 'duplicate'; readonly reason: string }
