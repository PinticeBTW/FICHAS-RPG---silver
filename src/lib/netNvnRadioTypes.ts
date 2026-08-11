export const NET_NVN_RADIO_MAX_ACTIVE_CLIPS = 100
export const NET_NVN_RADIO_MAX_FILE_BYTES = 15 * 1024 * 1024
export const NET_NVN_RADIO_MIN_DURATION_MS = 2_000
export const NET_NVN_RADIO_MAX_DURATION_MS = 15 * 60 * 1_000
export const NET_NVN_RADIO_LIBRARY_BYTE_BUDGET = 400 * 1024 * 1024
export const NET_NVN_RADIO_SIGNED_URL_GRACE_SECONDS = 60
export const NET_NVN_RADIO_SIGNED_URL_MIN_TTL_SECONDS = 90
export const NET_NVN_RADIO_SIGNED_URL_MAX_TTL_SECONDS = 16 * 60

export const netNvnRadioClipKinds = [
  'news',
  'bulletin',
  'station-id',
  'jingle',
  'advertisement',
  'weather',
  'traffic',
  'interview',
  'public-service',
  'ambience',
  'other',
] as const

export const netNvnRadioModes = ['rotation', 'play-now', 'breaking'] as const

export type NetNvnRadioClipKind = typeof netNvnRadioClipKinds[number]
export type NetNvnRadioMode = typeof netNvnRadioModes[number]
export type NetNvnRadioClipStatus = 'active' | 'archived'

export interface NetNvnRadioCurrentClip {
  readonly clipId: string
  readonly publicLabel?: string
  readonly clipKind: NetNvnRadioClipKind
  readonly durationMs: number
  readonly startedAt: string
  readonly endsAt: string
  readonly objectPath: string
}

export interface NetNvnRadioTuneState {
  readonly serverNow: string
  readonly stationStatus: 'off-air' | 'on-air'
  readonly mode: NetNvnRadioMode
  readonly radioRevision: number
  readonly current: NetNvnRadioCurrentClip | null
}

export interface NetNvnGmRadioClip {
  readonly id: string
  readonly internalLabel: string
  readonly publicLabel?: string
  readonly clipKind: NetNvnRadioClipKind
  readonly status: NetNvnRadioClipStatus
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

export interface NetNvnGmRadioStation {
  readonly stationEnabled: boolean
  readonly rotationEpochAt: string
  readonly rotationSeed: string
  readonly breakingStingerClipId: string | null
  readonly overrideMode: Exclude<NetNvnRadioMode, 'rotation'> | null
  readonly overrideClipId: string | null
  readonly overrideStartedAt: string | null
  readonly overrideEndsAt: string | null
  readonly updatedAt: string
}

export interface NetNvnGmRadioControlPayload {
  readonly serverNow: string
  readonly radioRevision: number
  readonly station: NetNvnGmRadioStation
  readonly effective: NetNvnRadioTuneState
  readonly clips: readonly NetNvnGmRadioClip[]
  readonly libraryByteSize: number
  readonly libraryByteBudget: number
}

export interface NetNvnGmRadioClipInput {
  readonly internalLabel: string
  readonly publicLabel?: string
  readonly clipKind: NetNvnRadioClipKind
  readonly rotationEnabled: boolean
  readonly rotationWeight: number
}

export interface NetNvnRadioAudioMetadata {
  readonly file: File
  readonly mimeType: string
  readonly extension: 'mp3' | 'm4a' | 'mp4' | 'ogg' | 'webm'
  readonly byteSize: number
  readonly durationMs: number
}

export interface NetNvnRadioTuneSample {
  readonly state: NetNvnRadioTuneState
  readonly requestStartedAt: number
  readonly responseReceivedAt: number
}

export type NetNvnRadioErrorCode =
  | 'authentication-required'
  | 'permission-denied'
  | 'invalid-input'
  | 'invalid-response'
  | 'station-disabled'
  | 'override-active'
  | 'clip-not-found'
  | 'clip-limit'
  | 'storage-budget'
  | 'stinger-configured'
  | 'delete-requires-archived'
  | 'delete-pending'
  | 'delete-object-present'
  | 'storage-failed'
  | 'signing-failed'
  | 'autoplay-blocked'
  | 'request-failed'

export class NetNvnRadioError extends Error {
  readonly code: NetNvnRadioErrorCode

  constructor(code: NetNvnRadioErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'NetNvnRadioError'
    this.code = code
  }
}

export function isNetNvnRadioError(error: unknown): error is NetNvnRadioError {
  return error instanceof NetNvnRadioError
}
