import type { NetUniversalProfile } from '../../../lib/netUniversalProfileService'
import type { NetActiveIdentityState } from '../identity/netActiveIdentity'
import type { NetPlayableIdentityCandidate } from '../identity/netIdentityTypes'

export interface NetUniversalProfileBase {
  readonly identityLinkId: string
  readonly displayName: string
  readonly avatarUrl?: string
  readonly age?: string
  readonly gender?: string
  readonly occupation?: string
  readonly city?: string
}

export interface NetResolvedUniversalProfile extends NetUniversalProfileBase {
  readonly bio?: string
  readonly status?: string
  readonly displayNameSource: 'net-override' | 'character-sheet'
  readonly avatarSource: 'net-override' | 'character-sheet' | 'fallback'
}

export type NetUniversalProfileState =
  | { readonly status: 'loading'; readonly identityLinkId?: string }
  | {
      readonly status: 'ready'
      readonly identityLinkId: string
      readonly profile: NetUniversalProfile | null
      readonly resolved: NetResolvedUniversalProfile
    }
  | { readonly status: 'no-active-identity'; readonly reason: string }
  | { readonly status: 'error'; readonly identityLinkId: string; readonly reason: string }

export interface NetUniversalProfileController {
  readonly state: NetUniversalProfileState
  readonly saving: boolean
  readonly error?: string
  readonly save: (input: {
    readonly displayNameOverride?: string
    readonly bio?: string
    readonly status?: string
    readonly avatarUrlOverride?: string
  }) => Promise<boolean>
}

export interface NetUniversalProfileResolutionInput {
  readonly activeIdentity: Extract<NetActiveIdentityState, { readonly status: 'ready' }>
  readonly identityLinkId: string
  readonly candidate?: NetPlayableIdentityCandidate
  readonly profile: NetUniversalProfile | null
}
