import { normalizeNetHandle } from '../components/net/accounts/netAppAccountSelectors'
import type { NetAppAccountStatus } from '../components/net/accounts/netAppAccountTypes'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'
import { resolveSharedMediaUrls } from './media/mediaStorage'
import { isSharedMediaReference } from './media/mediaReference'
import { mapNetPulseRpcError } from './netPulseRequestContext'

export interface NetPulseAccountSummary {
  readonly accountId: string
  readonly handle: string
  readonly avatarUrl?: string
  readonly bio: string
  readonly visibility: 'public' | 'limited'
  readonly discoverable: boolean
  readonly status: NetAppAccountStatus
  readonly followers: number
  readonly following: number
  readonly pulses: number
  readonly viewerFollowing: boolean
}

export type NetPulseRelationshipDirection = 'followers' | 'following'

export interface NetPulseRelationshipCursor {
  readonly createdAt: string
  readonly accountId: string
}

export interface NetPulseRelationshipPage {
  readonly accounts: readonly NetPulseAccountSummary[]
  readonly nextCursor: NetPulseRelationshipCursor | null
  readonly hasMore: boolean
}

interface NetPulseAccountSummaryRow {
  readonly account_id: string
  readonly handle: string
  readonly avatar_url: string | null
  readonly bio: string | null
  readonly visibility: 'public' | 'limited'
  readonly discoverable: boolean
  readonly status: NetAppAccountStatus
  readonly followers_count: number
  readonly following_count: number
  readonly pulses_count: number
  readonly viewer_following: boolean
}

