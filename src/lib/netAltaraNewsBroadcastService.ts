import {
  buildRpgAudioObjectPath,
  inspectRpgAudioFile,
  removeRpgAudioObject,
  signRpgAudioObject,
  uploadRpgAudioObject,
} from './audio/audioStorage'
import {
  NET_ALTARA_NEWS_BROADCAST_LIBRARY_BYTE_BUDGET,
  NET_ALTARA_NEWS_BROADCAST_MAX_DURATION_MS,
  NET_ALTARA_NEWS_BROADCAST_MAX_FILE_BYTES,
  NetAltaraNewsBroadcastError,
  netAltaraNewsBroadcastClipKinds,
  netAltaraNewsBroadcastModes,
  type NetAltaraNewsBroadcastClipKind,
  type NetAltaraNewsBroadcastCurrentClip,
  type NetAltaraNewsBroadcastMode,
  type NetAltaraNewsBroadcastTuneSample,
  type NetAltaraNewsBroadcastTuneState,
  type NetAltaraNewsGmBroadcastClip,
  type NetAltaraNewsGmBroadcastClipInput,
  type NetAltaraNewsGmBroadcastPayload,
  type NetAltaraNewsGmBroadcastStation,
} from './netAltaraNewsBroadcastTypes'
import type { NetNvnRadioAudioMetadata } from './netNvnRadioTypes'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'

interface RpcErrorLike { readonly code?: string; readonly message: string }
type RecordValue = Record<string, unknown>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const OBJECT_PATH = /^altara-news-broadcast\/([0-9a-f-]{36})\/[0-9a-f]{64}\.(mp3|m4a|mp4|ogg|webm)$/
const pendingUploads = new WeakMap<File, {
  readonly clipId: string
  readonly metadata: NetNvnRadioAudioMetadata
  readonly objectPath: string
}>()

function client() {
  if (!supabase) throw new NetAltaraNewsBroadcastError('request-failed', SUPABASE_CONFIG_ERROR)
  return supabase
}
function record(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
function invalid(message: string): never {
  throw new NetAltaraNewsBroadcastError('invalid-response', message)
}
function string(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    return invalid(`Invalid ${label} returned by ALTARA NEWS Broadcast.`)
  }
  return value
}
function optionalString(value: unknown, max: number, label: string): string | undefined {
  return value === null || value === undefined ? undefined : string(value, max, label)
}
function bool(value: unknown, label: string): boolean {
  return typeof value === 'boolean' ? value : invalid(`Invalid ${label} returned by ALTARA NEWS Broadcast.`)
}
function integer(value: unknown, min: number, max: number, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : invalid(`Invalid ${label} returned by ALTARA NEWS Broadcast.`)
}
function timestamp(value: unknown, label: string): string {
  const parsed = string(value, 64, label)
  return Number.isNaN(Date.parse(parsed)) ? invalid(`Invalid ${label}.`) : parsed
}
function nullableTimestamp(value: unknown, label: string): string | null {
  return value === null || value === undefined ? null : timestamp(value, label)
}
function uuid(value: unknown, label: string): string {
  const parsed = string(value, 64, label)
  return UUID.test(parsed) ? parsed : invalid(`Invalid ${label}.`)
}
function choice<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  label: string,
): Values[number] {
  return typeof value === 'string' && values.includes(value)
    ? value as Values[number]
    : invalid(`Invalid ${label}.`)
}
function objectPath(value: unknown, clipId: string): string {
  const path = string(value, 240, 'audio object path')
  const match = OBJECT_PATH.exec(path)
  return match?.[1] === clipId ? path : invalid('ALTARA broadcast audio path mismatch.')
}

function parseCurrent(value: unknown): NetAltaraNewsBroadcastCurrentClip | null {
  if (value === null || value === undefined) return null
  if (!record(value)) return invalid('Invalid current ALTARA transmission.')
  const clipId = uuid(value.clip_id, 'current clip id')
  const startedAt = timestamp(value.started_at, 'transmission start')
  const endsAt = timestamp(value.ends_at, 'transmission end')
  if (Date.parse(endsAt) <= Date.parse(startedAt)) return invalid('Invalid transmission window.')
  const publicLabel = optionalString(value.public_label, 160, 'public label')
  return {
    clipId,
    ...(publicLabel ? { publicLabel } : {}),
    clipKind: choice(value.clip_kind, netAltaraNewsBroadcastClipKinds, 'clip kind') as NetAltaraNewsBroadcastClipKind,
    durationMs: integer(value.duration_ms, 2_000, NET_ALTARA_NEWS_BROADCAST_MAX_DURATION_MS, 'duration'),
    startedAt,
    endsAt,
    objectPath: objectPath(value.object_path, clipId),
  }
}

