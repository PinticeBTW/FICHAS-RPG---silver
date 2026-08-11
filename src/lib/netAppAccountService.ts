import type { NetAppId } from '../components/net/netAppCatalog'
import type {
  NetAppAccount,
  NetAppAccountStatus,
} from '../components/net/accounts/netAppAccountTypes'
import { normalizeNetHandle } from '../components/net/accounts/netAppAccountSelectors'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'

export type NetAutomaticAccountAppId = 'iden'
export type NetExplicitAccountAppId = 'echo' | 'pulse' | 'loop'

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

const accountColumns = [
  'id',
  'app_id',
  'identity_link_id',
  'entity_id',
  'organisation_id',
  'handle',
  'display_name_override',
  'avatar_url_override',
  'status',
  'created_at',
  'updated_at',
].join(', ')

function assertIdentityLinkId(identityLinkId: string): string {
  const normalized = identityLinkId.trim()
  if (!normalized) throw new Error('A server identity link is required for an application account.')
  return normalized
}

/** RLS returns only account metadata visible to the authenticated actor. */
export async function fetchNetAppAccountsForIdentity(
  identityLinkId: string,
  canonicalEntityId?: string,
): Promise<readonly NetAppAccount[]> {
  const normalizedLinkId = assertIdentityLinkId(identityLinkId)
  const database = client()
  const [identityResult, entityResult] = await Promise.all([
    database
      .from('net_app_accounts')
      .select(accountColumns)
      .eq('identity_link_id', normalizedLinkId)
      .order('created_at', { ascending: true }),
    canonicalEntityId
      ? database
          .from('net_app_accounts')
          .select(accountColumns)
          .eq('entity_id', canonicalEntityId)
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ])

  if (identityResult.error) {
    throw new Error(`NET application accounts could not be loaded: ${identityResult.error.message}`)
  }
  if (entityResult.error) {
    throw new Error(`Canonical NET application accounts could not be loaded: ${entityResult.error.message}`)
  }
  const rows = [
    ...((identityResult.data as unknown[] | null) ?? []),
    ...((entityResult.data as unknown[] | null) ?? []),
  ]
  return rows
    // Retired application accounts can remain in deployed history. They are
    // deliberately ignored at the client boundary so one old row cannot make
    // the current VEIL OS account registry fail to load.
    .filter((row) => !isRecord(row) || row.app_id !== 'altara')
    .map(parseNetAppAccount)
}

export async function fetchNetAppAccount(
  appId: NetAppId,
  identityLinkId: string,
  canonicalEntityId?: string,
): Promise<NetAppAccount | null> {
  const accounts = await fetchNetAppAccountsForIdentity(identityLinkId, canonicalEntityId)
  return accounts.find((account) => account.appId === appId) ?? null
}

/** The RPC derives auth.uid(), verifies identity control, and provisions IDEN only. */
export async function ensureAutomaticNetAppAccount(
  identityLinkId: string,
  appId: NetAutomaticAccountAppId,
): Promise<NetAppAccount> {
  const normalizedLinkId = assertIdentityLinkId(identityLinkId)
  const { data, error } = await client().rpc('ensure_net_app_account', {
    requested_identity_link_id: normalizedLinkId,
    requested_app_id: appId,
  })

  if (error) throw new Error(`${appId.toUpperCase()} account could not be provisioned: ${error.message}`)
  return parseNetAppAccount(Array.isArray(data) ? data[0] : data)
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
  canonicalEntityId?: string,
): Promise<readonly NetAppAccount[]> {
  return fetchNetAppAccountsForIdentity(identityLinkId, canonicalEntityId)
}
