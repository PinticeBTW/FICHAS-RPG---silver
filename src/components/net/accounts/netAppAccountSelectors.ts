import type { NetResolvedIdentity, NetIdentitySubject } from '../identity/netIdentityTypes'
import { getNetIdentitySubjectId } from '../identity/netIdentitySelectors'
import { getNetEntity, getNetOrganisation } from '../world/netSelectors'
import type {
  NetAppAccount,
  NetAppAccountOwner,
  NetSessionAppAccountRegistry,
  NetSessionAppAccountRegistration,
  NetTransientAppAccountCandidate,
} from './netAppAccountTypes'

const netHandlePattern = /^[a-z0-9][a-z0-9_.-]*$/

/** Returns undefined for handles outside the conservative shared NET format. */
export function normalizeNetHandle(handle: string): string | undefined {
  const normalized = handle.trim().replace(/^@+/, '').trim().toLowerCase()
  return normalized && normalized.length <= 32 && netHandlePattern.test(normalized)
    ? normalized
    : undefined
}

export function formatNetHandle(handle: string): string | undefined {
  const normalized = normalizeNetHandle(handle)
  return normalized ? `@${normalized}` : undefined
}

export function getNetAppAccountOwnerKey(owner: NetAppAccountOwner): string {
  switch (owner.type) {
    case 'identity-link':
      return `identity-link:${owner.identityLinkId}`
    case 'entity':
      return `entity:${owner.entityId}`
    case 'organisation':
      return `organisation:${owner.organisationId}`
    case 'subject':
      return `subject:${owner.subject.kind}:${getNetIdentitySubjectId(owner.subject)}`
  }
}

export function getNetAppAccountOwnerForIdentity(
  identity: NetResolvedIdentity,
): NetAppAccountOwner {
  return identity.identityLinkId
    ? { type: 'identity-link', identityLinkId: identity.identityLinkId }
    : identity.worldEntityId
    ? { type: 'entity', entityId: identity.worldEntityId }
    : { type: 'subject', subject: identity.subject }
}

export function isNetAppAccountOwnedByIdentity(
  account: NetAppAccount,
  identity: NetResolvedIdentity,
): boolean {
  if (getNetAppAccountOwnerKey(account.owner) === getNetAppAccountOwnerKey(
    getNetAppAccountOwnerForIdentity(identity),
  )) return true

  return account.owner.type === 'entity'
    && Boolean(identity.worldEntityId)
    && account.owner.entityId === identity.worldEntityId
}

export function getNetAppAccount(
  accounts: readonly NetAppAccount[],
  appId: NetAppAccount['appId'],
  owner: NetAppAccountOwner,
): NetAppAccount | undefined {
  const ownerKey = getNetAppAccountOwnerKey(owner)
  return accounts.find(
    (account) => account.appId === appId && getNetAppAccountOwnerKey(account.owner) === ownerKey,
  )
}

export function getNetAppAccountById(
  accounts: readonly NetAppAccount[],
  accountId: string,
): NetAppAccount | undefined {
  return accounts.find((account) => account.id === accountId)
}

export function getNetAccountsForOwner(
  accounts: readonly NetAppAccount[],
  owner: NetAppAccountOwner,
): readonly NetAppAccount[] {
  const ownerKey = getNetAppAccountOwnerKey(owner)
  return accounts.filter((account) => getNetAppAccountOwnerKey(account.owner) === ownerKey)
}

export function getNetAccountsForApp(
  accounts: readonly NetAppAccount[],
  appId: NetAppAccount['appId'],
): readonly NetAppAccount[] {
  return accounts.filter((account) => account.appId === appId)
}

export function getNetAppAccountDisplayName(
  account: NetAppAccount,
  identity?: NetResolvedIdentity,
): string {
  if (account.displayNameOverride) return account.displayNameOverride
  if (identity && isNetAppAccountOwnedByIdentity(account, identity)) return identity.displayName

  if (account.owner.type === 'entity') {
    return getNetEntity(account.owner.entityId)?.displayName ?? account.handle
  }

  if (account.owner.type === 'organisation') {
    return getNetOrganisation(account.owner.organisationId)?.displayName ?? account.handle
  }

  if (account.owner.type === 'identity-link') return account.handle

  return account.handle
}

export function getNetAppAccountAvatar(
  account: NetAppAccount,
  identity?: NetResolvedIdentity,
): string | undefined {
  if (account.avatarUrlOverride) return account.avatarUrlOverride
  if (identity && isNetAppAccountOwnedByIdentity(account, identity)) return identity.avatarUrl
  return undefined
}