function client() {
  if (!supabase) throw new Error(SUPABASE_CONFIG_ERROR)
  return supabase
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseCount(value: unknown, label: string): number {
  const count = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Invalid ${label} returned by PULSE.`)
  }
  return count
}

function parseSummary(value: unknown): NetPulseAccountSummary {
  if (!isRecord(value)) throw new Error('Invalid PULSE account summary response.')
  const row = value as unknown as NetPulseAccountSummaryRow
  const handle = normalizeNetHandle(row.handle)
  if (
    typeof row.account_id !== 'string'
    || !row.account_id
    || !handle
    || !['public', 'limited'].includes(row.visibility)
    || typeof row.discoverable !== 'boolean'
    || !['active', 'suspended', 'disabled'].includes(row.status)
    || typeof row.viewer_following !== 'boolean'
  ) {
    throw new Error('Invalid PULSE account summary fields returned by the server.')
  }
  return {
    accountId: row.account_id,
    handle,
    ...(typeof row.avatar_url === 'string' && row.avatar_url.trim()
      ? { avatarUrl: row.avatar_url.trim() }
      : {}),
    bio: typeof row.bio === 'string' ? row.bio : '',
    visibility: row.visibility,
    discoverable: row.discoverable,
    status: row.status,
    followers: parseCount(row.followers_count, 'follower count'),
    following: parseCount(row.following_count, 'following count'),
    pulses: parseCount(row.pulses_count, 'Pulse count'),
    viewerFollowing: row.viewer_following,
  }
}

async function parseSummaries(values: readonly unknown[]): Promise<NetPulseAccountSummary[]> {
  const summaries = values.map(parseSummary)
  const references = summaries.map((summary) => summary.avatarUrl).filter(
    (value): value is string => Boolean(value && isSharedMediaReference(value)),
  )
  if (!references.length) return summaries
  try {
    const urls = await resolveSharedMediaUrls(references, 'thumbnail')
    return summaries.map((summary) => {
      if (!summary.avatarUrl || !isSharedMediaReference(summary.avatarUrl)) return summary
      const avatarUrl = urls.get(summary.avatarUrl)
      return avatarUrl ? { ...summary, avatarUrl } : summary
    })
  } catch {
    return summaries
  }
}

async function setBooleanRpc(
  rpc: 'set_net_pulse_follow' | 'set_net_pulse_reaction' | 'set_net_pulse_boost' | 'set_net_pulse_bookmark',
  args: Record<string, string | boolean>,
  desired: boolean,
  label: string,
): Promise<boolean> {
  const { data, error } = await client().rpc(rpc, args)
  if (error) throw mapNetPulseRpcError(`${label} could not be updated`, error.message)
  const result = Array.isArray(data) ? data[0] : data
  if (result !== desired) throw new Error(`${label} returned an invalid server state.`)
  return result
}

export function setNetPulseFollow(
  targetAccountId: string,
  desiredFollowing: boolean,
  expectedAccountId: string,
): Promise<boolean> {
  const target = targetAccountId.trim()
  if (!target) throw new Error('A target PULSE account is required.')
  return setBooleanRpc('set_net_pulse_follow', {
    requested_target_account_id: target,
    requested_following: desiredFollowing,
    requested_expected_account_id: expectedAccountId,
  }, desiredFollowing, 'PULSE follow state')
}

export function setNetPulseReaction(postId: string, desiredReacted: boolean, expectedAccountId: string): Promise<boolean> {
  const post = postId.trim()
  if (!post) throw new Error('A server-backed PULSE is required.')
  return setBooleanRpc('set_net_pulse_reaction', {
    requested_post_id: post,
    requested_reacted: desiredReacted,
    requested_expected_account_id: expectedAccountId,
  }, desiredReacted, 'PULSE reaction')
}

export function setNetPulseBoost(postId: string, desiredBoosted: boolean, expectedAccountId: string): Promise<boolean> {
  const post = postId.trim()
  if (!post) throw new Error('A server-backed PULSE is required.')
  return setBooleanRpc('set_net_pulse_boost', {
    requested_post_id: post,
    requested_boosted: desiredBoosted,
    requested_expected_account_id: expectedAccountId,
  }, desiredBoosted, 'PULSE boost')
}

export function setNetPulseBookmark(postId: string, desiredBookmarked: boolean, expectedAccountId: string): Promise<boolean> {
  const post = postId.trim()
  if (!post) throw new Error('A server-backed PULSE is required.')
  return setBooleanRpc('set_net_pulse_bookmark', {
    requested_post_id: post,
    requested_bookmarked: desiredBookmarked,
    requested_expected_account_id: expectedAccountId,
  }, desiredBookmarked, 'PULSE bookmark')
}

export async function fetchNetPulseAccountSummary(
  accountId: string,
  expectedAccountId: string | null,
): Promise<NetPulseAccountSummary | null> {
  const account = accountId.trim()
  if (!account) throw new Error('A PULSE account is required.')
  const { data, error } = await client().rpc('fetch_net_pulse_account_summaries', {
    requested_query: null,
    requested_account_id: account,
    requested_limit: 1,
    requested_expected_account_id: expectedAccountId,
  })
  if (error) throw mapNetPulseRpcError('PULSE account summary could not be loaded', error.message)
  const rows = (data as unknown[] | null) ?? []
  return rows.length > 0 ? (await parseSummaries([rows[0]]))[0] ?? null : null
}

export async function searchNetPulseAccounts(
  query: string,
  expectedAccountId: string | null,
  limit = 16,
): Promise<readonly NetPulseAccountSummary[]> {
  const normalized = query.trim().replace(/^@/, '')
  if (normalized.length < 2) return []
  if (normalized.length > 80) throw new Error('PULSE account search is limited to 80 characters.')
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 30)
  const { data, error } = await client().rpc('fetch_net_pulse_account_summaries', {
    requested_query: normalized,
    requested_account_id: null,
    requested_limit: safeLimit,
    requested_expected_account_id: expectedAccountId,
  })
  if (error) throw mapNetPulseRpcError('PULSE account search could not be loaded', error.message)
  return parseSummaries((data as unknown[] | null) ?? [])
}

export async function fetchNetPulseDiscoverAccounts(
  expectedAccountId: string | null,
  limit = 12,
): Promise<readonly NetPulseAccountSummary[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 50)
  const { data, error } = await client().rpc('fetch_net_pulse_discover_accounts', {
    requested_limit: safeLimit,
    requested_expected_account_id: expectedAccountId,
  })
  if (error) throw mapNetPulseRpcError('PULSE public accounts could not be loaded', error.message)
  return parseSummaries((data as unknown[] | null) ?? [])
}

export async function fetchNetPulseRelationshipAccounts(
  profileAccountId: string,
  direction: NetPulseRelationshipDirection,
  expectedAccountId: string | null,
  limit = 200,
): Promise<readonly NetPulseAccountSummary[]> {
  const accountId = profileAccountId.trim()
  if (!accountId) throw new Error('A PULSE profile account is required.')
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 200)
  const { data, error } = await client().rpc('fetch_net_pulse_relationship_accounts', {
    requested_profile_account_id: accountId,
    requested_direction: direction,
    requested_limit: safeLimit,
    requested_expected_account_id: expectedAccountId,
  })
  if (error) throw mapNetPulseRpcError(`PULSE ${direction} could not be loaded`, error.message)
  return parseSummaries((data as unknown[] | null) ?? [])
}

export async function fetchNetPulseRelationshipPage(
  profileAccountId: string,
  direction: NetPulseRelationshipDirection,
  expectedAccountId: string | null,
  cursor: NetPulseRelationshipCursor | null = null,
  limit = 30,
): Promise<NetPulseRelationshipPage> {
  const accountId = profileAccountId.trim()
  if (!accountId) throw new Error('A PULSE profile account is required.')
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 40)
  const { data, error } = await client().rpc('fetch_net_pulse_relationship_page', {
    requested_profile_account_id: accountId,
    requested_direction: direction,
    requested_cursor_at: cursor?.createdAt ?? null,
    requested_cursor_account_id: cursor?.accountId ?? null,
    requested_limit: safeLimit,
    requested_expected_account_id: expectedAccountId,
  })
  if (error) throw mapNetPulseRpcError(`PULSE ${direction} could not be loaded`, error.message)
  const rows = ((data as unknown[] | null) ?? [])
  const accounts = await parseSummaries(rows)
  const lastRow = rows.at(-1)
  const nextCursor = isRecord(lastRow)
    && typeof lastRow.relationship_created_at === 'string'
    && typeof lastRow.account_id === 'string'
    ? { createdAt: lastRow.relationship_created_at, accountId: lastRow.account_id }
    : null
  return {
    accounts,
    nextCursor,
    hasMore: rows.some((row) => isRecord(row) && row.page_has_more === true),
  }
}
