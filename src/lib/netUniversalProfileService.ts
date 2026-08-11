import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'

export interface NetUniversalProfile {
  readonly identityLinkId: string
  readonly displayNameOverride?: string
  readonly bio?: string
  readonly status?: string
  readonly avatarUrlOverride?: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface NetUniversalProfileInput {
  readonly identityLinkId: string
  readonly displayNameOverride?: string
  readonly bio?: string
  readonly status?: string
  readonly avatarUrlOverride?: string
}

function client() {
  if (!supabase) throw new Error(SUPABASE_CONFIG_ERROR)
  return supabase
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (typeof value !== 'string' || !value) {
    throw new Error(`Invalid Universal NET Profile response field: ${key}`)
  }
  return value
}

function optionalString(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key]
  return typeof value === 'string' && value ? value : undefined
}

function parseUniversalProfile(value: unknown): NetUniversalProfile {
  if (!isRecord(value)) throw new Error('Invalid Universal NET Profile response.')

  const displayNameOverride = optionalString(value, 'display_name_override')
  const bio = optionalString(value, 'bio')
  const status = optionalString(value, 'status')
  const avatarUrlOverride = optionalString(value, 'avatar_url_override')

  return {
    identityLinkId: requiredString(value, 'identity_link_id'),
    ...(displayNameOverride ? { displayNameOverride } : {}),
    ...(bio ? { bio } : {}),
    ...(status ? { status } : {}),
    ...(avatarUrlOverride ? { avatarUrlOverride } : {}),
    createdAt: requiredString(value, 'created_at'),
    updatedAt: requiredString(value, 'updated_at'),
  }
}

/** RLS exposes only a profile owned through a currently playable identity link. */
export async function fetchUniversalNetProfile(
  identityLinkId: string,
): Promise<NetUniversalProfile | null> {
  if (!identityLinkId.trim()) return null

  const { data, error } = await client()
    .from('net_universal_profiles')
    .select('identity_link_id, display_name_override, bio, status, avatar_url_override, created_at, updated_at')
    .eq('identity_link_id', identityLinkId)
    .maybeSingle()

  if (error) throw new Error(`Universal NET Profile could not be loaded: ${error.message}`)
  if (!data) return null

  const profile = parseUniversalProfile(data)
  if (profile.identityLinkId !== identityLinkId) {
    throw new Error('Universal NET Profile response did not match the requested identity.')
  }
  return profile
}

/** The RPC derives control permission from auth.uid(); no owner claim is sent. */
export async function saveUniversalNetProfile(
  input: NetUniversalProfileInput,
): Promise<NetUniversalProfile> {
  if (!input.identityLinkId.trim()) throw new Error('An identity link is required.')

  const { data, error } = await client().rpc('upsert_net_universal_profile', {
    requested_identity_link_id: input.identityLinkId,
    requested_display_name_override: input.displayNameOverride ?? null,
    requested_bio: input.bio ?? null,
    requested_status: input.status ?? null,
    requested_avatar_url_override: input.avatarUrlOverride ?? null,
  })

  if (error) throw new Error(`Universal NET Profile could not be saved: ${error.message}`)
  const profile = parseUniversalProfile(Array.isArray(data) ? data[0] : data)
  if (profile.identityLinkId !== input.identityLinkId) {
    throw new Error('Universal NET Profile response did not match the requested identity.')
  }
  return profile
}
