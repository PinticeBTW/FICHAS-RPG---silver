import type { NetAppId } from '../components/net/netAppCatalog'
import type {
  NetAppAccount,
  NetAppAccountStatus,
} from '../components/net/accounts/netAppAccountTypes'
import { normalizeNetHandle } from '../components/net/accounts/netAppAccountSelectors'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'

export type NetExplicitAccountAppId = 'pulse' | 'loop'

interface NetAppAccountRow {
  readonly id: string
  readonly app_id: string
  readonly identity_link_id: string | null
  readonly entity_id: string | null
  readonly organisation_id: string | null
  readonly handle: string
  readonly display_name_override: string | null
  readonly avatar_url_override: string | null
  readonly status: NetAppAccountStatus
  readonly created_at: string
  readonly updated_at: string
}

function client() {
  if (!supabase) throw new Error(SUPABASE_CONFIG_ERROR)
  return supabase
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function parseNetAppAccount(value: unknown): NetAppAccount {
  if (!isRecord(value)) throw new Error('Invalid NET app-account response.')

  const row = value as unknown as NetAppAccountRow
  const ownerCount = [row.identity_link_id, row.entity_id, row.organisation_id]
    .filter((entry) => typeof entry === 'string' && entry.length > 0).length
  const normalizedHandle = typeof row.handle === 'string'
    ? normalizeNetHandle(row.handle)
    : undefined

  if (
    typeof row.id !== 'string'
    || !row.id
    || !['iden', 'echo', 'pulse', 'loop', 'nvn', 'net-store'].includes(row.app_id)
    || ownerCount !== 1
    || !normalizedHandle
    || normalizedHandle !== row.handle
    || !['active', 'suspended', 'disabled'].includes(row.status)
    || typeof row.created_at !== 'string'
    || typeof row.updated_at !== 'string'
  ) {
    throw new Error('Invalid NET app-account fields returned by the server.')
  }

  const owner = row.identity_link_id
    ? { type: 'identity-link' as const, identityLinkId: row.identity_link_id }
    : row.entity_id
      ? { type: 'entity' as const, entityId: row.entity_id }
      : { type: 'organisation' as const, organisationId: row.organisation_id as string }

  return {
    id: row.id,
    appId: row.app_id as NetAppId,
    owner,
    handle: normalizedHandle,
    ...(typeof row.display_name_override === 'string' && row.display_name_override
      ? { displayNameOverride: row.display_name_override }
      : {}),
    ...(typeof row.avatar_url_override === 'string' && row.avatar_url_override
      ? { avatarUrlOverride: row.avatar_url_override }
      : {}),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function assertIdentityLinkId(identityLinkId: string): string {
  const normalized = identityLinkId.trim()
  if (!normalized) throw new Error('A server identity link is required for an application account.')
  return normalized
}

/** The server derives and locks the exact normal/control runtime identity. */
async function fetchNetAppAccounts(
  identityLinkId: string,
  rpcName: 'fetch_net_runtime_app_accounts' | 'fetch_net_gm_inspected_app_accounts',
): Promise<readonly NetAppAccount[]> {
  const normalizedLinkId = assertIdentityLinkId(identityLinkId)
  const { data, error } = await client().rpc(rpcName, {
    requested_expected_identity_link_id: normalizedLinkId,
  })
  if (error) {
    throw new Error(`NET application accounts could not be loaded: ${error.message}`)
  }
  const rows = (data as unknown[] | null) ?? []
  return rows
    // Retired application accounts can remain in deployed history. They are
    // deliberately ignored at the client boundary so one old row cannot make
    // the current VEIL OS account registry fail to load.
    .filter((row) => !isRecord(row) || row.app_id !== 'altara')
    .map(parseNetAppAccount)
}

export function fetchNetAppAccountsForIdentity(
  identityLinkId: string,
): Promise<readonly NetAppAccount[]> {
  return fetchNetAppAccounts(identityLinkId, 'fetch_net_runtime_app_accounts')
}

export async function fetchNetAppAccount(
  appId: NetAppId,
  identityLinkId: string,
): Promise<NetAppAccount | null> {
  const accounts = await fetchNetAppAccountsForIdentity(identityLinkId)
  return accounts.find((account) => account.appId === appId) ?? null
}

/** Explicit creation never accepts an owner profile or any GM-authority claim. */
export async function createExplicitNetAppAccount(input: {
  readonly identityLinkId: string
  readonly appId: NetExplicitAccountAppId
  readonly handle: string
  readonly displayNameOverride?: string
  readonly avatarUrlOverride?: string
}): Promise<NetAppAccount> {
  const normalizedLinkId = assertIdentityLinkId(input.identityLinkId)
  const normalizedHandle = normalizeNetHandle(input.handle)
  if (!normalizedHandle) throw new Error('Application handle is invalid.')

  const { data, error } = await client().rpc('create_net_app_account', {
    requested_identity_link_id: normalizedLinkId,
    requested_app_id: input.appId,
    requested_handle: normalizedHandle,
    requested_display_name_override: input.displayNameOverride ?? null,
    requested_avatar_url_override: input.avatarUrlOverride ?? null,
  })

  if (error) throw new Error(`${input.appId.toUpperCase()} account could not be created: ${error.message}`)
  return parseNetAppAccount(Array.isArray(data) ? data[0] : data)
}

/** Same RLS-safe read contract reserved for the future GM account-inspection surface. */
export function fetchNetAppAccountsForInspection(
  identityLinkId: string,
): Promise<readonly NetAppAccount[]> {
  return fetchNetAppAccounts(identityLinkId, 'fetch_net_gm_inspected_app_accounts')
}
