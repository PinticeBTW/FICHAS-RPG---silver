import {
  buildRpgAudioObjectPath,
  inspectRpgAudioFile,
  removeRpgAudioObject,
  signRpgAudioObject,
  uploadRpgAudioObject,
} from './audio/audioStorage'
import {
  NET_NVN_RADIO_MAX_ACTIVE_CLIPS,
  NET_NVN_RADIO_MAX_DURATION_MS,
  NET_NVN_RADIO_MAX_FILE_BYTES,
  NET_NVN_RADIO_LIBRARY_BYTE_BUDGET,
  NetNvnRadioError,
  netNvnRadioClipKinds,
  netNvnRadioModes,
  type NetNvnGmRadioClip,
  type NetNvnGmRadioClipInput,
  type NetNvnGmRadioControlPayload,
  type NetNvnGmRadioStation,
  type NetNvnRadioAudioMetadata,
  type NetNvnRadioClipKind,
  type NetNvnRadioClipStatus,
  type NetNvnRadioCurrentClip,
  type NetNvnRadioMode,
  type NetNvnRadioTuneSample,
  type NetNvnRadioTuneState,
} from './netNvnRadioTypes'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'

interface SupabaseRpcErrorLike {
  readonly code?: string
  readonly message: string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const OBJECT_PATH_PATTERN = /^nvn-radio\/([0-9a-f-]{36})\/[0-9a-f]{64}\.(mp3|m4a|mp4|ogg|webm)$/
const pendingUploads = new WeakMap<File, {
  readonly clipId: string
  readonly metadata: NetNvnRadioAudioMetadata
  readonly objectPath: string
}>()

function client() {
  if (!supabase) throw new NetNvnRadioError('request-failed', SUPABASE_CONFIG_ERROR)
  return supabase
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function invalidResponse(message: string): never {
  throw new NetNvnRadioError('invalid-response', message)
}

function requiredString(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    return invalidResponse(`Invalid ${label} returned by the NVN radio server.`)
  }
  return value
}

function optionalString(value: unknown, maximum: number, label: string): string | undefined {
  if (value === null || value === undefined) return undefined
  return requiredString(value, maximum, label)
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') return invalidResponse(`Invalid ${label} returned by the NVN radio server.`)
  return value
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    return invalidResponse(`Invalid ${label} returned by the NVN radio server.`)
  }
  return parsed
}

function timestamp(value: unknown, label: string): string {
  const parsed = requiredString(value, 64, label)
  if (Number.isNaN(Date.parse(parsed))) return invalidResponse(`Invalid ${label} returned by the NVN radio server.`)
  return parsed
}

function nullableTimestamp(value: unknown, label: string): string | null {
  return value === null || value === undefined ? null : timestamp(value, label)
}

function uuid(value: unknown, label: string): string {
  const parsed = requiredString(value, 64, label)
  if (!UUID_PATTERN.test(parsed)) return invalidResponse(`Invalid ${label} returned by the NVN radio server.`)
  return parsed
}

function enumValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  label: string,
): Values[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    return invalidResponse(`Invalid ${label} returned by the NVN radio server.`)
  }
  return value as Values[number]
}

function objectPath(value: unknown, clipId: string): string {
  const path = requiredString(value, 220, 'audio object path')
  const match = OBJECT_PATH_PATTERN.exec(path)
  if (!match || match[1] !== clipId) return invalidResponse('The NVN audio path does not match its clip.')
  return path
}

function parseCurrent(value: unknown): NetNvnRadioCurrentClip | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) return invalidResponse('Invalid current transmission returned by the NVN radio server.')
  const clipId = uuid(value.clip_id, 'current clip id')
  const publicLabel = optionalString(value.public_label, 160, 'public label')
  const durationMs = integer(value.duration_ms, 2_000, NET_NVN_RADIO_MAX_DURATION_MS, 'clip duration')
  const startedAt = timestamp(value.started_at, 'transmission start')
  const endsAt = timestamp(value.ends_at, 'transmission end')
  if (Date.parse(endsAt) <= Date.parse(startedAt)) return invalidResponse('The current transmission window is invalid.')
  return {
    clipId,
    ...(publicLabel ? { publicLabel } : {}),
    clipKind: enumValue(value.clip_kind, netNvnRadioClipKinds, 'clip kind') as NetNvnRadioClipKind,
    durationMs,
    startedAt,
    endsAt,
    objectPath: objectPath(value.object_path, clipId),
  }
}

