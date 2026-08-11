import { getNetAppDefinition, type NetAppId } from '../netAppCatalog'
import type { NetResolvedIdentity } from '../identity/netIdentityTypes'
import { netAppAccountPolicies } from './netAppAccountPolicies'
import { netAppAccountSeeds } from './netAppAccountSeeds'
import {
  createTransientAppAccountCandidate,
  getNetAppAccount,
  getNetAppAccountOwnerForIdentity,
} from './netAppAccountSelectors'
import type {
  NetAppAccount,
  NetAppAccountMode,
  NetAppAccountResolution,
} from './netAppAccountTypes'

export interface NetAppAccountResolutionInput {
  readonly appId: NetAppId
  readonly identity?: NetResolvedIdentity
  readonly accounts?: readonly NetAppAccount[]
  readonly loading?: boolean
  readonly error?: string
}

export function getNetAppAccountMode(appId: NetAppId): NetAppAccountMode | undefined {
  return netAppAccountPolicies.find((policy) => policy.appId === appId)?.mode
}

export function requiresNetAppAccount(appId: NetAppId): boolean {
  const mode = getNetAppAccountMode(appId)
  return mode === 'system-identity' || mode === 'automatic' || mode === 'explicit'
}

export function canReadWithoutNetAppAccount(appId: NetAppId): boolean {
  const mode = getNetAppAccountMode(appId)
  return mode === 'none' || mode === 'optional'
}

/**
 * Pure account lookup/adaptation. It never writes, never authorizes an actor,
 * and does not materialize a suggested automatic account into storage.
 */
export function resolveNetAppAccount(
  input: NetAppAccountResolutionInput,
): NetAppAccountResolution {
  const app = getNetAppDefinition(input.appId)
  if (!app || !app.available) {
    return {
      status: 'unavailable',
      appId: input.appId,
      reason: 'This application is not currently available.',
    }
  }

  const mode = getNetAppAccountMode(input.appId)
  if (!mode) {
    return {
      status: 'unavailable',
      appId: input.appId,
      reason: 'No application-account policy is available.',
    }
  }

  if (mode === 'none') return { status: 'not-required', appId: input.appId }
  if (input.loading) return { status: 'loading', appId: input.appId }
  if (input.error) {
    return { status: 'unavailable', appId: input.appId, reason: input.error }
  }
  if (!input.identity && mode === 'optional') {
    return { status: 'not-required', appId: input.appId }
  }
  if (!input.identity) return { status: 'identity-required', appId: input.appId }

  const primaryOwner = getNetAppAccountOwnerForIdentity(input.identity)
  const account = getNetAppAccount(
    input.accounts ?? netAppAccountSeeds,
    input.appId,
    primaryOwner,
  ) ?? (input.identity.identityLinkId && input.identity.worldEntityId
    ? getNetAppAccount(
        input.accounts ?? netAppAccountSeeds,
        input.appId,
        { type: 'entity', entityId: input.identity.worldEntityId },
      )
    : undefined)

  if (account) {
    if (account.status === 'disabled') {
      return {
        status: 'unavailable',
        appId: input.appId,
        reason: 'This application account is disabled.',
      }
    }

    return { status: 'ready', account, source: 'registered' }
  }

  if (mode === 'optional') return { status: 'not-required', appId: input.appId }

  const candidate = createTransientAppAccountCandidate(input.appId, input.identity)
  if (mode === 'explicit') {
    return {
      status: 'needs-onboarding',
      appId: input.appId,
      identity: input.identity,
      candidate,
    }
  }

  return {
    status: 'needs-provisioning',
    appId: input.appId,
    identity: input.identity,
    candidate,
  }
}
