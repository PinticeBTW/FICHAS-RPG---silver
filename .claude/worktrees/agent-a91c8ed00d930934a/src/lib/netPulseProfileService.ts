import type { NetAppAccount } from '../components/net/accounts/netAppAccountTypes'
import { normalizeNetHandle } from '../components/net/accounts/netAppAccountSelectors'
import { parseNetAppAccount } from './netAppAccountService'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'
import {
  mapNetPulseRpcError,
  pulseContextRpcArgs,
  type NetPulseCompromisedRequestContext,
  type NetPulseRequestContext,
} from './netPulseRequestContext'

export type NetPulseProfileVisibility = 'public' | 'limited'
export type NetPulseDefaultFeed = 'city' | 'following' | 'raw'

export interface NetPulseProfile {
  readonly accountId: string
  readonly handle: string
  readonly bio: string
  readonly visibility: NetPulseProfileVisibility
  readonly showDistrict: boolean
  readonly discoverable: boolean
  readonly defaultFeed: NetPulseDefaultFeed
  readonly createdAt: string
  readonly updatedAt: string
}

export interface NetPulseProfileInput {
  readonly bio: string
  readonly visibility: NetPulseProfileVisibility
  readonly showDistrict: boolean
  readonly discoverable: boolean
  readonly defaultFeed: NetPulseDefaultFeed
}

export interface NetPulsePublicProfileInput extends NetPulseProfileInput {
  readonly handle: string
}

interface NetPulseProfileRow {
  readonly account_id: string
  readonly bio: string | null
  readonly visibility: NetPulseProfileVisibility
  readonly show_district: boolean
  readonly discoverable: boolean
  readonly default_feed: NetPulseDefaultFeed
  readonly created_at: string
  readonly updated_at: string
}

interface NetPulsePublicProfileRow extends NetPulseProfileRow {
  readonly handle: string
}

