import type { NetIdentitySubject, NetResolvedIdentity } from './netIdentityTypes'

export type NetGmPersonaSubject = Extract<
  NetIdentitySubject,
  { readonly kind: 'profile-sheet' } | { readonly kind: 'npc-card' }
>

export type NetGmPersonaSessionMode =
  | 'none'
  | 'inspect'
  | 'gm-persona'
  | 'take-control'
  | 'compromised-session'
export type NetSelectableGmPersonaMode = Exclude<NetGmPersonaSessionMode, 'none'>

export type NetGmPersonaSession =
  | {
      readonly gmProfileId: string
      readonly mode: 'none'
      readonly sessionGeneration: string
      readonly createdAt: string
      readonly updatedAt: string
    }
  | {
      readonly gmProfileId: string
      readonly mode: NetSelectableGmPersonaMode
      readonly subject: NetGmPersonaSubject
      readonly sessionGeneration: string
      readonly createdAt: string
      readonly updatedAt: string
    }

/**
 * A persona is presentation/context, never a replacement for the authenticated
 * profile. `active` still grants no client-side content-authoring authority.
 */
export type NetGmPersonaState =
  | { readonly status: 'loading' }
  | { readonly status: 'none'; readonly authenticatedProfileId?: string }
  | {
      readonly status: 'inspect'
      readonly authenticatedProfileId: string
      readonly identity: NetResolvedIdentity
    }
  | {
      readonly status: 'active'
      readonly authenticatedProfileId: string
      readonly mode: 'gm-persona'
      readonly identity: NetResolvedIdentity
    }
  | {
      readonly status: 'controlled'
      readonly authenticatedProfileId: string
      readonly mode: 'take-control'
      readonly identity: NetResolvedIdentity
    }
  | {
      readonly status: 'compromised'
      readonly authenticatedProfileId: string
      readonly mode: 'compromised-session'
      readonly identity: NetResolvedIdentity
    }
  | { readonly status: 'error'; readonly reason: string }

/**
 * Descriptive client context only. Every future content RPC must derive the
 * authenticated actor from auth.uid() and re-authorize the requested action.
 */
export interface NetActionActorContext {
  readonly authenticatedActorProfileId: string
  readonly personaSubject?: NetIdentitySubject
  readonly mode: 'owner' | 'gm-persona' | 'inspect' | 'take-control' | 'compromised-session'
}

/**
 * Reserved contract for future server-side content auditing. It deliberately
 * does not live on NetAppAccount: audit facts belong to each action.
 */
export interface NetContentAuditContext {
  readonly authenticatedActorProfileId: string
  readonly presentedAuthorAccountId?: string
  readonly personaSubject?: NetIdentitySubject
  readonly actionMode: 'owner' | 'gm-persona' | 'inspect' | 'take-control' | 'compromised-session'
  readonly authorizationBasis: string
}
