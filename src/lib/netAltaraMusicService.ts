import {
  buildRpgAudioObjectPath,
  inspectRpgAudioFile,
  removeRpgAudioObject,
  signRpgAudioObject,
  uploadRpgAudioObject,
} from './audio/audioStorage'
import {
  NET_ALTARA_MUSIC_MAX_DURATION_MS,
  NET_ALTARA_MUSIC_MAX_FILE_BYTES,
  netAltaraMusicReleaseTypes,
  netAltaraMusicStatuses,
  type NetAltaraMusicArtist,
  type NetAltaraMusicArtistDetail,
  type NetAltaraMusicCollection,
  type NetAltaraMusicGmArtist,
  type NetAltaraMusicGmPlaylist,
  type NetAltaraMusicGmRelease,
  type NetAltaraMusicGmTrack,
  type NetAltaraMusicLibrary,
  type NetAltaraMusicPlaylist,
  type NetAltaraMusicPlaylistDetail,
  type NetAltaraMusicRelease,
  type NetAltaraMusicReleaseDetail,
  type NetAltaraMusicReleaseType,
  type NetAltaraMusicStatus,
  type NetAltaraMusicStudioPayload,
  type NetAltaraMusicTrack,
} from './netAltaraMusicTypes'
import type { NetNvnRadioAudioMetadata } from './netNvnRadioTypes'
import { prewarmSharedMediaUrls } from './media/mediaStorage'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'

type JsonRecord = Record<string, unknown>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function client() {
  if (!supabase) throw new Error(SUPABASE_CONFIG_ERROR)
  return supabase
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label} response.`)
  return value as JsonRecord
}

function text(value: unknown, label: string, max = 4096): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${label}.`)
  return value
}

function optionalText(value: unknown, label: string, max = 4096): string | undefined {
  return value == null ? undefined : text(value, label, max)
}

function uuid(value: unknown, label: string): string {
  const parsed = text(value, label, 64)
  if (!UUID.test(parsed)) throw new Error(`Invalid ${label}.`)
  return parsed
}

function integer(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`Invalid ${label}.`)
  return parsed
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid ${label}.`)
  return value
}

function choice<const T extends readonly string[]>(value: unknown, values: T, label: string): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) throw new Error(`Invalid ${label}.`)
  return value as T[number]
}

function list<T>(value: unknown, parser: (entry: unknown) => T, max: number, label: string): T[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Invalid bounded ${label}.`)
  return value.map(parser)
}

function parseArtist(value: unknown): NetAltaraMusicArtist {
  const row = record(value, 'artist')
  return {
    id: uuid(row.id, 'artist id'),
    name: text(row.name, 'artist name', 120),
    slug: text(row.slug, 'artist slug', 120),
    ...(optionalText(row.avatar_ref, 'artist avatar') ? { avatarRef: String(row.avatar_ref) } : {}),
    ...(optionalText(row.banner_ref, 'artist banner') ? { bannerRef: String(row.banner_ref) } : {}),
    ...(optionalText(row.bio, 'artist biography', 4000) ? { bio: String(row.bio) } : {}),
    featured: bool(row.featured, 'artist featured state'),
  }
}

function parseRelease(value: unknown): NetAltaraMusicRelease {
  const row = record(value, 'release')
  return {
    id: uuid(row.id, 'release id'),
    artistId: uuid(row.artist_id, 'release artist id'),
    artistName: text(row.artist_name, 'release artist name', 120),
    title: text(row.title, 'release title', 160),
    slug: text(row.slug, 'release slug', 140),
    releaseType: choice(row.release_type, netAltaraMusicReleaseTypes, 'release type') as NetAltaraMusicReleaseType,
    ...(optionalText(row.cover_ref, 'release cover') ? { coverRef: String(row.cover_ref) } : {}),
    ...(optionalText(row.release_date, 'release date', 32) ? { releaseDate: String(row.release_date) } : {}),
    ...(optionalText(row.description, 'release description', 4000) ? { description: String(row.description) } : {}),
    featured: bool(row.featured, 'release featured state'),
  }
}