function client() {
  if (!supabase) throw new Error(SUPABASE_CONFIG_ERROR)
  return supabase
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseProfile(value: unknown, fallbackHandle?: string): NetPulseProfile {
  if (!isRecord(value)) throw new Error('Invalid PULSE profile response.')
  const row = value as unknown as NetPulseProfileRow
  const handleValue = 'handle' in row ? (row as NetPulsePublicProfileRow).handle : fallbackHandle
  const handle = typeof handleValue === 'string' ? normalizeNetHandle(handleValue) : undefined
  if (
    typeof row.account_id !== 'string'
    || !row.account_id
    || !handle
    || !['public', 'limited'].includes(row.visibility)
    || typeof row.show_district !== 'boolean'
    || typeof row.discoverable !== 'boolean'
    || !['city', 'following', 'raw'].includes(row.default_feed)
    || typeof row.created_at !== 'string'
    || typeof row.updated_at !== 'string'
  ) {
    throw new Error('Invalid PULSE profile fields returned by the server.')
  }

  return {
    accountId: row.account_id,
    handle,
    bio: typeof row.bio === 'string' ? row.bio : '',
    visibility: row.visibility,
    showDistrict: row.show_district,
    discoverable: row.discoverable,
    defaultFeed: row.default_feed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function validateProfile(input: NetPulseProfileInput): NetPulseProfileInput {
  const bio = input.bio.trim()
  if (bio.length > 240) throw new Error('PULSE bios are limited to 240 characters.')
  if (!['public', 'limited'].includes(input.visibility)) {
    throw new Error('Choose a valid PULSE profile visibility.')
  }
  if (!['city', 'following', 'raw'].includes(input.defaultFeed)) {
    throw new Error('Choose a valid default PULSE feed.')
  }
  return { ...input, bio }
}

function validatePublicProfile(input: NetPulsePublicProfileInput): NetPulsePublicProfileInput {
  const handle = normalizeNetHandle(input.handle)
  if (!handle) throw new Error('Use letters, numbers, periods, underscores, or hyphens for the PULSE handle.')
  return { ...validateProfile(input), handle }
}

function mapProfileError(prefix: string, message: string): Error {
  if (message.includes('PULSE_HANDLE_TAKEN')) {
    return new Error('That PULSE handle is already registered.')
  }
  if (message.includes('PULSE_HANDLE_INVALID')) {
    return new Error('Use letters, numbers, periods, underscores, or hyphens for the PULSE handle.')
  }
  return mapNetPulseRpcError(prefix, message)
}

export function createDefaultNetPulseProfile(accountId: string, handle: string): NetPulseProfile {
  const normalizedHandle = normalizeNetHandle(handle)
  if (!normalizedHandle) throw new Error('A valid PULSE handle is required.')
  return {
    accountId,
    handle: normalizedHandle,
    bio: '',
    visibility: 'public',
    showDistrict: false,
    discoverable: true,
    defaultFeed: 'city',
    createdAt: '',
    updatedAt: '',
  }
}

/**
 * Read one explicitly referenced PULSE profile through the bounded server
 * boundary. The RPC masks account-owned preferences for non-controlling
 * viewers; broad discovery remains a separate, discoverability-aware reader.
 */
export async function fetchNetPulseProfile(
  accountId: string,
  fallbackHandle: string | undefined,
  context: NetPulseRequestContext,
): Promise<NetPulseProfile | null> {
  const normalizedAccountId = accountId.trim()
  if (!normalizedAccountId) throw new Error('A PULSE account is required.')
  const { data, error } = await client().rpc('fetch_net_pulse_profile', {
    requested_account_id: normalizedAccountId,
    ...pulseContextRpcArgs(context),
  })

  if (error) throw mapProfileError('PULSE profile could not be loaded', error.message)
  const row = Array.isArray(data) ? data[0] : data
  return row ? parseProfile(row, fallbackHandle) : null
}

/** Atomic owner save; the server derives ownership and writes its own audit. */
export async function saveNetPulseProfile(
  accountId: string,
  input: NetPulsePublicProfileInput,
): Promise<NetPulseProfile> {
  const normalizedAccountId = accountId.trim()
  if (!normalizedAccountId) throw new Error('A PULSE account is required.')
  const profile = validatePublicProfile(input)
  const { data, error } = await client().rpc('update_net_pulse_public_profile', {
    requested_account_id: normalizedAccountId,
    requested_handle: profile.handle,
    requested_bio: profile.bio,
    requested_visibility: profile.visibility,
    requested_show_district: profile.showDistrict,
    requested_discoverable: profile.discoverable,
    requested_default_feed: profile.defaultFeed,
    requested_expected_account_id: normalizedAccountId,
  })

  if (error) throw mapProfileError('PULSE profile could not be saved', error.message)
  return parseProfile(Array.isArray(data) ? data[0] : data)
}

/** The target account is derived only from the GM's compromised server session. */
export async function saveNetPulseProfileAsCompromised(
  input: NetPulsePublicProfileInput,
  context: NetPulseCompromisedRequestContext,
): Promise<NetPulseProfile> {
  const profile = validatePublicProfile(input)
  const { data, error } = await client().rpc('update_net_pulse_profile_as_compromised_persona', {
    requested_handle: profile.handle,
    requested_bio: profile.bio,
    requested_visibility: profile.visibility,
    requested_show_district: profile.showDistrict,
    requested_discoverable: profile.discoverable,
    requested_default_feed: profile.defaultFeed,
    requested_expected_session_generation: context.expectedSessionGeneration,
    requested_expected_account_id: context.expectedAccountId,
  })

  if (error) throw mapProfileError('Compromised PULSE profile could not be saved', error.message)
  return parseProfile(Array.isArray(data) ? data[0] : data)
}

/** Atomic first launch: account and PULSE-owned profile commit together. */
export async function createNetPulseAccountWithProfile(input: {
  readonly identityLinkId: string
  readonly handle: string
  readonly profile: NetPulseProfileInput
}): Promise<NetAppAccount> {
  const identityLinkId = input.identityLinkId.trim()
  const handle = normalizeNetHandle(input.handle)
  if (!identityLinkId) throw new Error('An active server-backed character is required.')
  if (!handle) throw new Error('PULSE handle is invalid.')
  const profile = validateProfile(input.profile)
  const { data, error } = await client().rpc('create_net_pulse_account_with_profile', {
    requested_identity_link_id: identityLinkId,
    requested_handle: handle,
    requested_bio: profile.bio,
    requested_visibility: profile.visibility,
    requested_show_district: profile.showDistrict,
    requested_discoverable: profile.discoverable,
    requested_default_feed: profile.defaultFeed,
    requested_expected_identity_link_id: identityLinkId,
  })

  if (error) throw mapProfileError('PULSE account could not be created', error.message)
  return parseNetAppAccount(Array.isArray(data) ? data[0] : data)
}
