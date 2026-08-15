export const NET_ALTARA_NEWS_BROADCAST_MAX_ACTIVE_CLIPS = 100
export const NET_ALTARA_NEWS_BROADCAST_MAX_FILE_BYTES = 15 * 1024 * 1024
export const NET_ALTARA_NEWS_BROADCAST_MIN_DURATION_MS = 2_000
export const NET_ALTARA_NEWS_BROADCAST_MAX_DURATION_MS = 15 * 60 * 1_000
export const NET_ALTARA_NEWS_BROADCAST_LIBRARY_BYTE_BUDGET = 400 * 1024 * 1024
export const NET_ALTARA_NEWS_BROADCAST_SIGNED_URL_GRACE_SECONDS = 60
export const NET_ALTARA_NEWS_BROADCAST_SIGNED_URL_MIN_TTL_SECONDS = 90
export const NET_ALTARA_NEWS_BROADCAST_SIGNED_URL_MAX_TTL_SECONDS = 16 * 60

export const netAltaraNewsBroadcastClipKinds = [
  'news', 'bulletin', 'station-id', 'jingle', 'advertisement', 'weather',
  'traffic', 'interview', 'public-service', 'ambience', 'other',
] as const
export const netAltaraNewsBroadcastModes = ['rotation', 'play-now', 'breaking'] as const

export type NetAltaraNewsBroadcastClipKind = typeof netAltaraNewsBroadcastClipKinds[number]
export type NetAltaraNewsBroadcastMode = typeof netAltaraNewsBroadcastModes[number]

export interface NetAltaraNewsBroadcastCurrentClip {
  readonly clipId: string
  readonly publicLabel?: string
  readonly clipKind: NetAltaraNewsBroadcastClipKind
  readonly durationMs: number
  readonly startedAt: string
  readonly endsAt: string
  readonly objectPath: string
}

export interface NetAltaraNewsBroadcastTuneState {
  readonly serverNow: string
  readonly stationStatus: 'off-air' | 'on-air'
  readonly mode: NetAltaraNewsBroadcastMode
  readonly broadcastRevision: number
  readonly identityLinkId: string
  readonly current: NetAltaraNewsBroadcastCurrentClip | null
}

export interface NetAltaraNewsBroadcastTuneSample {
  readonly state: NetAltaraNewsBroadcastTuneState
  readonly requestStartedAt: number
  readonly responseReceivedAt: number
}

export interface NetAltaraNewsGmBroadcastClip {
  readonly id: string
  readonly internalLabel: string
  readonly publicLabel?: string
  readonly clipKind: NetAltaraNewsBroadcastClipKind
  readonly status: 'active' | 'archived'
  readonly rotationEnabled: boolean
  readonly rotationWeight: number
  readonly objectPath: string
  readonly mimeType: string
  readonly byteSize: number
  readonly durationMs: number
  readonly pendingDeleteAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface NetAltaraNewsGmBroadcastStation {
  readonly stationEnabled: boolean
  readonly rotationEpochAt: string
  readonly rotationSeed: string
  readonly breakingStingerClipId: string | null
  readonly overrideMode: Exclude<NetAltaraNewsBroadcastMode, 'rotation'> | null
  readonly overrideClipId: string | null
  readonly overrideStartedAt: string | null
  readonly overrideEndsAt: string | null
  readonly updatedAt: string
}

export interface NetAltaraNewsGmBroadcastPayload {
  readonly serverNow: string
  readonly broadcastRevision: number
  readonly station: NetAltaraNewsGmBroadcastStation
  readonly effective: Omit<NetAltaraNewsBroadcastTuneState, 'identityLinkId'>
  readonly clips: readonly NetAltaraNewsGmBroadcastClip[]
  readonly libraryByteSize: number
  readonly libraryByteBudget: number
}

export interface NetAltaraNewsGmBroadcastClipInput {
  readonly internalLabel: string
  readonly publicLabel?: string
  readonly clipKind: NetAltaraNewsBroadcastClipKind
  readonly rotationEnabled: boolean
  readonly rotationWeight: number
}

export type NetAltaraNewsBroadcastErrorCode =
  | 'permission-denied' | 'invalid-input' | 'invalid-response'
  | 'station-disabled' | 'override-active' | 'clip-not-found' | 'clip-limit'
  | 'storage-budget' | 'stinger-configured' | 'delete-requires-archived'
  | 'delete-pending' | 'delete-object-present' | 'storage-failed'
  | 'signing-failed' | 'autoplay-blocked' | 'request-failed'

export class NetAltaraNewsBroadcastError extends Error {
  readonly code: NetAltaraNewsBroadcastErrorCode

  constructor(code: NetAltaraNewsBroadcastErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'NetAltaraNewsBroadcastError'
    this.code = code
  }
}