function parseTuneState(value: unknown): NetNvnRadioTuneState {
  if (!isRecord(value)) return invalidResponse('The NVN radio server returned an invalid tune state.')
  const stationStatus = enumValue(value.station_status, ['off-air', 'on-air'] as const, 'station status')
  const mode = enumValue(value.mode, netNvnRadioModes, 'radio mode') as NetNvnRadioMode
  const current = parseCurrent(value.current)
  if ((stationStatus === 'on-air') !== Boolean(current)) {
    return invalidResponse('The NVN station status and current transmission disagree.')
  }
  return {
    serverNow: timestamp(value.server_now, 'server clock'),
    stationStatus,
    mode,
    radioRevision: integer(value.radio_revision ?? 0, 0, Number.MAX_SAFE_INTEGER, 'radio revision'),
    current,
  }
}

function parseClip(value: unknown): NetNvnGmRadioClip {
  if (!isRecord(value)) return invalidResponse('Invalid clip returned by NVN Radio Control.')
  const id = uuid(value.id, 'radio clip id')
  const publicLabel = optionalString(value.public_label, 160, 'public label')
  return {
    id,
    internalLabel: requiredString(value.internal_label, 120, 'internal label'),
    ...(publicLabel ? { publicLabel } : {}),
    clipKind: enumValue(value.clip_kind, netNvnRadioClipKinds, 'clip kind') as NetNvnRadioClipKind,
    status: enumValue(value.status, ['active', 'archived'] as const, 'clip status') as NetNvnRadioClipStatus,
    rotationEnabled: boolean(value.rotation_enabled, 'rotation state'),
    rotationWeight: integer(value.rotation_weight, 1, 5, 'rotation weight'),
    objectPath: objectPath(value.object_path, id),
    mimeType: requiredString(value.mime_type, 64, 'audio MIME type'),
    byteSize: integer(value.byte_size, 1, NET_NVN_RADIO_MAX_FILE_BYTES, 'audio byte size'),
    durationMs: integer(value.duration_ms, 2_000, NET_NVN_RADIO_MAX_DURATION_MS, 'clip duration'),
    pendingDeleteAt: nullableTimestamp(value.pending_delete_at, 'permanent deletion preparation'),
    createdAt: timestamp(value.created_at, 'clip creation time'),
    updatedAt: timestamp(value.updated_at, 'clip update time'),
  }
}

function parseStation(value: unknown): NetNvnGmRadioStation {
  if (!isRecord(value)) return invalidResponse('Invalid station state returned by NVN Radio Control.')
  const overrideMode = value.override_mode === null || value.override_mode === undefined
    ? null
    : enumValue(value.override_mode, ['play-now', 'breaking'] as const, 'override mode')
  const overrideClipId = value.override_clip_id === null || value.override_clip_id === undefined
    ? null
    : uuid(value.override_clip_id, 'override clip id')
  return {
    stationEnabled: boolean(value.station_enabled, 'station enabled state'),
    rotationEpochAt: timestamp(value.rotation_epoch_at, 'rotation epoch'),
    rotationSeed: String(value.rotation_seed ?? ''),
    breakingStingerClipId: value.breaking_stinger_clip_id === null
      || value.breaking_stinger_clip_id === undefined
      ? null
      : uuid(value.breaking_stinger_clip_id, 'breaking stinger clip id'),
    overrideMode,
    overrideClipId,
    overrideStartedAt: nullableTimestamp(value.override_started_at, 'override start'),
    overrideEndsAt: nullableTimestamp(value.override_ends_at, 'override end'),
    updatedAt: timestamp(value.updated_at, 'station update time'),
  }
}

