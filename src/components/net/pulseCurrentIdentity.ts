import {
  getNetAppAccountAvatar,
  getNetAppAccountDisplayHandle,
} from './accounts/netAppAccountSelectors'
import type { NetAppAccountResolution } from './accounts/netAppAccountTypes'
import type { NetActiveIdentityState } from './identity/netActiveIdentity'
import type { NetResolvedIdentity } from './identity/netIdentityTypes'

export interface PulseSessionProfile {
  readonly accountId: string
  readonly bio: string
  readonly visibility: 'public' | 'limited'
  readonly showDistrict: boolean
  readonly discoverable: boolean
  readonly feedPreference: 'city' | 'following' | 'raw'
}

export type PulseProfileDraft = Omit<PulseSessionProfile, 'accountId'>

export interface PulseCurrentIdentity {
  readonly accountId: string
  readonly displayName: string
  readonly displayHandle: string
  readonly avatarUrl?: string
  readonly identity: NetResolvedIdentity
}

export type PulseCurrentIdentityState =
  | { readonly status: 'ready'; readonly identity: PulseCurrentIdentity }
  | { readonly status: 'needs-onboarding'; readonly identity: NetResolvedIdentity }
  | { readonly status: 'gm-no-persona'; readonly message: string }
  | { readonly status: 'identity-required'; readonly message: string }
  | { readonly status: 'loading'; readonly message: string }
  | { readonly status: 'restricted'; readonly message: string }

export function createDefaultPulseProfile(accountId: string): PulseSessionProfile {
  return {
    accountId,
    bio: '',
    visibility: 'public',
    showDistrict: false,
    discoverable: true,
    feedPreference: 'city',
  }
}

/**
 * PULSE receives this context from THE NET shell. Site authentication remains
 * separate; the app never guesses a fictional account from an auth profile.
 */
export function createCurrentPulseIdentity(input: {
  readonly activeIdentity: NetActiveIdentityState
  readonly accountResolution: NetAppAccountResolution
}): PulseCurrentIdentityState {
  const { activeIdentity, accountResolution } = input

  if (activeIdentity.status === 'gm-no-persona') {
    return {
      status: 'gm-no-persona',
      message: 'Select a persona before creating a PULSE identity.',
    }
  }

  if (activeIdentity.status === 'loading') {
    return { status: 'loading', message: 'Resolving your fictional identity.' }
  }

  if (activeIdentity.status !== 'ready') {
    return {
      status: 'identity-required',
      message: 'A linked fictional identity is required for a personal PULSE account.',
    }
  }

  if (accountResolution.status === 'loading') {
    return { status: 'loading', message: 'Synchronizing your PULSE identity.' }
  }

  if (accountResolution.status === 'needs-onboarding') {
    return { status: 'needs-onboarding', identity: activeIdentity.identity }
  }

  if (accountResolution.status !== 'ready') {
    return {
      status: 'restricted',
      message: accountResolution.status === 'unavailable'
        ? accountResolution.reason
        : 'Your PULSE identity is not currently available.',
    }
  }

  if (accountResolution.account.status !== 'active') {
    return {
      status: 'restricted',
      message: accountResolution.account.status === 'suspended'
        ? 'This PULSE identity is suspended.'
        : 'This PULSE identity is disabled.',
    }
  }

  const avatarUrl = getNetAppAccountAvatar(
    accountResolution.account,
    activeIdentity.identity,
  )
  const displayHandle = getNetAppAccountDisplayHandle(accountResolution.account)

  return {
    status: 'ready',
    identity: {
      accountId: accountResolution.account.id,
      displayName: displayHandle,
      displayHandle,
      ...(avatarUrl ? { avatarUrl } : {}),
      identity: activeIdentity.identity,
    },
  }
}
