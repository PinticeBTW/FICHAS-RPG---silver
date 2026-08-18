import type { NetActiveIdentityState } from './identity/netActiveIdentity'
import {
  getNetAppAccountAvatar,
  getNetAppAccountDisplayHandle,
  getNetAppAccountDisplayName,
} from './accounts/netAppAccountSelectors'
import type { NetAppAccount, NetAppAccountResolution } from './accounts/netAppAccountTypes'
import {
  generateDisplayId,
  selfCredentials,
  selfTrustBand,
  selfTrustScore,
  type Identity,
} from './idenData'

export type IdenPersonalIdentityState =
  | {
      readonly status: 'ready'
      readonly identity: Identity
      readonly account: NetAppAccount
      readonly displayHandle: string
    }
  | { readonly status: 'gm-no-persona'; readonly message: string }
  | { readonly status: 'identity-required'; readonly message: string }
  | { readonly status: 'loading'; readonly message: string }

/**
 * Composes identity/account presentation with local IDEN facts. Trust,
 * credentials, and every other IDEN metric remain app-local seed/session data.
 */
export function createCurrentIdenIdentity(input: {
  readonly activeIdentity: NetActiveIdentityState
  readonly accountResolution: NetAppAccountResolution
}): IdenPersonalIdentityState {
  if (input.activeIdentity.status === 'loading') {
    return { status: 'loading', message: 'Resolving active identity.' }
  }

  if (input.activeIdentity.status === 'gm-no-persona') {
    return { status: 'gm-no-persona', message: 'No active persona selected.' }
  }

  if (input.activeIdentity.status !== 'ready') {
    return { status: 'identity-required', message: 'No active identity is linked to this session.' }
  }

  if (input.accountResolution.status === 'loading') {
    return { status: 'loading', message: 'Synchronizing the IDEN account.' }
  }

  if (input.accountResolution.status !== 'ready') {
    return {
      status: 'identity-required',
      message: input.accountResolution.status === 'unavailable'
        ? input.accountResolution.reason
        : 'The active IDEN identity is not available.',
    }
  }

  const account = input.accountResolution.account
  const displayName = getNetAppAccountDisplayName(account, input.activeIdentity.identity)
  const avatarUrl = getNetAppAccountAvatar(account, input.activeIdentity.identity)
  const displayHandle = getNetAppAccountDisplayHandle(account)

  return {
    status: 'ready',
    account,
    displayHandle,
    identity: {
      // This runtime key is derived from the app account, never from auth UUID or `self`.
      id: `iden-current:${account.id}`,
      displayId: generateDisplayId(`iden-account:${account.id}`),
      name: displayName,
      handle: account.handle,
      type: 'citizen',
      district: 'Central',
      bio: 'Current fictional identity, secured through VEGA MESH.',
      verification: 'verified',
      trustScore: selfTrustScore,
      trustBand: selfTrustBand,
      networkReputation: 'stable',
      securityRisk: 'low',
      credentialNames: selfCredentials.map((credential) => credential.name),
      networkIdentities: [
        { service: 'VEGA MESH', status: 'Connected' },
        { service: 'ECHO', status: 'Connected' },
        { service: 'PULSE', status: 'Connected' },
      ],
      publicProfile: true,
      lastVerified: '2H AGO',
      ...(avatarUrl ? { avatarUrl } : {}),
    },
  }
}