function parseControl(value: unknown): NetNvnGmRadioControlPayload {
  if (!isRecord(value)) return invalidResponse('The NVN radio editor returned an invalid payload.')
  if (!Array.isArray(value.clips) || value.clips.length > 200) {
    return invalidResponse('The NVN radio library exceeded its bounded contract.')
  }
  const effective = parseTuneState({
    ...(isRecord(value.effective) ? value.effective : {}),
    radio_revision: value.radio_revision,
  })
  return {
    serverNow: timestamp(value.server_now, 'server clock'),
    radioRevision: integer(value.radio_revision, 0, Number.MAX_SAFE_INTEGER, 'radio revision'),
    station: parseStation(value.station),
    effective,
    clips: value.clips.map(parseClip),
    libraryByteSize: integer(
      value.library_byte_size,
      0,
      Number.MAX_SAFE_INTEGER,
      'NVN audio library usage',
    ),
    libraryByteBudget: integer(
      value.library_byte_budget,
      NET_NVN_RADIO_LIBRARY_BYTE_BUDGET,
      NET_NVN_RADIO_LIBRARY_BYTE_BUDGET,
      'NVN audio library budget',
    ),
  }
}

function mapError(prefix: string, error: SupabaseRpcErrorLike): NetNvnRadioError {
  const message = error.message
  if (message.includes('Authentication is required')) {
    return new NetNvnRadioError('authentication-required', 'Sign in again to reach NVN Live Broadcast.')
  }
  if (error.code === '42501' || message.includes('authoritative GM')) {
    return new NetNvnRadioError('permission-denied', 'Authoritative GM access is required for LIVE Control.')
  }
  if (message.includes('NVN_RADIO_OVERRIDE_ACTIVE')) {
    return new NetNvnRadioError('override-active', 'Another radio override is active. Confirm replacement to interrupt it.')
  }
  if (message.includes('NVN_RADIO_STATION_DISABLED')) {
    return new NetNvnRadioError('station-disabled', 'Enable LIVE broadcast before starting an override.')
  }
  if (message.includes('NVN_RADIO_STORAGE_BUDGET_REACHED')) {
    return new NetNvnRadioError(
      'storage-budget',
      'The 400 MB NVN audio budget is full. Archived registered clips remain part of this project-level budget.',
    )
  }
  if (message.includes('NVN_RADIO_STINGER_CONFIGURED')) {
    return new NetNvnRadioError(
      'stinger-configured',
      'This clip is the configured Breaking Intro. Choose another intro or clear the setup before archiving it.',
    )
  }
  if (message.includes('NVN_RADIO_STINGER_ROTATION_INVALID')) {
    return new NetNvnRadioError(
      'stinger-configured',
      'Breaking Intro is reserved for BREAKING NEWS. Change or clear the intro before enabling normal rotation.',
    )
  }
  if (message.includes('NVN_RADIO_STINGER_CHANGE_DURING_BREAKING')) {
    return new NetNvnRadioError(
      'override-active',
      'End the active BREAKING NEWS transmission before changing its configured intro.',
    )
  }
  if (message.includes('NVN_RADIO_DELETE_REQUIRES_ARCHIVED')) {
    return new NetNvnRadioError(
      'delete-requires-archived',
      'Only an archived clip outside normal rotation can be permanently deleted.',
    )
  }
  if (message.includes('NVN_RADIO_DELETE_PENDING')) {
    return new NetNvnRadioError(
      'delete-pending',
      'This clip is pending permanent deletion. Retry deletion to finish removing its secure file.',
    )
  }
  if (message.includes('NVN_RADIO_DELETE_OBJECT_STILL_EXISTS')) {
    return new NetNvnRadioError(
      'delete-object-present',
      'The secure audio file still exists. Retry permanent deletion to remove it before finalizing.',
    )
  }
  if (message.includes('NVN_RADIO_DELETE_NOT_PREPARED')) {
    return new NetNvnRadioError(
      'delete-pending',
      'Permanent deletion was not prepared. Start the deletion again from the archived clip.',
    )
  }
  if (message.includes('NVN_RADIO_CLIP_CURRENTLY_OVERRIDING')) {
    return new NetNvnRadioError(
      'override-active',
      'This clip is still part of the active global broadcast and cannot be archived or deleted.',
    )
  }
  if (error.code === 'P0002' || message.includes('NVN_RADIO_CLIP_NOT_FOUND')) {
    return new NetNvnRadioError('clip-not-found', 'That radio clip is no longer available.')
  }
  if (message.includes('LIMIT_REACHED')) {
    return new NetNvnRadioError('clip-limit', `The bounded NVN radio library is full. ${message}`)
  }
  if (error.code === '22023' || message.includes('NVN_RADIO_')) {
    return new NetNvnRadioError('invalid-input', 'The radio request does not match the bounded server contract.')
  }
  return new NetNvnRadioError('request-failed', `${prefix}: ${message}`)
}