function parseTune(value: unknown, requireIdentity: boolean): NetAltaraNewsBroadcastTuneState {
  if (!record(value)) return invalid('Invalid ALTARA NEWS Broadcast tune state.')
  const status = choice(value.station_status, ['off-air', 'on-air'] as const, 'station status')
  const current = parseCurrent(value.current)
  if ((status === 'on-air') !== Boolean(current)) return invalid('Station state and transmission disagree.')
  return {
    serverNow: timestamp(value.server_now, 'server clock'),
    stationStatus: status,
    mode: choice(value.mode, netAltaraNewsBroadcastModes, 'broadcast mode') as NetAltaraNewsBroadcastMode,
    broadcastRevision: integer(value.broadcast_revision ?? 0, 0, Number.MAX_SAFE_INTEGER, 'broadcast revision'),
    identityLinkId: requireIdentity ? uuid(value.identity_link_id, 'reader identity') : '',
    current,
  }
}

function parseClip(value: unknown): NetAltaraNewsGmBroadcastClip {
  if (!record(value)) return invalid('Invalid ALTARA broadcast clip.')
  const id = uuid(value.id, 'clip id')
  const publicLabel = optionalString(value.public_label, 160, 'public label')
  return {
    id,
    internalLabel: string(value.internal_label, 120, 'internal label'),
    ...(publicLabel ? { publicLabel } : {}),
    clipKind: choice(value.clip_kind, netAltaraNewsBroadcastClipKinds, 'clip kind') as NetAltaraNewsBroadcastClipKind,
    status: choice(value.status, ['active', 'archived'] as const, 'clip status'),
    rotationEnabled: bool(value.rotation_enabled, 'rotation state'),
    rotationWeight: integer(value.rotation_weight, 1, 5, 'rotation weight'),
    objectPath: objectPath(value.object_path, id),
    mimeType: string(value.mime_type, 64, 'MIME type'),
    byteSize: integer(value.byte_size, 1, NET_ALTARA_NEWS_BROADCAST_MAX_FILE_BYTES, 'byte size'),
    durationMs: integer(value.duration_ms, 2_000, NET_ALTARA_NEWS_BROADCAST_MAX_DURATION_MS, 'duration'),
    pendingDeleteAt: nullableTimestamp(value.pending_delete_at, 'deletion preparation'),
    createdAt: timestamp(value.created_at, 'created time'),
    updatedAt: timestamp(value.updated_at, 'updated time'),
  }
}

function parseStation(value: unknown): NetAltaraNewsGmBroadcastStation {
  if (!record(value)) return invalid('Invalid ALTARA station state.')
  return {
    stationEnabled: bool(value.station_enabled, 'station state'),
    rotationEpochAt: timestamp(value.rotation_epoch_at, 'rotation epoch'),
    rotationSeed: String(value.rotation_seed ?? ''),
    breakingStingerClipId: value.breaking_stinger_clip_id == null ? null : uuid(value.breaking_stinger_clip_id, 'stinger id'),
    overrideMode: value.override_mode == null ? null : choice(value.override_mode, ['play-now', 'breaking'] as const, 'override mode'),
    overrideClipId: value.override_clip_id == null ? null : uuid(value.override_clip_id, 'override id'),
    overrideStartedAt: nullableTimestamp(value.override_started_at, 'override start'),
    overrideEndsAt: nullableTimestamp(value.override_ends_at, 'override end'),
    updatedAt: timestamp(value.updated_at, 'station update'),
  }
}

