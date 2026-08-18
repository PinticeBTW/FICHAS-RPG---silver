import {
  isNetOptionalAppId,
  type NetOptionalAppId,
} from '../components/net/netAppCatalog'
import {
  validateWallpaperFile,
  type WallpaperFit,
  type WallpaperPosition,
} from './netWallpaperStore'
import { isNetOsId, type NetOsId } from './netOsTypes'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'
import { optimizeImage } from './media/imageOptimization'
import {
  cacheMediaInflight,
  cacheSignedMediaUrl,
  readMediaInflight,
  readSignedMediaUrl,
} from './media/mediaCache'
import { SHARED_MEDIA_IMMUTABLE_CACHE_CONTROL } from './media/mediaTypes'

const WALLPAPER_BUCKET = 'net-wallpapers'
const WALLPAPER_SIGNED_URL_SECONDS = 60 * 60
const WALLPAPER_SIGNED_URL_CACHE_MS = 55 * 60 * 1000

export interface NetIdentitySystemWallpaper {
  readonly path: string
  readonly signedUrl: string
  readonly fit: WallpaperFit
  readonly position: WallpaperPosition
}

export interface NetIdentitySystemSnapshot {
  readonly identityLinkId: string
  readonly installedOptionalAppIds: readonly NetOptionalAppId[]
  readonly wallpaper: NetIdentitySystemWallpaper | null
  readonly wallpaperPresetId: string | null
  readonly updatedAt: string | null
}

interface NetIdentitySystemProfileRow {
  readonly identity_link_id: string
  readonly wallpaper_path: string | null
  readonly wallpaper_preset_id: string | null
  readonly wallpaper_fit: WallpaperFit
  readonly wallpaper_position: WallpaperPosition
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

function parseSystemProfile(value: unknown): NetIdentitySystemProfileRow | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) throw new Error('Invalid NET system profile response.')

  const identityLinkId = value.identity_link_id
  const wallpaperPath = value.wallpaper_path
  const wallpaperPresetId = value.wallpaper_preset_id
  const fit = value.wallpaper_fit
  const position = value.wallpaper_position
  const createdAt = value.created_at
  const updatedAt = value.updated_at

  if (
    typeof identityLinkId !== 'string'
    || (wallpaperPath !== null && typeof wallpaperPath !== 'string')
    || (wallpaperPresetId !== null && typeof wallpaperPresetId !== 'string')
    || (fit !== 'cover' && fit !== 'contain')
    || (position !== 'center' && position !== 'top' && position !== 'bottom')
    || typeof createdAt !== 'string'
    || typeof updatedAt !== 'string'
  ) {
    throw new Error('Invalid NET system profile fields returned by the server.')
  }

  return {
    identity_link_id: identityLinkId,
    wallpaper_path: wallpaperPath,
    wallpaper_preset_id: wallpaperPresetId,
    wallpaper_fit: fit,
    wallpaper_position: position,
    created_at: createdAt,
    updated_at: updatedAt,
  }
}

function parseInstalledAppIds(value: unknown): NetOptionalAppId[] {
  if (!Array.isArray(value)) throw new Error('Invalid NET application library response.')

  return [...new Set(value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.app_id !== 'string') return []
    return isNetOptionalAppId(entry.app_id) ? [entry.app_id] : []
  }))]
}

function parseSystemPayload(value: unknown): {
  readonly identityLinkId: string
  readonly profile: NetIdentitySystemProfileRow | null
  readonly installs: NetOptionalAppId[]
} {
  if (!isRecord(value) || typeof value.identity_link_id !== 'string') {
    throw new Error('Invalid NET runtime system response.')
  }
  return {
    identityLinkId: value.identity_link_id,
    profile: parseSystemProfile(value.profile),
    installs: parseInstalledAppIds(value.installs),
  }
}

function assertIdentityLinkId(identityLinkId: string): string {
  const normalized = identityLinkId.trim()
  if (!normalized) throw new Error('An active character identity is required.')
  return normalized
}

async function createWallpaperSignedUrl(path: string): Promise<string> {
  const cacheKey = `${WALLPAPER_BUCKET}:${path}`
  const cached = readSignedMediaUrl(cacheKey)
  if (cached) return cached
  const active = readMediaInflight(cacheKey)
  if (active) return active
  const request = client().storage.from(WALLPAPER_BUCKET)
    .createSignedUrl(path, WALLPAPER_SIGNED_URL_SECONDS)
    .then(({ data, error }) => {
      if (error || !data?.signedUrl) {
        throw new Error(`Wallpaper could not be opened securely: ${error?.message ?? 'signed URL unavailable'}`)
      }
      cacheSignedMediaUrl(cacheKey, data.signedUrl, WALLPAPER_SIGNED_URL_CACHE_MS)
      return data.signedUrl
    })
  cacheMediaInflight(cacheKey, request)
  return request
}

/**
 * A wallpaper failure (e.g. the stored object was deleted) must never abort
 * the rest of the system snapshot -- installed apps and every other field
 * still need to load. Callers see a plain `null`, which the OS shell already
 * renders as its default wallpaper.
 */
