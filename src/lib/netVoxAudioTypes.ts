export const VOX_AUDIO_PRODUCT_NAME = 'VOX AUDIO'
export const NET_VOX_AUDIO_AUDIO_BYTE_BUDGET = 400 * 1024 * 1024
export const NET_VOX_AUDIO_MAX_FILE_BYTES = 15 * 1024 * 1024
export const NET_VOX_AUDIO_MAX_DURATION_MS = 15 * 60 * 1000

export const netVoxAudioReleaseTypes = ['album', 'ep', 'single'] as const
export const netVoxAudioStatuses = ['draft', 'published', 'archived'] as const

export type NetVoxAudioReleaseType = typeof netVoxAudioReleaseTypes[number]
export type NetVoxAudioStatus = typeof netVoxAudioStatuses[number]

export interface NetVoxAudioArtist {
  readonly id: string
  readonly name: string
  readonly slug: string
  readonly avatarRef?: string
  readonly bannerRef?: string
  readonly bio?: string
  readonly featured: boolean
}

export interface NetVoxAudioRelease {
  readonly id: string
  readonly artistId: string
  readonly artistName: string
  readonly title: string
  readonly slug: string
  readonly releaseType: NetVoxAudioReleaseType
  readonly coverRef?: string
  readonly releaseDate?: string
  readonly description?: string
  readonly featured: boolean
}

export interface NetVoxAudioTrack {
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

export interface NetVoxAudioPlaylist {
  readonly id: string
  readonly playlistKind: 'personal' | 'curated'
  readonly title: string
  readonly description?: string
  readonly coverRef?: string
  readonly featured: boolean
  readonly trackCount: number
}

export interface NetVoxAudioCollection {
  readonly identityLinkId: string
  readonly artists: readonly NetVoxAudioArtist[]
  readonly releases: readonly NetVoxAudioRelease[]
  readonly tracks: readonly NetVoxAudioTrack[]
  readonly playlists: readonly NetVoxAudioPlaylist[]
  readonly recentlyPlayed: readonly NetVoxAudioTrack[]
}

export interface NetVoxAudioLibrary {
  readonly identityLinkId: string
  readonly likedTracks: readonly NetVoxAudioTrack[]
  readonly playlists: readonly NetVoxAudioPlaylist[]
  readonly recentlyPlayed: readonly NetVoxAudioTrack[]
}

export interface NetVoxAudioArtistDetail {
  readonly artist: NetVoxAudioArtist
  readonly releases: readonly NetVoxAudioRelease[]
  readonly tracks: readonly NetVoxAudioTrack[]
}

export interface NetVoxAudioReleaseDetail {
  readonly release: NetVoxAudioRelease
  readonly tracks: readonly NetVoxAudioTrack[]
}

export interface NetVoxAudioPlaylistDetail {
  readonly playlist: NetVoxAudioPlaylist
  readonly tracks: readonly NetVoxAudioTrack[]
}

export interface NetVoxAudioGmArtist extends NetVoxAudioArtist {
  readonly status: NetVoxAudioStatus
  readonly createdAt: string
  readonly updatedAt: string
}

export interface NetVoxAudioGmRelease extends Omit<NetVoxAudioRelease, 'artistName'> {
  readonly status: NetVoxAudioStatus
  readonly createdAt: string
  readonly updatedAt: string
}

export interface NetVoxAudioGmTrack {
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
  readonly status: NetVoxAudioStatus
  readonly featured: boolean
  readonly pendingDeleteAt?: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface NetVoxAudioGmPlaylist {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly coverRef?: string
  readonly status: NetVoxAudioStatus
  readonly featured: boolean
  readonly trackIds: readonly string[]
  readonly createdAt: string
  readonly updatedAt: string
}

export interface NetVoxAudioStudioPayload {
  readonly artists: readonly NetVoxAudioGmArtist[]
  readonly releases: readonly NetVoxAudioGmRelease[]
  readonly tracks: readonly NetVoxAudioGmTrack[]
  readonly playlists: readonly NetVoxAudioGmPlaylist[]
  readonly audioBytes: number
  readonly audioBudgetBytes: number
}

export function formatVoxAudioDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.floor(durationMs / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
