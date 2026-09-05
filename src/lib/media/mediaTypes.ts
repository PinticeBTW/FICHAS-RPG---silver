export type MediaOptimizationProfile = 'avatar' | 'wallpaper' | 'general' | 'small-ui'

export type SharedMediaSubjectKind =
  | 'lorelink-entity'
  | 'profile-sheet'
  | 'npc-card'
  | 'profile'
  | 'character'
  | 'identity-link'
  | 'universal-profile'
  | 'app-account'
  | 'gm-profile'
  | 'nvn-article'
  | 'altara-news-article'
  | 'altara-music-artwork'
  | 'altara-wave-account'
  | 'vox-audio-artwork'
  | 'global'

export interface SharedMediaScope {
  readonly subjectKind: SharedMediaSubjectKind
  readonly subjectId: string
  readonly mediaKind: 'avatar' | 'wallpaper' | 'general' | 'small-ui' | 'notebook' | 'relation' | 'cyberware'
  readonly slot?: string
}

export interface SharedMediaVariant {
  readonly path: string
  readonly mimeType: string
  readonly width: number
  readonly height: number
  readonly byteSize: number
}

export interface SharedMediaReferenceV1 {
  readonly version: 1
  readonly hash: string
  readonly display: SharedMediaVariant
  readonly thumbnail?: SharedMediaVariant
}

export interface OptimizedMediaVariant {
  readonly name: 'display' | 'thumbnail'
  readonly blob: Blob
  readonly mimeType: string
  readonly width: number
  readonly height: number
  readonly extension: string
}

export interface OptimizedMediaResult {
  readonly profile: MediaOptimizationProfile
  readonly contentHash: string
  readonly originalByteSize: number
  readonly variants: readonly OptimizedMediaVariant[]
  readonly preservedOriginal: boolean
}

export const SHARED_MEDIA_BUCKET = 'rpg-media'
export const SHARED_MEDIA_REFERENCE_PREFIX = 'rpg-media:v1:'
export const SHARED_MEDIA_IMMUTABLE_CACHE_CONTROL = '31536000'
