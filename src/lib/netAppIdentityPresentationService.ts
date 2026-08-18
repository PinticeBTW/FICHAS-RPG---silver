import { isSharedMediaReference } from './media/mediaReference'
import { resolveSharedMediaUrl } from './media/mediaStorage'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'

export interface NetAppIdentityProfile {
  readonly identityLinkId: string
  readonly appId: string
  readonly customDisplayName?: string
  readonly customAvatarRef?: string
  readonly canonicalDisplayName: string
  readonly canonicalAvatarUrl?: string
  readonly effectiveDisplayName: string
  readonly effectiveAvatarUrl?: string
}

function client() {
  if (!supabase) throw new Error(SUPABASE_CONFIG_ERROR)
  return supabase
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`APP PROFILE returned an invalid ${label}.`)
  }
  return value as Record<string, unknown>
}

function requiredString(row: Record<string, unknown>, key: string, label: string): string {
  const value = row[key]
  if (typeof value !== 'string' || !value) {
    throw new Error(`APP PROFILE returned an invalid ${label}.`)
  }
  return value
}

function optionalString(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key]
  return typeof value === 'string' && value ? value : undefined
}

function parseProfile(value: unknown): NetAppIdentityProfile {
  const row = record(value, 'app profile')
  return {
    identityLinkId: requiredString(row, 'identity_link_id', 'identity link'),
    appId: requiredString(row, 'app_id', 'app id'),
    ...(optionalString(row, 'custom_display_name') ? { customDisplayName: optionalString(row, 'custom_display_name') } : {}),
    ...(optionalString(row, 'custom_avatar_ref') ? { customAvatarRef: optionalString(row, 'custom_avatar_ref') } : {}),
    canonicalDisplayName: requiredString(row, 'canonical_display_name', 'canonical display name'),
    ...(optionalString(row, 'canonical_avatar_url') ? { canonicalAvatarUrl: optionalString(row, 'canonical_avatar_url') } : {}),
    effectiveDisplayName: requiredString(row, 'effective_display_name', 'effective display name'),
    ...(optionalString(row, 'effective_avatar_url') ? { effectiveAvatarUrl: optionalString(row, 'effective_avatar_url') } : {}),
  }
}

/**
 * Every app-local avatar field carries the same opaque rpg-media shared
 * reference format used across THE NET (never a raw URL, never base64).
 * Resolve display/canonical avatar fields to signed URLs in one batch so the
 * editor can render both previews without a bespoke resolver per field.
 */
export async function resolveNetAppProfileAvatarUrls(
  profile: NetAppIdentityProfile,
): Promise<{ readonly effectiveAvatarUrl?: string; readonly canonicalAvatarUrl?: string }> {
  const resolve = async (value: string | undefined) => {
    if (!value) return undefined
    if (!isSharedMediaReference(value)) return value
    try {
      return await resolveSharedMediaUrl(value, 'thumbnail')
    } catch {
      return undefined
    }
  }

  const [effectiveAvatarUrl, canonicalAvatarUrl] = await Promise.all([
    resolve(profile.effectiveAvatarUrl),
    resolve(profile.canonicalAvatarUrl),
  ])

  return {
    ...(effectiveAvatarUrl ? { effectiveAvatarUrl } : {}),
    ...(canonicalAvatarUrl ? { canonicalAvatarUrl } : {}),
  }
}

/** Owner-only: the caller's own current legitimate identity for this app. */
export async function fetchNetAppIdentityProfileEditor(
  appId: string,
  expectedIdentityLinkId: string,
): Promise<NetAppIdentityProfile> {
  const { data, error } = await client().rpc('fetch_net_app_identity_profile_editor', {
    requested_app_id: appId,
    requested_expected_identity_link_id: expectedIdentityLinkId,
  })
  if (error) throw new Error(`APP PROFILE could not be loaded: ${error.message}`)
  return parseProfile(data)
}

/**
 * Upserts (or, when both fields are empty, resets/deletes) the caller's own
 * app-local override. Passing empty strings for both fields is the RESET
 * TO CHARACTER DEFAULT action.
 */
export async function saveNetAppIdentityPresentation(
  appId: string,
  expectedIdentityLinkId: string,
  displayName: string,
  avatarRef: string,
): Promise<NetAppIdentityProfile> {
  const { data, error } = await client().rpc('set_net_app_identity_presentation', {
    requested_app_id: appId,
    requested_expected_identity_link_id: expectedIdentityLinkId,
    requested_display_name: displayName.trim() || null,
    requested_avatar_ref: avatarRef.trim() || null,
  })
  if (error) throw new Error(`APP PROFILE could not be saved: ${error.message}`)
  return parseProfile(data)
}