function parseTrack(value: unknown): NetAltaraMusicTrack {
  const row = record(value, 'track')
  return {
    id: uuid(row.id, 'track id'),
    title: text(row.title, 'track title', 180),
    artistId: uuid(row.artist_id, 'track artist id'),
    artistName: text(row.artist_name, 'track artist name', 120),
    ...(row.release_id ? { releaseId: uuid(row.release_id, 'track release id') } : {}),
    ...(optionalText(row.release_title, 'track release title', 160) ? { releaseTitle: String(row.release_title) } : {}),
    ...(row.track_number == null ? {} : { trackNumber: integer(row.track_number, 'track number', 1, 999) }),
    discNumber: integer(row.disc_number, 'disc number', 1, 99),
    durationMs: integer(row.duration_ms, 'track duration', 2_000, NET_ALTARA_MUSIC_MAX_DURATION_MS),
    audioObjectPath: text(row.audio_object_path, 'track audio path', 240),
    ...(optionalText(row.artwork_ref, 'track artwork') ? { artworkRef: String(row.artwork_ref) } : {}),
    explicit: bool(row.explicit, 'track explicit state'),
    featured: bool(row.featured, 'track featured state'),
    liked: bool(row.liked, 'track liked state'),
  }
}

function parsePlaylist(value: unknown): NetAltaraMusicPlaylist {
  const row = record(value, 'playlist')
  return {
    id: uuid(row.id, 'playlist id'),
    playlistKind: choice(row.playlist_kind, ['personal', 'curated'] as const, 'playlist kind'),
    title: text(row.title, 'playlist title', 120),
    ...(optionalText(row.description, 'playlist description', 1000) ? { description: String(row.description) } : {}),
    ...(optionalText(row.cover_ref, 'playlist cover') ? { coverRef: String(row.cover_ref) } : {}),
    featured: bool(row.featured, 'playlist featured state'),
    trackCount: integer(row.track_count, 'playlist track count', 0, 500),
  }
}

function parseCollection(value: unknown): NetAltaraMusicCollection {
  const row = record(value, 'ALTARA MUSIC collection')
  return {
    identityLinkId: uuid(row.identity_link_id, 'music identity'),
    artists: list(row.artists, parseArtist, 40, 'artists'),
    releases: list(row.releases, parseRelease, 40, 'releases'),
    tracks: list(row.tracks, parseTrack, 40, 'tracks'),
    playlists: list(row.playlists, parsePlaylist, 40, 'playlists'),
    recentlyPlayed: list(row.recently_played, parseTrack, 20, 'recent tracks'),
  }
}

function prewarmCollectionMedia(collection: Pick<NetAltaraMusicCollection, 'artists' | 'releases' | 'tracks' | 'playlists'>): void {
  prewarmSharedMediaUrls([
    ...collection.artists.flatMap((artist) => [artist.avatarRef, artist.bannerRef]),
    ...collection.releases.map((release) => release.coverRef),
    ...collection.tracks.map((track) => track.artworkRef),
    ...collection.playlists.map((playlist) => playlist.coverRef),
  ], 'thumbnail')
}

async function rpc(name: string, args?: JsonRecord): Promise<unknown> {
  const { data, error } = await client().rpc(name, args)
  if (error) throw new Error(error.message)
  return Array.isArray(data) && data.length === 1 ? data[0] : data
}

export async function fetchNetAltaraMusicHome(identityLinkId: string): Promise<NetAltaraMusicCollection> {
  const payload = parseCollection(await rpc('fetch_net_altara_music_home', {
    requested_expected_identity_link_id: identityLinkId,
    requested_limit: 20,
  }))
  if (payload.identityLinkId !== identityLinkId) throw new Error('ALTARA MUSIC identity changed during loading.')
  prewarmCollectionMedia(payload)
  return payload
}