async function resolveIdentitySystemWallpaper(
  profile: NetIdentitySystemProfileRow | null,
): Promise<NetIdentitySystemWallpaper | null> {
  if (!profile?.wallpaper_path) return null
  try {
    return {
      path: profile.wallpaper_path,
      signedUrl: await createWallpaperSignedUrl(profile.wallpaper_path),
      fit: profile.wallpaper_fit,
      position: profile.wallpaper_position,
    }
  } catch {
    return null
  }
}

async function fetchSystemSnapshot(
  identityLinkId: string,
  rpcName: 'fetch_net_runtime_identity_system' | 'fetch_net_gm_inspected_identity_system',
): Promise<NetIdentitySystemSnapshot> {
  const normalizedLinkId = assertIdentityLinkId(identityLinkId)
  const { data, error } = await client().rpc(rpcName, {
    requested_expected_identity_link_id: normalizedLinkId,
  })
  if (error) throw new Error(`NET system profile could not be loaded: ${error.message}`)
  const payload = parseSystemPayload(Array.isArray(data) ? data[0] : data)
  if (payload.identityLinkId !== normalizedLinkId) {
    throw new Error('The NET runtime identity changed while its system was loading.')
  }
  const profile = payload.profile
  const installedOptionalAppIds = payload.installs
  const wallpaper = await resolveIdentitySystemWallpaper(profile)

  return {
    identityLinkId: normalizedLinkId,
    installedOptionalAppIds,
    wallpaper,
    wallpaperPresetId: profile?.wallpaper_preset_id ?? null,
    updatedAt: profile?.updated_at ?? null,
  }
}

/** Loads only the active player's RLS-authorised fictional computer state. */
export function fetchNetIdentitySystem(identityLinkId: string): Promise<NetIdentitySystemSnapshot> {
  return fetchSystemSnapshot(identityLinkId, 'fetch_net_runtime_identity_system')
}

/**
 * Read-only foundation for a future GM System Snapshot surface. RLS decides
 * whether the authenticated actor may inspect the requested identity link.
 */
export function fetchNetIdentitySystemForInspection(
  identityLinkId: string,
): Promise<NetIdentitySystemSnapshot> {
  return fetchSystemSnapshot(identityLinkId, 'fetch_net_gm_inspected_identity_system')
}

export interface NetSystemHackingTargetSystemSnapshot extends NetIdentitySystemSnapshot {
  readonly displayName: string
  readonly osId: NetOsId | null
}

/**
 * Read-only system shell (wallpaper + installed-app-id list) for the
 * identity currently compromised by this actor's own active hacking
 * session. No identityLinkId parameter -- actor and target are both
 * resolved server-side from net_system_hacking_sessions, never
 * client-supplied. Individual apps are not projected here; only the
 * same narrow snapshot fetch_net_gm_inspected_identity_system already
 * safely provides for a GM's own compromised context.
 */
export async function fetchNetSystemHackingTargetSystem(): Promise<NetSystemHackingTargetSystemSnapshot> {
  const { data, error } = await client().rpc('fetch_net_system_hacking_target_system')
  if (error) throw new Error(`The compromised system could not be loaded: ${error.message}`)
  if (!isRecord(data)) throw new Error('Invalid compromised system response.')

  const displayName = data.display_name
  const osId = data.os_id
  if (typeof displayName !== 'string' || !displayName) {
    throw new Error('Invalid compromised system field: display_name')
  }
  if (osId !== null && !isNetOsId(osId)) {
    throw new Error('Invalid compromised system field: os_id')
  }

  const payload = parseSystemPayload(data)
  const profile = payload.profile
  const wallpaper = profile?.wallpaper_path
    ? {
        path: profile.wallpaper_path,
        signedUrl: await createWallpaperSignedUrl(profile.wallpaper_path),
        fit: profile.wallpaper_fit,
        position: profile.wallpaper_position,
      }
    : null

  return {
    identityLinkId: payload.identityLinkId,
    installedOptionalAppIds: payload.installs,
    wallpaper,
    wallpaperPresetId: profile?.wallpaper_preset_id ?? null,
    updatedAt: profile?.updated_at ?? null,
    displayName,
    osId,
  }
}

export async function setNetIdentityAppInstalled(
  identityLinkId: string,
  appId: NetOptionalAppId,
  installed: boolean,
): Promise<void> {
  const normalizedLinkId = assertIdentityLinkId(identityLinkId)
  if (!isNetOptionalAppId(appId)) throw new Error('This application cannot be installed from this OS catalogue.')

  const { error } = await client().rpc('set_net_identity_app_install', {
    requested_identity_link_id: normalizedLinkId,
    requested_app_id: appId,
    requested_installed: installed,
  })
  if (error) throw new Error(`Application library could not be updated: ${error.message}`)
}