export function getNetAppAccountDisplayHandle(account: NetAppAccount): string {
  return formatNetHandle(account.handle) ?? '@unavailable'
}

export function suggestNetHandle(
  identity: Pick<NetResolvedIdentity, 'displayName' | 'defaultHandle'>,
): string {
  const existingHandle = identity.defaultHandle && normalizeNetHandle(identity.defaultHandle)
  if (existingHandle) return existingHandle

  const displaySuggestion = identity.displayName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')

  return normalizeNetHandle(displaySuggestion) ?? 'new-vega-user'
}

export function createTransientAppAccountCandidate(
  appId: NetAppAccount['appId'],
  identity: NetResolvedIdentity,
  desiredHandle?: string,
): NetTransientAppAccountCandidate {
  const normalizedDesiredHandle = desiredHandle
    ? normalizeNetHandle(desiredHandle)
    : undefined
  const suggestedHandle = normalizedDesiredHandle ?? suggestNetHandle(identity)

  return {
    appId,
    owner: getNetAppAccountOwnerForIdentity(identity),
    displayName: identity.displayName,
    ...(identity.avatarUrl ? { avatarUrl: identity.avatarUrl } : {}),
    suggestedHandle,
  }
}

function stableNetAccountSuffix(seed: string): string {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  }

  return hash.toString(36).padStart(6, '0').slice(-6)
}

/**
 * Materializes a local-only account from an already-approved automatic/system
 * candidate. Its handle is provisional and collision-safe only for this
 * session; future server provisioning remains authoritative.
 */
export function createNetSessionAppAccount(
  candidate: NetTransientAppAccountCandidate,
  existingAccounts: readonly NetAppAccount[],
  createdAt: string,
): NetAppAccount {
  const ownerKey = getNetAppAccountOwnerKey(candidate.owner)
  const usedHandles = new Set(
    existingAccounts
      .filter((account) => account.appId === candidate.appId)
      .map((account) => normalizeNetHandle(account.handle))
      .filter((handle): handle is string => Boolean(handle)),
  )
  const baseHandle = normalizeNetHandle(candidate.suggestedHandle) ?? 'new-vega-user'
  let handle = baseHandle

  if (usedHandles.has(handle)) {
    const suffix = stableNetAccountSuffix(`${candidate.appId}:${ownerKey}`)
    handle = `${baseHandle}-${suffix}`
    let attempt = 2
    while (usedHandles.has(handle)) {
      handle = `${baseHandle}-${suffix}-${attempt}`
      attempt += 1
    }
  }

  return {
    id: `session-account-${candidate.appId}-${stableNetAccountSuffix(ownerKey)}`,
    appId: candidate.appId,
    owner: candidate.owner,
    handle,
    status: 'active',
    createdAt,
  }
}

/** Session registries are transitional/cache-only; persistent accounts belong in Supabase. */
export function createNetSessionAppAccountRegistry(
  accounts: readonly NetAppAccount[] = [],
): NetSessionAppAccountRegistry {
  return { accounts: [...accounts] }
}

export function registerNetSessionAppAccount(
  registry: NetSessionAppAccountRegistry,
  account: NetAppAccount,
): NetSessionAppAccountRegistration {
  if (getNetAppAccountById(registry.accounts, account.id)) {
    return { status: 'duplicate', reason: `An account already uses id: ${account.id}` }
  }

  if (getNetAppAccount(registry.accounts, account.appId, account.owner)) {
    return {
      status: 'duplicate',
      reason: `An account already exists for ${account.appId} and this owner.`,
    }
  }

  const normalizedHandle = normalizeNetHandle(account.handle)
  if (!normalizedHandle || normalizedHandle !== account.handle) {
    return { status: 'duplicate', reason: 'Account handles must use normalized NET format.' }
  }

  const handleCollision = registry.accounts.some(
    (existing) => existing.appId === account.appId
      && normalizeNetHandle(existing.handle) === normalizedHandle,
  )
  if (handleCollision) {
    return {
      status: 'duplicate',
      reason: `Handle is already registered in ${account.appId}.`,
    }
  }

  return {
    status: 'registered',
    registry: { accounts: [...registry.accounts, account] },
  }
}

export function getNetIdentitySubjectOwner(
  subject: NetIdentitySubject,
): NetAppAccountOwner {
  return { type: 'subject', subject }
}