export async function searchNetAltaraMusic(identityLinkId: string, query: string): Promise<NetAltaraMusicCollection> {
  const row = record(await rpc('search_net_altara_music', {
    requested_expected_identity_link_id: identityLinkId,
    requested_query: query,
    requested_limit: 20,
  }), 'ALTARA MUSIC search')
  const payload: NetAltaraMusicCollection = {
    identityLinkId: uuid(row.identity_link_id, 'music search identity'),
    artists: list(row.artists, parseArtist, 40, 'search artists'),
    releases: list(row.releases, parseRelease, 40, 'search releases'),
    tracks: list(row.tracks, parseTrack, 40, 'search tracks'),
    playlists: list(row.playlists, parsePlaylist, 40, 'search playlists'),
    recentlyPlayed: [],
  }
  prewarmCollectionMedia(payload)
  return payload
}

export async function fetchNetAltaraMusicLibrary(identityLinkId: string): Promise<NetAltaraMusicLibrary> {
  const row = record(await rpc('fetch_net_altara_music_library', {
    requested_expected_identity_link_id: identityLinkId,
  }), 'ALTARA MUSIC library')
  const returnedIdentity = uuid(row.identity_link_id, 'music library identity')
  if (returnedIdentity !== identityLinkId) throw new Error('ALTARA MUSIC library identity changed.')
  const payload: NetAltaraMusicLibrary = {
    identityLinkId: returnedIdentity,
    likedTracks: list(row.liked_tracks, parseTrack, 200, 'liked tracks'),
    playlists: list(row.playlists, parsePlaylist, 100, 'personal playlists'),
    recentlyPlayed: list(row.recently_played, parseTrack, 50, 'recent tracks'),
  }
  prewarmSharedMediaUrls([
    ...payload.likedTracks.map((track) => track.artworkRef),
    ...payload.playlists.map((playlist) => playlist.coverRef),
    ...payload.recentlyPlayed.map((track) => track.artworkRef),
  ], 'thumbnail')
  return payload
}

export async function fetchNetAltaraMusicArtist(identityLinkId: string, artistId: string): Promise<NetAltaraMusicArtistDetail> {
  const row = record(await rpc('fetch_net_altara_music_artist', {
    requested_expected_identity_link_id: identityLinkId,
    requested_artist_id: artistId,
  }), 'artist detail')
  const payload: NetAltaraMusicArtistDetail = {
    artist: parseArtist(row.artist),
    releases: list(row.releases, parseRelease, 40, 'artist releases'),
    tracks: list(row.tracks, parseTrack, 80, 'artist tracks'),
  }
  prewarmSharedMediaUrls([
    payload.artist.avatarRef,
    payload.artist.bannerRef,
    ...payload.releases.map((release) => release.coverRef),
    ...payload.tracks.map((track) => track.artworkRef),
  ], 'thumbnail')
  return payload
}

export async function fetchNetAltaraMusicRelease(identityLinkId: string, releaseId: string): Promise<NetAltaraMusicReleaseDetail> {
  const row = record(await rpc('fetch_net_altara_music_release', {
    requested_expected_identity_link_id: identityLinkId,
    requested_release_id: releaseId,
  }), 'release detail')
  const payload: NetAltaraMusicReleaseDetail = {
    release: parseRelease(row.release),
    tracks: list(row.tracks, parseTrack, 100, 'release tracks'),
  }
  prewarmSharedMediaUrls([payload.release.coverRef, ...payload.tracks.map((track) => track.artworkRef)], 'thumbnail')
  return payload
}

