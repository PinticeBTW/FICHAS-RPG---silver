export const ALTARA_MUSIC_PRODUCT_NAME = 'ALTARA MUSIC'
export const NET_ALTARA_MUSIC_AUDIO_BYTE_BUDGET = 400 * 1024 * 1024
export const NET_ALTARA_MUSIC_MAX_FILE_BYTES = 15 * 1024 * 1024
export const NET_ALTARA_MUSIC_MAX_DURATION_MS = 15 * 60 * 1000

export const netAltaraMusicReleaseTypes = ['album', 'ep', 'single'] as const
export const netAltaraMusicStatuses = ['draft', 'published', 'archived'] as const

export type NetAltaraMusicReleaseType = typeof netAltaraMusicReleaseTypes[number]
export type NetAltaraMusicStatus = typeof netAltaraMusicStatuses[number]

export interface NetAltaraMusicArtist {
  readonly id: string
  readonly name: string
  readonly slug: string
  readonly avatarRef?: string
  readonly bannerRef?: string
  readonly bio?: string
  readonly featured: boolean
}

export interface NetAltaraMusicRelease {
  readonly id: string
  readonly artistId: string
  readonly artistName: string
  readonly title: string
  readonly slug: string
  readonly releaseType: NetAltaraMusicReleaseType
  readonly coverRef?: string
  readonly releaseDate?: string
  readonly description?: string
  readonly featured: boolean
}

export interface NetAltaraMusicTrack {
  readonly id: string
  readonly title: string
  readonly artistId: string
  readonly artistName: string
  readonly releaseId?: string
  readonly releaseTitle?: string
  readonly trackNumber?: number
  readonly discNumber: number
  readonly durationMs: number
  readonly audioObjectPath: string
  readonly artworkRef?: string
  readonly explicit: boolean
  readonly featured: boolean
  readonly liked: boolean
}

export interface NetAltaraMusicPlaylist {
  readonly id: string
  readonly playlistKind: 'personal' | 'curated'
  readonly title: string
  readonly description?: string
  readonly coverRef?: string
  readonly featured: boolean
  readonly trackCount: number
}

export interface NetAltaraMusicCollection {
  readonly identityLinkId: string
  readonly artists: readonly NetAltaraMusicArtist[]
  readonly releases: readonly NetAltaraMusicRelease[]
  readonly tracks: readonly NetAltaraMusicTrack[]
  readonly playlists: readonly NetAltaraMusicPlaylist[]
  readonly recentlyPlayed: readonly NetAltaraMusicTrack[]
}

export interface NetAltaraMusicLibrary {
  readonly identityLinkId: string
  readonly likedTracks: readonly NetAltaraMusicTrack[]
  readonly playlists: readonly NetAltaraMusicPlaylist[]
  readonly recentlyPlayed: readonly NetAltaraMusicTrack[]
}

export interface NetAltaraMusicArtistDetail {
  readonly artist: NetAltaraMusicArtist
  readonly releases: readonly NetAltaraMusicRelease[]
  readonly tracks: readonly NetAltaraMusicTrack[]
}

export interface NetAltaraMusicReleaseDetail {
  readonly release: NetAltaraMusicRelease
  readonly tracks: readonly NetAltaraMusicTrack[]
}

export interface NetAltaraMusicPlaylistDetail {
  readonly playlist: NetAltaraMusicPlaylist
  readonly tracks: readonly NetAltaraMusicTrack[]
}

export interface NetAltaraMusicGmArtist extends NetAltaraMusicArtist {
  readonly status: NetAltaraMusicStatus
  readonly createdAt: string
  readonly updatedAt: string
}

export interface NetAltaraMusicGmRelease extends Omit<NetAltaraMusicRelease, 'artistName'> {
  readonly status: NetAltaraMusicStatus
  readonly createdAt: string
  readonly updatedAt: string
}

export interface NetAltaraMusicGmTrack {
  readonly id: string
  readonly primaryArtistId: string
  readonly releaseId?: string
  readonly title: string
  readonly trackNumber?: number
  readonly discNumber: number
  readonly audioObjectPath: string
  readonly audioMimeType: string
  readonly audioByteSize: number
  readonly durationMs: number
  readonly artworkRef?: string
  readonly explicit: boolean
  readonly status: NetAltaraMusicStatus
  readonly featured: boolean
  readonly pendingDeleteAt?: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface NetAltaraMusicGmPlaylist {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly coverRef?: string
  readonly status: NetAltaraMusicStatus
  readonly featured: boolean
  readonly trackIds: readonly string[]
  readonly createdAt: string
  readonly updatedAt: string
}

export interface NetAltaraMusicStudioPayload {
  readonly artists: readonly NetAltaraMusicGmArtist[]
  readonly releases: readonly NetAltaraMusicGmRelease[]
  readonly tracks: readonly NetAltaraMusicGmTrack[]
  readonly playlists: readonly NetAltaraMusicGmPlaylist[]
  readonly audioBytes: number
  readonly audioBudgetBytes: number
}

export function formatAltaraMusicDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.floor(durationMs / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
