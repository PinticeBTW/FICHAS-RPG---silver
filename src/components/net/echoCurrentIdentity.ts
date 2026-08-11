import {
  getNetAppAccountAvatar,
  getNetAppAccountDisplayHandle,
  getNetAppAccountDisplayName,
} from './accounts/netAppAccountSelectors'
import type { NetAppAccountResolution } from './accounts/netAppAccountTypes'
import type { NetActiveIdentityState } from './identity/netActiveIdentity'
import type { NetResolvedIdentity } from './identity/netIdentityTypes'

export interface EchoCurrentIdentity {
  readonly accountId: string
  readonly accountStatus: 'active' | 'suspended' | 'disabled'
  readonly displayName: string
  readonly displayHandle: string
  readonly avatarUrl?: string
  readonly identity: NetResolvedIdentity
}

export type EchoCurrentIdentityState =
  | { readonly status: 'ready'; readonly identity: EchoCurrentIdentity }
  | { readonly status: 'needs-onboarding'; readonly identity: NetResolvedIdentity }
  | { readonly status: 'gm-no-persona'; readonly message: string }
  | { readonly status: 'identity-required'; readonly message: string }
  | { readonly status: 'loading'; readonly message: string }
  | { readonly status: 'restricted'; readonly message: string }

/**
 * ECHO identity is derived from the shell's active fiction identity and its
 * app account. It never treats the authenticated site profile as an ECHO user.
 */
export function createCurrentEchoIdentity(input: {
  readonly activeIdentity: NetActiveIdentityState
  readonly accountResolution: NetAppAccountResolution
}): EchoCurrentIdentityState {
  const { activeIdentity, accountResolution } = input

  if (activeIdentity.status === 'gm-no-persona') {
    return {
      status: 'gm-no-persona',
      message: 'Select a persona before creating an ECHO presence.',
    }
  }

  if (activeIdentity.status === 'loading') {
    return { status: 'loading', message: 'Resolving your fictional identity.' }
  }

  if (activeIdentity.status !== 'ready') {
    return {
      status: 'identity-required',
      message: 'A linked fictional identity is required for a personal ECHO presence.',
    }
  }

  if (accountResolution.status === 'loading') {
    return { status: 'loading', message: 'Synchronizing your ECHO presence.' }
  }

  if (accountResolution.status === 'needs-onboarding') {
    return { status: 'needs-onboarding', identity: activeIdentity.identity }
  }

  if (accountResolution.status !== 'ready') {
    return {
      status: 'restricted',
      message: accountResolution.status === 'unavailable'
        ? accountResolution.reason
        : 'Your ECHO presence is not currently available.',
    }
  }

  if (accountResolution.account.status !== 'active') {
    return {
      status: 'restricted',
      message: accountResolution.account.status === 'suspended'
        ? 'This ECHO presence is suspended.'
        : 'This ECHO presence is disabled.',
    }
  }

  return {
    status: 'ready',
    identity: {
      accountId: accountResolution.account.id,
      accountStatus: accountResolution.account.status,
      displayName: getNetAppAccountDisplayName(
        accountResolution.account,
        activeIdentity.identity,
      ),
      displayHandle: getNetAppAccountDisplayHandle(accountResolution.account),
      ...(getNetAppAccountAvatar(accountResolution.account, activeIdentity.identity)
        ? { avatarUrl: getNetAppAccountAvatar(accountResolution.account, activeIdentity.identity) }
        : {}),
      identity: activeIdentity.identity,
    },
  }
}