export async function fetchNetAltaraMusicPlaylist(identityLinkId: string, playlistId: string): Promise<NetAltaraMusicPlaylistDetail> {
  const row = record(await rpc('fetch_net_altara_music_playlist', {
    requested_expected_identity_link_id: identityLinkId,
    requested_playlist_id: playlistId,
  }), 'playlist detail')
  const payload: NetAltaraMusicPlaylistDetail = {
    playlist: parsePlaylist(row.playlist),
    tracks: list(row.tracks, parseTrack, 500, 'playlist tracks'),
  }
  prewarmSharedMediaUrls([payload.playlist.coverRef, ...payload.tracks.map((track) => track.artworkRef)], 'thumbnail')
  return payload
}

export async function setNetAltaraMusicTrackLiked(identityLinkId: string, trackId: string, liked: boolean): Promise<void> {
  await rpc('set_net_altara_music_track_liked', {
    requested_expected_identity_link_id: identityLinkId,
    requested_track_id: trackId,
    requested_liked: liked,
  })
}

export async function recordNetAltaraMusicRecentPlay(identityLinkId: string, trackId: string): Promise<void> {
  await rpc('record_net_altara_music_recent_play', {
    requested_expected_identity_link_id: identityLinkId,
    requested_track_id: trackId,
  })
}

export async function saveNetAltaraMusicPersonalPlaylist(
  identityLinkId: string,
  input: { readonly id?: string; readonly title: string; readonly description?: string },
): Promise<string> {
  return uuid(await rpc('save_net_altara_music_personal_playlist', {
    requested_expected_identity_link_id: identityLinkId,
    requested_playlist_id: input.id ?? null,
    requested_title: input.title,
    requested_description: input.description ?? null,
  }), 'saved playlist id')
}

export async function deleteNetAltaraMusicPersonalPlaylist(identityLinkId: string, playlistId: string): Promise<void> {
  await rpc('delete_net_altara_music_personal_playlist', {
    requested_expected_identity_link_id: identityLinkId,
    requested_playlist_id: playlistId,
  })
}

export async function setNetAltaraMusicPersonalPlaylistTrack(
  identityLinkId: string,
  playlistId: string,
  trackId: string,
  included: boolean,
): Promise<void> {
  await rpc('set_net_altara_music_personal_playlist_track', {
    requested_expected_identity_link_id: identityLinkId,
    requested_playlist_id: playlistId,
    requested_track_id: trackId,
    requested_included: included,
  })
}

function parseStudioArtist(value: unknown): NetAltaraMusicGmArtist {
  const row = record(value, 'Studio artist')
  return {
    ...parseArtist(row),
    status: choice(row.status, netAltaraMusicStatuses, 'artist status') as NetAltaraMusicStatus,
    createdAt: text(row.created_at, 'artist creation time', 64),
    updatedAt: text(row.updated_at, 'artist update time', 64),
  }
}

function parseStudioRelease(value: unknown): NetAltaraMusicGmRelease {
  const row = record(value, 'Studio release')
  return {
    id: uuid(row.id, 'release id'),
    artistId: uuid(row.artist_id, 'release artist id'),
    title: text(row.title, 'release title', 160),
    slug: text(row.slug, 'release slug', 140),
    releaseType: choice(row.release_type, netAltaraMusicReleaseTypes, 'release type') as NetAltaraMusicReleaseType,
    ...(optionalText(row.cover_ref, 'release cover') ? { coverRef: String(row.cover_ref) } : {}),
    ...(optionalText(row.release_date, 'release date', 32) ? { releaseDate: String(row.release_date) } : {}),
    ...(optionalText(row.description, 'release description', 4000) ? { description: String(row.description) } : {}),
    featured: bool(row.featured, 'release featured state'),
    status: choice(row.status, netAltaraMusicStatuses, 'release status') as NetAltaraMusicStatus,
    createdAt: text(row.created_at, 'release creation time', 64),
    updatedAt: text(row.updated_at, 'release update time', 64),
  }
}