function parseControl(value: unknown): NetAltaraNewsGmBroadcastPayload {
  if (!record(value) || !Array.isArray(value.clips) || value.clips.length > 200) {
    return invalid('Invalid bounded ALTARA broadcast control payload.')
  }
  const tune = parseTune({
    ...(record(value.effective) ? value.effective : {}),
    broadcast_revision: value.broadcast_revision,
  }, false)
  const effective = {
    serverNow: tune.serverNow,
    stationStatus: tune.stationStatus,
    mode: tune.mode,
    broadcastRevision: tune.broadcastRevision,
    current: tune.current,
  }
  return {
    serverNow: timestamp(value.server_now, 'server clock'),
    broadcastRevision: integer(value.broadcast_revision, 0, Number.MAX_SAFE_INTEGER, 'revision'),
    station: parseStation(value.station),
    effective,
    clips: value.clips.map(parseClip),
    libraryByteSize: integer(value.library_byte_size, 0, Number.MAX_SAFE_INTEGER, 'library usage'),
    libraryByteBudget: integer(
      value.library_byte_budget,
      NET_ALTARA_NEWS_BROADCAST_LIBRARY_BYTE_BUDGET,
      NET_ALTARA_NEWS_BROADCAST_LIBRARY_BYTE_BUDGET,
      'library budget',
    ),
  }
}

function mapError(prefix: string, error: RpcErrorLike): NetAltaraNewsBroadcastError {
  const message = error.message
  if (error.code === '42501' || message.includes('ALTARA_NEWS_') && message.includes('AUTH')) {
    return new NetAltaraNewsBroadcastError('permission-denied', 'ALTARA NEWS broadcast authority is unavailable.')
  }
  if (message.includes('OVERRIDE_ACTIVE')) return new NetAltaraNewsBroadcastError('override-active', 'Another global broadcast override is active.')
  if (message.includes('STATION_DISABLED')) return new NetAltaraNewsBroadcastError('station-disabled', 'Enable the station before starting an override.')
  if (message.includes('STORAGE_BUDGET')) return new NetAltaraNewsBroadcastError('storage-budget', 'The conservative 400 MB broadcast library budget is full.')
  if (message.includes('STINGER_')) return new NetAltaraNewsBroadcastError('stinger-configured', 'The breaking intro must be cleared or the active break ended first.')
  if (message.includes('DELETE_REQUIRES_ARCHIVED')) return new NetAltaraNewsBroadcastError('delete-requires-archived', 'Archive the clip before permanent deletion.')
  if (message.includes('DELETE_PENDING') || message.includes('DELETE_NOT_PREPARED')) return new NetAltaraNewsBroadcastError('delete-pending', 'Permanent deletion needs to resume from its prepared state.')
  if (message.includes('DELETE_OBJECT_STILL_EXISTS')) return new NetAltaraNewsBroadcastError('delete-object-present', 'The secure audio object must be removed before finalization.')
  if (message.includes('CLIP_NOT_FOUND') || error.code === 'P0002') return new NetAltaraNewsBroadcastError('clip-not-found', 'That broadcast clip is no longer available.')
  if (message.includes('LIMIT_REACHED')) return new NetAltaraNewsBroadcastError('clip-limit', 'The bounded ALTARA broadcast library is full.')
  if (error.code === '22023' || message.includes('ALTARA_NEWS_BROADCAST_')) return new NetAltaraNewsBroadcastError('invalid-input', 'The broadcast request failed the bounded server contract.')
  return new NetAltaraNewsBroadcastError('request-failed', `${prefix}: ${message}`)
}

async function rpcControl(name: string, args?: RecordValue): Promise<NetAltaraNewsGmBroadcastPayload> {
  const { data, error } = await client().rpc(name, args)
  if (error) throw mapError('ALTARA NEWS Broadcast Control failed', error)
  return parseControl(data)
}

export async function fetchNetAltaraNewsBroadcastTuneState(
  expectedIdentityLinkId: string,
): Promise<NetAltaraNewsBroadcastTuneSample> {
  const requestStartedAt = performance.now()
  const { data, error } = await client().rpc('fetch_net_altara_news_broadcast_tune_state', {
    requested_expected_identity_link_id: expectedIdentityLinkId,
  })
  const responseReceivedAt = performance.now()
  if (error) throw mapError('ALTARA NEWS Broadcast could not synchronize', error)
  const state = parseTune(data, true)
  if (state.identityLinkId !== expectedIdentityLinkId) return invalid('ALTARA reader identity changed during broadcast resolution.')
  return { state, requestStartedAt, responseReceivedAt }
}

export async function fetchNetAltaraNewsGmBroadcastControl() {
  return rpcControl('fetch_net_altara_news_gm_broadcast_control')
}