async function rpcControl(name: string, args?: Record<string, unknown>): Promise<NetNvnGmRadioControlPayload> {
  const { data, error } = await client().rpc(name, args)
  if (error) throw mapError('NVN LIVE Broadcast Control request failed', error)
  return parseControl(data)
}

export async function fetchNetNvnRadioTuneState(
  expectedIdentityLinkId: string,
): Promise<NetNvnRadioTuneSample> {
  if (!UUID_PATTERN.test(expectedIdentityLinkId)) {
    throw new NetNvnRadioError('authentication-required', 'The NVN runtime identity is unavailable.')
  }
  const requestStartedAt = performance.now()
  const { data, error } = await client().rpc('fetch_net_nvn_radio_tune_state', {
    requested_expected_identity_link_id: expectedIdentityLinkId,
  })
  const responseReceivedAt = performance.now()
  if (error) throw mapError('NVN Live Broadcast could not synchronize', error)
  return { state: parseTuneState(data), requestStartedAt, responseReceivedAt }
}

export async function fetchNetNvnGmRadioControl(): Promise<NetNvnGmRadioControlPayload> {
  return rpcControl('fetch_net_nvn_gm_radio_control')
}

export async function uploadAndCreateNetNvnGmRadioClip(
  file: File,
  input: NetNvnGmRadioClipInput,
): Promise<NetNvnGmRadioControlPayload> {
  let pending = pendingUploads.get(file)
  if (!pending) {
    const clipId = crypto.randomUUID()
    const metadata = await inspectRpgAudioFile(file)
    const objectPath = await buildRpgAudioObjectPath(clipId, metadata)
    pending = { clipId, metadata, objectPath }
    pendingUploads.set(file, pending)
  }
  const { clipId, metadata, objectPath } = pending
  await uploadRpgAudioObject(objectPath, metadata)
  try {
    const result = await rpcControl('create_net_nvn_gm_radio_clip', {
      requested_clip_id: clipId,
      requested_internal_label: input.internalLabel,
      requested_public_label: input.publicLabel ?? null,
      requested_clip_kind: input.clipKind,
      requested_rotation_enabled: input.rotationEnabled,
      requested_rotation_weight: input.rotationWeight,
      requested_object_path: objectPath,
      requested_mime_type: metadata.mimeType,
      requested_byte_size: metadata.byteSize,
      requested_duration_ms: metadata.durationMs,
    })
    pendingUploads.delete(file)
    return result
  } catch (error) {
    // Registration can fail after Storage accepted the immutable object. The
    // delete policy permits authoritative GM cleanup only while no clip row
    // references the path. A lost successful RPC response therefore cannot
    // delete a registered clip, and cleanup failure never masks the real error.
    void removeRpgAudioObject(objectPath).catch(() => {})
    throw error
  }
}

export async function inspectNetNvnRadioAudio(file: File): Promise<NetNvnRadioAudioMetadata> {
  return inspectRpgAudioFile(file)
}