function parseStudioTrack(value: unknown): NetAltaraMusicGmTrack {
  const row = record(value, 'Studio track')
  return {
    id: uuid(row.id, 'track id'),
    primaryArtistId: uuid(row.primary_artist_id, 'track artist id'),
    ...(row.release_id ? { releaseId: uuid(row.release_id, 'track release id') } : {}),
    title: text(row.title, 'track title', 180),
    ...(row.track_number == null ? {} : { trackNumber: integer(row.track_number, 'track number', 1, 999) }),
    discNumber: integer(row.disc_number, 'disc number', 1, 99),
    audioObjectPath: text(row.audio_object_path, 'audio path', 240),
    audioMimeType: text(row.audio_mime_type, 'audio MIME', 64),
    audioByteSize: integer(row.audio_byte_size, 'audio size', 1, NET_ALTARA_MUSIC_MAX_FILE_BYTES),
    durationMs: integer(row.duration_ms, 'audio duration', 2_000, NET_ALTARA_MUSIC_MAX_DURATION_MS),
    ...(optionalText(row.artwork_ref, 'track artwork') ? { artworkRef: String(row.artwork_ref) } : {}),
    explicit: bool(row.explicit, 'track explicit state'),
    status: choice(row.status, netAltaraMusicStatuses, 'track status') as NetAltaraMusicStatus,
    featured: bool(row.featured, 'track featured state'),
    ...(optionalText(row.pending_delete_at, 'deletion time', 64) ? { pendingDeleteAt: String(row.pending_delete_at) } : {}),
    createdAt: text(row.created_at, 'track creation time', 64),
    updatedAt: text(row.updated_at, 'track update time', 64),
  }
}

function parseStudioPlaylist(value: unknown): NetAltaraMusicGmPlaylist {
  const row = record(value, 'Studio playlist')
  return {
    id: uuid(row.id, 'playlist id'),
    title: text(row.title, 'playlist title', 120),
    ...(optionalText(row.description, 'playlist description', 1000) ? { description: String(row.description) } : {}),
    ...(optionalText(row.cover_ref, 'playlist cover') ? { coverRef: String(row.cover_ref) } : {}),
    status: choice(row.status, netAltaraMusicStatuses, 'playlist status') as NetAltaraMusicStatus,
    featured: bool(row.featured, 'playlist featured state'),
    trackIds: list(row.track_ids, (entry) => uuid(entry, 'playlist track id'), 500, 'playlist track ids'),
    createdAt: text(row.created_at, 'playlist creation time', 64),
    updatedAt: text(row.updated_at, 'playlist update time', 64),
  }
}

function parseStudio(value: unknown): NetAltaraMusicStudioPayload {
  const row = record(value, 'Music Studio')
  return {
    artists: list(row.artists, parseStudioArtist, 500, 'Studio artists'),
    releases: list(row.releases, parseStudioRelease, 500, 'Studio releases'),
    tracks: list(row.tracks, parseStudioTrack, 1000, 'Studio tracks'),
    playlists: list(row.playlists, parseStudioPlaylist, 200, 'Studio playlists'),
    audioBytes: integer(row.audio_bytes, 'audio library size'),
    audioBudgetBytes: integer(row.audio_budget_bytes, 'audio library budget'),
  }
}

export async function fetchNetAltaraMusicStudio(): Promise<NetAltaraMusicStudioPayload> {
  const payload = parseStudio(await rpc('fetch_net_altara_music_gm_studio'))
  prewarmSharedMediaUrls([
    ...payload.artists.flatMap((artist) => [artist.avatarRef, artist.bannerRef]),
    ...payload.releases.map((release) => release.coverRef),
    ...payload.tracks.map((track) => track.artworkRef),
    ...payload.playlists.map((playlist) => playlist.coverRef),
  ], 'thumbnail')
  return payload
}

