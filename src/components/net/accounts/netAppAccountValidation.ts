import { netAppCatalog } from '../netAppCatalog'
import { getEntityHandle, getNetEntity, getNetOrganisation } from '../world/netSelectors'
import type { NetAppId as NetWorldAppId } from '../world/netWorldTypes'
import { netAppAccountPolicies } from './netAppAccountPolicies'
import { getNetAppAccountOwnerKey, normalizeNetHandle } from './netAppAccountSelectors'
import type { NetAppAccount } from './netAppAccountTypes'

function isNetWorldAppId(
  appId: NetAppAccount['appId'],
): appId is Extract<NetWorldAppId, NetAppAccount['appId']> {
  return appId !== 'net-store'
    && appId !== 'relay'
    && appId !== 'net-search'
    && appId !== 'vlt'
    && appId !== 'vox-bank'
    && appId !== 'shneider-bank'
    && appId !== 'altara-messenger'
    && appId !== 'altara-bank'
    && appId !== 'nova-bank'
    && appId !== 'altara-news'
    && appId !== 'altara-music'
    && appId !== 'altara-wave'
    && appId !== 'altara-store'
    && appId !== 'altara-settings'
}

/** Dependency-free validation for tests or development tooling; it never logs. */
export function validateNetAppAccountData(
  accounts: readonly NetAppAccount[] = [],
): readonly string[] {
  const errors: string[] = []
  const accountIds = new Set<string>()
  const appOwnerKeys = new Set<string>()
  const appHandles = new Set<string>()
  const knownAppIds = new Set(netAppCatalog.map((app) => app.id))
  const policyAppIds = new Set(netAppAccountPolicies.map((policy) => policy.appId))

  for (const app of netAppCatalog) {
    if (!policyAppIds.has(app.id)) errors.push(`Missing account policy for app: ${app.id}`)
  }
  for (const policy of netAppAccountPolicies) {
    if (!knownAppIds.has(policy.appId)) {
      errors.push(`Account policy references unknown app: ${policy.appId}`)
    }
  }

  for (const account of accounts) {
    if (accountIds.has(account.id)) errors.push(`Duplicate account id: ${account.id}`)
    accountIds.add(account.id)

    const app = netAppCatalog.find((candidate) => candidate.id === account.appId)
    if (!app) {
      errors.push(`Account ${account.id} references unknown app: ${account.appId}`)
    } else if (!app.available) {
      errors.push(`Account ${account.id} references unavailable app: ${account.appId}`)
    }

    const ownerKey = getNetAppAccountOwnerKey(account.owner)
    const appOwnerKey = `${account.appId}:${ownerKey}`
    if (appOwnerKeys.has(appOwnerKey)) {
      errors.push(`Duplicate account owner for app: ${appOwnerKey}`)
    }
    appOwnerKeys.add(appOwnerKey)

    const normalizedHandle = normalizeNetHandle(account.handle)
    if (!normalizedHandle) {
      errors.push(`Invalid account handle: ${account.id}`)
    } else {
      if (normalizedHandle !== account.handle) {
        errors.push(`Account handle is not normalized: ${account.id}`)
      }
      const appHandleKey = `${account.appId}:${normalizedHandle}`
      if (appHandles.has(appHandleKey)) {
        errors.push(`Duplicate app handle: ${appHandleKey}`)
      }
      appHandles.add(appHandleKey)
    }

    if (account.owner.type === 'entity') {
      const entity = getNetEntity(account.owner.entityId)
      if (!entity) {
        errors.push(`Account ${account.id} references unknown entity: ${account.owner.entityId}`)
      } else {
        const canonicalHandle = isNetWorldAppId(account.appId)
          ? getEntityHandle(account.owner.entityId, account.appId)
          : undefined
        if (canonicalHandle && normalizeNetHandle(canonicalHandle) !== normalizedHandle) {
          errors.push(`Account handle conflicts with World Core: ${account.id}`)
        }
      }
    }

    if (account.owner.type === 'organisation' && !getNetOrganisation(account.owner.organisationId)) {
      errors.push(
        `Account ${account.id} references unknown organisation: ${account.owner.organisationId}`,
      )
    }

    if (account.owner.type === 'identity-link' && !account.owner.identityLinkId.trim()) {
      errors.push(`Account ${account.id} has an empty identity-link owner.`)
    }
  }

  return errors
}