export async function updateNetNvnGmRadioClip(
  clipId: string,
  input: NetNvnGmRadioClipInput,
): Promise<NetNvnGmRadioControlPayload> {
  return rpcControl('update_net_nvn_gm_radio_clip', {
    requested_clip_id: clipId,
    requested_internal_label: input.internalLabel,
    requested_public_label: input.publicLabel ?? null,
    requested_clip_kind: input.clipKind,
    requested_rotation_enabled: input.rotationEnabled,
    requested_rotation_weight: input.rotationWeight,
  })
}

export async function setNetNvnGmRadioClipArchived(
  clipId: string,
  archived: boolean,
): Promise<NetNvnGmRadioControlPayload> {
  return rpcControl('set_net_nvn_gm_radio_clip_archived', {
    requested_clip_id: clipId,
    requested_archived: archived,
  })
}

export async function prepareNetNvnGmRadioClipDelete(
  clipId: string,
): Promise<NetNvnGmRadioControlPayload> {
  return rpcControl('prepare_net_nvn_gm_radio_clip_delete', {
    requested_clip_id: clipId,
  })
}

export async function removePreparedNetNvnGmRadioClipObject(
  clip: NetNvnGmRadioClip,
): Promise<void> {
  if (clip.status !== 'archived' || !clip.pendingDeleteAt || clip.rotationEnabled) {
    throw new NetNvnRadioError(
      'invalid-response',
      'NVN did not confirm a recoverable archived-audio deletion state.',
    )
  }
  await removeRpgAudioObject(clip.objectPath, 'permanent-delete')
}

export async function finalizeNetNvnGmRadioClipDelete(
  clipId: string,
): Promise<NetNvnGmRadioControlPayload> {
  return rpcControl('finalize_net_nvn_gm_radio_clip_delete', {
    requested_clip_id: clipId,
  })
}

export async function setNetNvnGmRadioStationEnabled(
  enabled: boolean,
): Promise<NetNvnGmRadioControlPayload> {
  return rpcControl('set_net_nvn_gm_radio_station_enabled', { requested_enabled: enabled })
}

export async function setNetNvnGmRadioBreakingStinger(
  clipId: string | null,
): Promise<NetNvnGmRadioControlPayload> {
  return rpcControl('set_net_nvn_gm_radio_breaking_stinger', {
    requested_clip_id: clipId,
  })
}

export async function startNetNvnGmRadioOverride(
  clipId: string,
  mode: Exclude<NetNvnRadioMode, 'rotation'>,
  replaceActive = false,
): Promise<NetNvnGmRadioControlPayload> {
  return rpcControl('start_net_nvn_gm_radio_override', {
    requested_clip_id: clipId,
    requested_mode: mode,
    requested_replace_active: replaceActive,
  })
}

export async function endNetNvnGmRadioOverride(): Promise<NetNvnGmRadioControlPayload> {
  return rpcControl('end_net_nvn_gm_radio_override')
}

export async function signNetNvnCurrentRadioObject(
  objectPath: string,
  ttlSeconds: number,
): Promise<string> {
  return signRpgAudioObject(objectPath, ttlSeconds)
}

export function assertNetNvnRadioClipInput(input: NetNvnGmRadioClipInput): void {
  if (!input.internalLabel.trim() || input.internalLabel.trim().length > 120) {
    throw new NetNvnRadioError('invalid-input', 'Internal label is required and must be 120 characters or fewer.')
  }
  if (input.publicLabel && input.publicLabel.trim().length > 160) {
    throw new NetNvnRadioError('invalid-input', 'Public label must be 160 characters or fewer.')
  }
  if (!netNvnRadioClipKinds.includes(input.clipKind)) {
    throw new NetNvnRadioError('invalid-input', 'Choose a supported NVN radio clip kind.')
  }
  if (!Number.isInteger(input.rotationWeight) || input.rotationWeight < 1 || input.rotationWeight > 5) {
    throw new NetNvnRadioError('invalid-input', 'Rotation frequency must be between 1 and 5.')
  }
}

export const NET_NVN_RADIO_LIBRARY_ACTIVE_LIMIT = NET_NVN_RADIO_MAX_ACTIVE_CLIPS