export async function saveNetAltaraMusicGmArtist(input: {
  readonly id?: string; readonly name: string; readonly slug: string; readonly bio?: string
  readonly avatarRef?: string; readonly bannerRef?: string; readonly status: NetAltaraMusicStatus; readonly featured: boolean
}): Promise<NetAltaraMusicStudioPayload> {
  return parseStudio(await rpc('save_net_altara_music_gm_artist', {
    requested_artist_id: input.id ?? null, requested_name: input.name, requested_slug: input.slug,
    requested_bio: input.bio ?? null, requested_avatar_ref: input.avatarRef ?? null,
    requested_banner_ref: input.bannerRef ?? null, requested_status: input.status,
    requested_featured: input.featured,
  }))
}

export async function saveNetAltaraMusicGmRelease(input: {
  readonly id?: string; readonly artistId: string; readonly title: string; readonly slug: string
  readonly releaseType: NetAltaraMusicReleaseType; readonly coverRef?: string; readonly releaseDate?: string
  readonly description?: string; readonly status: NetAltaraMusicStatus; readonly featured: boolean
}): Promise<NetAltaraMusicStudioPayload> {
  return parseStudio(await rpc('save_net_altara_music_gm_release', {
    requested_release_id: input.id ?? null, requested_artist_id: input.artistId,
    requested_title: input.title, requested_slug: input.slug, requested_release_type: input.releaseType,
    requested_cover_ref: input.coverRef ?? null, requested_release_date: input.releaseDate || null,
    requested_description: input.description ?? null, requested_status: input.status,
    requested_featured: input.featured,
  }))
}

export async function createNetAltaraMusicGmTrack(
  input: {
    readonly id?: string
    readonly artistId: string; readonly releaseId?: string; readonly title: string
    readonly trackNumber?: number; readonly discNumber: number; readonly artworkRef?: string
    readonly explicit: boolean; readonly status: NetAltaraMusicStatus; readonly featured: boolean
  },
  file: File,
): Promise<NetAltaraMusicStudioPayload> {
  const id = input.id ?? crypto.randomUUID()
  const metadata = await inspectRpgAudioFile(file)
  const objectPath = await buildRpgAudioObjectPath(id, metadata, 'altara-music')
  await uploadRpgAudioObject(objectPath, metadata)
  let response: unknown
  try {
    response = await rpc('create_net_altara_music_gm_track', {
      requested_track_id: id, requested_artist_id: input.artistId, requested_release_id: input.releaseId ?? null,
      requested_title: input.title, requested_track_number: input.trackNumber ?? null,
      requested_disc_number: input.discNumber, requested_object_path: objectPath,
      requested_mime_type: metadata.mimeType, requested_byte_size: metadata.byteSize,
      requested_duration_ms: metadata.durationMs, requested_artwork_ref: input.artworkRef ?? null,
      requested_explicit: input.explicit, requested_status: input.status, requested_featured: input.featured,
    })
  } catch (error) {
    try {
      await removeRpgAudioObject(objectPath)
    } catch (cleanupError) {
      const mutationMessage = error instanceof Error ? error.message : 'unknown registration error'
      const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : 'unknown cleanup error'
      throw new Error(
        `Track registration failed and automatic orphan cleanup could not be confirmed. Refresh MUSIC STUDIO before retrying. Registration: ${mutationMessage}. Cleanup: ${cleanupMessage}`,
      )
    }
    throw error
  }
  // Once the RPC returned successfully the object is canonical. A malformed
  // response must surface, but must never make the client delete valid audio.
  return parseStudio(response)
}

export async function updateNetAltaraMusicGmTrack(input: {
  readonly id: string; readonly artistId: string; readonly releaseId?: string; readonly title: string
  readonly trackNumber?: number; readonly discNumber: number; readonly artworkRef?: string
  readonly explicit: boolean; readonly status: NetAltaraMusicStatus; readonly featured: boolean
}): Promise<NetAltaraMusicStudioPayload> {
  return parseStudio(await rpc('update_net_altara_music_gm_track', {
    requested_track_id: input.id, requested_artist_id: input.artistId, requested_release_id: input.releaseId ?? null,
    requested_title: input.title, requested_track_number: input.trackNumber ?? null,
    requested_disc_number: input.discNumber, requested_artwork_ref: input.artworkRef ?? null,
    requested_explicit: input.explicit, requested_status: input.status, requested_featured: input.featured,
  }))
}