export async function uploadNetIdentityWallpaper(
  identityLinkId: string,
  file: File,
  presentation: {
    readonly fit: WallpaperFit
    readonly position: WallpaperPosition
    readonly previousPath?: string
  },
): Promise<NetIdentitySystemWallpaper> {
  const normalizedLinkId = assertIdentityLinkId(identityLinkId)
  const validationError = validateWallpaperFile(file)
  if (validationError) throw new Error(validationError)

  const optimized = await optimizeImage(file, 'wallpaper')
  const display = optimized.variants.find((variant) => variant.name === 'display')
  if (!display) throw new Error('The wallpaper optimizer returned no display image.')
  const path = `${normalizedLinkId}/${optimized.contentHash.slice(0, 32)}/display.${display.extension}`
  const storage = client().storage.from(WALLPAPER_BUCKET)
  const { error: uploadError } = await storage.upload(path, display.blob, {
    cacheControl: SHARED_MEDIA_IMMUTABLE_CACHE_CONTROL,
    contentType: display.mimeType,
    upsert: false,
  })
  if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) {
    throw new Error(`Wallpaper upload failed: ${uploadError.message}`)
  }

  try {
    const signedUrl = await createWallpaperSignedUrl(path)
    const { data, error } = await client().rpc('set_net_identity_wallpaper', {
      requested_identity_link_id: normalizedLinkId,
      requested_wallpaper_path: path,
      requested_fit: presentation.fit,
      requested_position: presentation.position,
    })
    if (error) throw new Error(`Wallpaper profile could not be updated: ${error.message}`)
    const profile = parseSystemProfile(Array.isArray(data) ? data[0] : data)
    if (!profile?.wallpaper_path) throw new Error('The server did not confirm the new wallpaper.')

    const previousPath = presentation.previousPath
    if (previousPath && previousPath !== path && previousPath.startsWith(`${normalizedLinkId}/`)) {
      void storage.remove([previousPath]).catch(() => undefined)
    }

    return {
      path: profile.wallpaper_path,
      signedUrl,
      fit: profile.wallpaper_fit,
      position: profile.wallpaper_position,
    }
  } catch (error) {
    if (!uploadError) await storage.remove([path]).catch(() => undefined)
    throw error
  }
}

export async function updateNetIdentityWallpaperPresentation(
  identityLinkId: string,
  wallpaperPath: string,
  fit: WallpaperFit,
  position: WallpaperPosition,
): Promise<NetIdentitySystemWallpaper> {
  const normalizedLinkId = assertIdentityLinkId(identityLinkId)
  const signedUrl = await createWallpaperSignedUrl(wallpaperPath)
  const { data, error } = await client().rpc('set_net_identity_wallpaper', {
    requested_identity_link_id: normalizedLinkId,
    requested_wallpaper_path: wallpaperPath,
    requested_fit: fit,
    requested_position: position,
  })
  if (error) throw new Error(`Wallpaper presentation could not be updated: ${error.message}`)
  const profile = parseSystemProfile(Array.isArray(data) ? data[0] : data)
  if (!profile?.wallpaper_path) throw new Error('The server did not confirm the wallpaper presentation.')

  return {
    path: profile.wallpaper_path,
    signedUrl,
    fit: profile.wallpaper_fit,
    position: profile.wallpaper_position,
  }
}

export async function setNetIdentityWallpaperPreset(
  identityLinkId: string,
  presetId: string,
  previousPath?: string,
): Promise<string> {
  const normalizedLinkId = assertIdentityLinkId(identityLinkId)
  const normalizedPresetId = presetId.trim()
  if (!normalizedPresetId) throw new Error('A built-in wallpaper is required.')

  const { data, error } = await client().rpc('set_net_identity_wallpaper_preset', {
    requested_identity_link_id: normalizedLinkId,
    requested_preset_id: normalizedPresetId,
  })
  if (error) throw new Error(`Built-in wallpaper could not be saved: ${error.message}`)
  const profile = parseSystemProfile(Array.isArray(data) ? data[0] : data)
  if (profile?.wallpaper_preset_id !== normalizedPresetId || profile.wallpaper_path !== null) {
    throw new Error('The server did not confirm the built-in wallpaper.')
  }

  if (previousPath && previousPath.startsWith(`${normalizedLinkId}/`)) {
    await client().storage.from(WALLPAPER_BUCKET).remove([previousPath]).catch(() => undefined)
  }
  return normalizedPresetId
}

export async function clearNetIdentityWallpaper(
  identityLinkId: string,
  previousPath?: string,
): Promise<void> {
  const normalizedLinkId = assertIdentityLinkId(identityLinkId)
  const { error } = await client().rpc('clear_net_identity_wallpaper', {
    requested_identity_link_id: normalizedLinkId,
  })
  if (error) throw new Error(`Default wallpaper could not be restored: ${error.message}`)

  if (previousPath && previousPath.startsWith(`${normalizedLinkId}/`)) {
    await client().storage.from(WALLPAPER_BUCKET).remove([previousPath]).catch(() => undefined)
  }
}
