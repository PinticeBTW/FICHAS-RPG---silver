import { supabase, SUPABASE_CONFIG_ERROR } from '../supabase'
import {
  NET_NVN_RADIO_MAX_DURATION_MS,
  NET_NVN_RADIO_MAX_FILE_BYTES,
  NET_NVN_RADIO_MIN_DURATION_MS,
  NET_NVN_RADIO_SIGNED_URL_MAX_TTL_SECONDS,
  NET_NVN_RADIO_SIGNED_URL_MIN_TTL_SECONDS,
  NetNvnRadioError,
  type NetNvnRadioAudioMetadata,
} from '../netNvnRadioTypes'

const RPG_AUDIO_BUCKET = 'rpg-audio'
const AUDIO_METADATA_TIMEOUT_MS = 12_000
const AUDIO_SIGNING_TIMEOUT_MS = 15_000
const ACCEPTED_AUDIO_TYPES: Readonly<Record<string, NetNvnRadioAudioMetadata['extension']>> = {
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
}
const ACCEPTED_AUDIO_EXTENSIONS: Readonly<Record<string, {
  readonly extension: NetNvnRadioAudioMetadata['extension']
  readonly mimeType: string
}>> = {
  mp3: { extension: 'mp3', mimeType: 'audio/mpeg' },
  m4a: { extension: 'm4a', mimeType: 'audio/mp4' },
  mp4: { extension: 'mp4', mimeType: 'audio/mp4' },
  ogg: { extension: 'ogg', mimeType: 'audio/ogg' },
  webm: { extension: 'webm', mimeType: 'audio/webm' },
}

function audioClient() {
  if (!supabase) throw new NetNvnRadioError('storage-failed', SUPABASE_CONFIG_ERROR)
  return supabase.storage.from(RPG_AUDIO_BUCKET)
}

function timeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new NetNvnRadioError('request-failed', message)), milliseconds)
    void promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        window.clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export async function inspectRpgAudioFile(file: File): Promise<NetNvnRadioAudioMetadata> {
  if (file.size <= 0 || file.size > NET_NVN_RADIO_MAX_FILE_BYTES) {
    throw new NetNvnRadioError('invalid-input', 'Radio audio must be no larger than 15 MB.')
  }
  const namedExtension = file.name.toLowerCase().split('.').pop() ?? ''
  const canUseExtensionFallback = file.type === '' || file.type === 'application/octet-stream'
  const extension = ACCEPTED_AUDIO_TYPES[file.type]
    ?? (canUseExtensionFallback ? ACCEPTED_AUDIO_EXTENSIONS[namedExtension]?.extension : undefined)
  const mimeType = ACCEPTED_AUDIO_TYPES[file.type]
    ? file.type
    : canUseExtensionFallback
      ? ACCEPTED_AUDIO_EXTENSIONS[namedExtension]?.mimeType
      : undefined
  if (!extension || !mimeType) {
    throw new NetNvnRadioError(
      'invalid-input',
      'Use a compressed MP3, M4A, MP4 audio, OGG, or WebM file. WAV and AIFF are not accepted.',
    )
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    const durationSeconds = await timeout(new Promise<number>((resolve, reject) => {
      const audio = document.createElement('audio')
      audio.preload = 'metadata'
      audio.onloadedmetadata = () => {
        const duration = audio.duration
        audio.removeAttribute('src')
        audio.load()
        if (!Number.isFinite(duration)) reject(new Error('Audio duration is not finite.'))
        else resolve(duration)
      }
      audio.onerror = () => reject(new Error('The browser could not read this audio file.'))
      audio.src = objectUrl
    }), AUDIO_METADATA_TIMEOUT_MS, 'Audio metadata inspection timed out.')
    const durationMs = Math.round(durationSeconds * 1000)
    if (durationMs < NET_NVN_RADIO_MIN_DURATION_MS || durationMs > NET_NVN_RADIO_MAX_DURATION_MS) {
      throw new NetNvnRadioError('invalid-input', 'Radio clips must be between 2 seconds and 15 minutes.')
    }
    return {
      file,
      mimeType,
      extension,
      byteSize: file.size,
      durationMs,
    }
  } catch (error) {
    if (error instanceof NetNvnRadioError) throw error
    throw new NetNvnRadioError('invalid-input', 'The selected audio metadata could not be validated.', {
      cause: error,
    })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function buildRpgAudioObjectPath(
  clipId: string,
  metadata: NetNvnRadioAudioMetadata,
  namespace: 'nvn-radio' | 'altara-news-broadcast' | 'altara-music' = 'nvn-radio',
): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await metadata.file.arrayBuffer())
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${namespace}/${clipId}/${hash}.${metadata.extension}`
}

export async function uploadRpgAudioObject(
  objectPath: string,
  metadata: NetNvnRadioAudioMetadata,
): Promise<void> {
  const { error } = await audioClient().upload(objectPath, metadata.file, {
    cacheControl: '31536000',
    contentType: metadata.mimeType,
    upsert: false,
  })
  if (error && !error.message.toLowerCase().includes('already exists')) {
    throw new NetNvnRadioError('storage-failed', `Secure radio upload failed: ${error.message}`)
  }
}

export async function removeRpgAudioObject(
  objectPath: string,
  purpose: 'unregistered-cleanup' | 'permanent-delete' = 'unregistered-cleanup',
): Promise<void> {
  const { error } = await audioClient().remove([objectPath])
  if (error) {
    const operation = purpose === 'permanent-delete'
      ? 'Permanent secure audio removal'
      : 'Secure orphan cleanup'
    throw new NetNvnRadioError('storage-failed', `${operation} failed: ${error.message}`)
  }
}

export async function signRpgAudioObject(
  objectPath: string,
  requestedTtlSeconds: number,
  productLabel = 'NVN',
): Promise<string> {
  const ttlSeconds = Math.min(
    NET_NVN_RADIO_SIGNED_URL_MAX_TTL_SECONDS,
    Math.max(NET_NVN_RADIO_SIGNED_URL_MIN_TTL_SECONDS, Math.ceil(requestedTtlSeconds)),
  )
  const request = audioClient().createSignedUrl(objectPath, ttlSeconds)
  const { data, error } = await timeout(
    request,
    AUDIO_SIGNING_TIMEOUT_MS,
    'Secure radio signing timed out.',
  )
  if (error || !data?.signedUrl) {
    throw new NetNvnRadioError(
      'signing-failed',
      `The current ${productLabel} transmission could not be opened${error?.message ? `: ${error.message}` : '.'}`,
    )
  }
  return data.signedUrl
}