export async function uploadAndCreateNetAltaraNewsGmBroadcastClip(
  file: File,
  input: NetAltaraNewsGmBroadcastClipInput,
) {
  let pending = pendingUploads.get(file)
  if (!pending) {
    const clipId = crypto.randomUUID()
    const metadata = await inspectRpgAudioFile(file)
    const objectPath = await buildRpgAudioObjectPath(clipId, metadata, 'altara-news-broadcast')
    pending = { clipId, metadata, objectPath }
    pendingUploads.set(file, pending)
  }
  await uploadRpgAudioObject(pending.objectPath, pending.metadata)
  try {
    const result = await rpcControl('create_net_altara_news_gm_broadcast_clip', {
      requested_clip_id: pending.clipId,
      requested_internal_label: input.internalLabel,
      requested_public_label: input.publicLabel ?? null,
      requested_clip_kind: input.clipKind,
      requested_rotation_enabled: input.rotationEnabled,
      requested_rotation_weight: input.rotationWeight,
      requested_object_path: pending.objectPath,
      requested_mime_type: pending.metadata.mimeType,
      requested_byte_size: pending.metadata.byteSize,
      requested_duration_ms: pending.metadata.durationMs,
    })
    pendingUploads.delete(file)
    return result
  } catch (error) {
    void removeRpgAudioObject(pending.objectPath).catch(() => {})
    throw error
  }
}

export const updateNetAltaraNewsGmBroadcastClip = (
  clipId: string,
  input: NetAltaraNewsGmBroadcastClipInput,
) => rpcControl('update_net_altara_news_gm_broadcast_clip', {
  requested_clip_id: clipId,
  requested_internal_label: input.internalLabel,
  requested_public_label: input.publicLabel ?? null,
  requested_clip_kind: input.clipKind,
  requested_rotation_enabled: input.rotationEnabled,
  requested_rotation_weight: input.rotationWeight,
})
export const setNetAltaraNewsGmBroadcastClipArchived = (clipId: string, archived: boolean) => rpcControl('set_net_altara_news_gm_broadcast_clip_archived', { requested_clip_id: clipId, requested_archived: archived })
export const setNetAltaraNewsGmBroadcastStationEnabled = (enabled: boolean) => rpcControl('set_net_altara_news_gm_broadcast_station_enabled', { requested_enabled: enabled })
export const setNetAltaraNewsGmBroadcastBreakingStinger = (clipId: string | null) => rpcControl('set_net_altara_news_gm_broadcast_breaking_stinger', { requested_clip_id: clipId })
export const startNetAltaraNewsGmBroadcastOverride = (clipId: string, mode: Exclude<NetAltaraNewsBroadcastMode, 'rotation'>, replaceActive = false) => rpcControl('start_net_altara_news_gm_broadcast_override', { requested_clip_id: clipId, requested_mode: mode, requested_replace_active: replaceActive })
export const endNetAltaraNewsGmBroadcastOverride = () => rpcControl('end_net_altara_news_gm_broadcast_override')
export const prepareNetAltaraNewsGmBroadcastClipDelete = (clipId: string) => rpcControl('prepare_net_altara_news_gm_broadcast_clip_delete', { requested_clip_id: clipId })
export const finalizeNetAltaraNewsGmBroadcastClipDelete = (clipId: string) => rpcControl('finalize_net_altara_news_gm_broadcast_clip_delete', { requested_clip_id: clipId })

export async function removePreparedNetAltaraNewsGmBroadcastClipObject(
  clip: NetAltaraNewsGmBroadcastClip,
): Promise<void> {
  if (clip.status !== 'archived' || !clip.pendingDeleteAt || clip.rotationEnabled) {
    throw new NetAltaraNewsBroadcastError('invalid-response', 'ALTARA NEWS did not confirm the recoverable deletion state.')
  }
  await removeRpgAudioObject(clip.objectPath, 'permanent-delete')
}

export const signNetAltaraNewsCurrentBroadcastObject = (
  objectPathValue: string,
  ttlSeconds: number,
) => signRpgAudioObject(objectPathValue, ttlSeconds, 'ALTARA NEWS').catch((error: unknown) => {
  throw new NetAltaraNewsBroadcastError(
    'signing-failed',
    error instanceof Error ? error.message : 'The current ALTARA NEWS carrier could not be signed.',
    { cause: error },
  )
})

export const inspectNetAltaraNewsBroadcastAudio = inspectRpgAudioFile