export async function replaceNetAltaraMusicGmTrackAudio(trackId: string, file: File): Promise<NetAltaraMusicStudioPayload> {
  const metadata = await inspectRpgAudioFile(file)
  const objectPath = await buildRpgAudioObjectPath(trackId, metadata, 'altara-music')
  await uploadRpgAudioObject(objectPath, metadata)
  let response: unknown
  try {
    response = await rpc('replace_net_altara_music_gm_track_audio', {
      requested_track_id: trackId, requested_object_path: objectPath,
      requested_mime_type: metadata.mimeType, requested_byte_size: metadata.byteSize,
      requested_duration_ms: metadata.durationMs,
    })
  } catch (error) {
    try {
      await removeRpgAudioObject(objectPath)
    } catch (cleanupError) {
      const mutationMessage = error instanceof Error ? error.message : 'unknown replacement error'
      const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : 'unknown cleanup error'
      throw new Error(
        `Track audio replacement failed and automatic orphan cleanup could not be confirmed. Refresh MUSIC STUDIO before retrying. Replacement: ${mutationMessage}. Cleanup: ${cleanupMessage}`,
      )
    }
    throw error
  }
  const row = record(response, 'audio replacement')
  const previousPath = text(row.previous_object_path, 'previous audio path', 240)
  const studio = parseStudio(row.studio)
  if (previousPath !== objectPath) {
    try {
      await removeRpgAudioObject(previousPath)
    } catch (cleanupError) {
      const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : 'unknown cleanup error'
      throw new Error(
        `Track audio replacement succeeded, but the previous private object could not be removed. The new audio is canonical; refresh MUSIC STUDIO and review Storage cleanup. ${cleanupMessage}`,
      )
    }
  }
  return studio
}

export async function deleteNetAltaraMusicGmTrack(trackId: string): Promise<NetAltaraMusicStudioPayload> {
  const prepared = record(await rpc('prepare_net_altara_music_gm_track_delete', {
    requested_track_id: trackId,
  }), 'track deletion preparation')
  const objectPath = text(prepared.object_path, 'track deletion path', 240)
  await removeRpgAudioObject(objectPath, 'permanent-delete')
  return parseStudio(await rpc('finalize_net_altara_music_gm_track_delete', {
    requested_track_id: trackId,
  }))
}

export async function saveNetAltaraMusicGmPlaylist(input: {
  readonly id?: string; readonly title: string; readonly description?: string; readonly coverRef?: string
  readonly status: NetAltaraMusicStatus; readonly featured: boolean
}): Promise<NetAltaraMusicStudioPayload> {
  return parseStudio(await rpc('save_net_altara_music_gm_curated_playlist', {
    requested_playlist_id: input.id ?? null, requested_title: input.title,
    requested_description: input.description ?? null, requested_cover_ref: input.coverRef ?? null,
    requested_status: input.status, requested_featured: input.featured,
  }))
}

export async function setNetAltaraMusicGmPlaylistTrack(
  playlistId: string,
  trackId: string,
  included: boolean,
): Promise<NetAltaraMusicStudioPayload> {
  return parseStudio(await rpc('set_net_altara_music_gm_curated_playlist_track', {
    requested_playlist_id: playlistId, requested_track_id: trackId, requested_included: included,
  }))
}

export async function inspectNetAltaraMusicAudioFile(file: File): Promise<NetNvnRadioAudioMetadata> {
  return inspectRpgAudioFile(file)
}

export function signNetAltaraMusicTrack(track: NetAltaraMusicTrack): Promise<string> {
  return signRpgAudioObject(track.audioObjectPath, 16 * 60, 'ALTARA MUSIC')
}
