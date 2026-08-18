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
  namespace: 'nvn-radio' | 'altara-news-broadcast' | 'altara-music' | 'vox-audio' = 'nvn-radio',
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

// ---------------------------------------------------------------------------
// Embedded cover-artwork extraction (product-neutral). Reads MP3 ID3v2 APIC
// frames and MP4/M4A 'covr' atoms directly from the file's bytes — no network
// call, no server round trip. OGG/WebM are not parsed for embedded pictures;
// callers simply receive `undefined` for those, identical to "no artwork
// found" for any other format, since neither container reliably standardizes
// picture embedding the way ID3v2/MP4 do. Every failure path resolves to
// `undefined` rather than throwing: malformed or unexpected audio bytes must
// never block selecting or uploading the underlying track.
// ---------------------------------------------------------------------------

export interface ExtractedAudioArtwork {
  readonly blob: Blob
  readonly mimeType: string
}

const KNOWN_ARTWORK_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])

function sniffImageMimeType(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif'
  if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return undefined
}

function decodeLatin1(bytes: Uint8Array, start: number, end: number): string {
  let text = ''
  for (let index = start; index < end; index += 1) text += String.fromCharCode(bytes[index])
  return text
}

function readSyncSafeUint32(view: DataView, offset: number): number {
  return (
    ((view.getUint8(offset) & 0x7f) << 21)
    | ((view.getUint8(offset + 1) & 0x7f) << 14)
    | ((view.getUint8(offset + 2) & 0x7f) << 7)
    | (view.getUint8(offset + 3) & 0x7f)
  )
}

function findNullTerminator(bytes: Uint8Array, start: number, wide: boolean): number {
  if (wide) {
    for (let index = start; index + 1 < bytes.length; index += 2) {
      if (bytes[index] === 0 && bytes[index + 1] === 0) return index
    }
    return bytes.length
  }
  for (let index = start; index < bytes.length; index += 1) {
    if (bytes[index] === 0) return index
  }
  return bytes.length
}

function artworkFromDeclaredOrSniffedType(
  declaredMimeType: string | undefined,
  data: Uint8Array,
): ExtractedAudioArtwork | undefined {
  const normalizedDeclared = declaredMimeType?.trim().toLowerCase()
  const mimeType = (normalizedDeclared && KNOWN_ARTWORK_MIME_TYPES.has(normalizedDeclared))
    ? normalizedDeclared
    : sniffImageMimeType(data)
  if (!mimeType || data.length === 0) return undefined
  // `data` is always sliced from a real ArrayBuffer (never SharedArrayBuffer)
  // produced by `file.arrayBuffer()`; DOM's BlobPart type is stricter than
  // Uint8Array's default ArrayBufferLike generic, hence the narrow cast.
  return { blob: new Blob([data as BlobPart], { type: mimeType }), mimeType }
}

function parseId3ApicFrame(bytes: Uint8Array, start: number, end: number): ExtractedAudioArtwork | undefined {
  if (start >= end) return undefined
  const encoding = bytes[start]
  const mimeEnd = findNullTerminator(bytes, start + 1, false)
  if (mimeEnd >= end) return undefined
  const declaredMimeType = decodeLatin1(bytes, start + 1, mimeEnd)
  let cursor = mimeEnd + 1 + 1 // skip the mime terminator and the picture-type byte
  if (cursor > end) return undefined
  const wide = encoding === 1 || encoding === 2
  const descriptionEnd = findNullTerminator(bytes, cursor, wide)
  cursor = descriptionEnd + (wide ? 2 : 1)
  if (cursor >= end) return undefined
  return artworkFromDeclaredOrSniffedType(declaredMimeType, bytes.slice(cursor, end))
}

function parseId3PicFrame(bytes: Uint8Array, start: number, end: number): ExtractedAudioArtwork | undefined {
  if (start + 4 > end) return undefined
  const encoding = bytes[start]
  const format = decodeLatin1(bytes, start + 1, start + 4).trim().toUpperCase()
  let cursor = start + 4 + 1 // skip the 3-letter format code and the picture-type byte
  if (cursor > end) return undefined
  const wide = encoding === 1 || encoding === 2
  const descriptionEnd = findNullTerminator(bytes, cursor, wide)
  cursor = descriptionEnd + (wide ? 2 : 1)
  if (cursor >= end) return undefined
  const declaredMimeType = format === 'PNG' ? 'image/png' : format === 'JPG' || format === 'JPEG' ? 'image/jpeg' : undefined
  return artworkFromDeclaredOrSniffedType(declaredMimeType, bytes.slice(cursor, end))
}

/** Reads an MP3 ID3v2.2/2.3/2.4 tag looking for the first embedded picture frame. */
function extractId3v2Artwork(bytes: Uint8Array): ExtractedAudioArtwork | undefined {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return undefined // "ID3"
  const majorVersion = bytes[3]
  const flags = bytes[5]
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tagSize = readSyncSafeUint32(view, 6)
  const tagEnd = Math.min(bytes.length, 10 + tagSize)
  let offset = 10
  if ((flags & 0x40) !== 0 && offset + 4 <= tagEnd) {
    const extendedHeaderSize = majorVersion >= 4 ? readSyncSafeUint32(view, offset) : view.getUint32(offset, false)
    if (extendedHeaderSize > 0 && extendedHeaderSize < tagSize) offset += extendedHeaderSize
  }
  while (offset + 6 <= tagEnd) {
    if (majorVersion === 2) {
      const id = decodeLatin1(bytes, offset, offset + 3)
      const size = (bytes[offset + 3] << 16) | (bytes[offset + 4] << 8) | bytes[offset + 5]
      const frameStart = offset + 6
      if (size <= 0 || frameStart + size > tagEnd) break
      if (id === 'PIC') {
        const artwork = parseId3PicFrame(bytes, frameStart, frameStart + size)
        if (artwork) return artwork
      }
      offset = frameStart + size
    } else {
      if (offset + 10 > tagEnd) break
      const id = decodeLatin1(bytes, offset, offset + 4)
      if (!/^[A-Z0-9]{4}$/.test(id)) break // reached padding / corrupt frame id
      const size = majorVersion >= 4 ? readSyncSafeUint32(view, offset + 4) : view.getUint32(offset + 4, false)
      const frameStart = offset + 10
      if (size <= 0 || frameStart + size > tagEnd) break
      if (id === 'APIC') {
        const artwork = parseId3ApicFrame(bytes, frameStart, frameStart + size)
        if (artwork) return artwork
      }
      offset = frameStart + size
    }
  }
  return undefined
}

interface Mp4Box {
  readonly type: string
  readonly end: number
  readonly bodyStart: number
}

function readMp4Boxes(bytes: Uint8Array, rangeStart: number, rangeEnd: number): readonly Mp4Box[] {
  const boxes: Mp4Box[] = []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = rangeStart
  while (offset + 8 <= rangeEnd) {
    const size32 = view.getUint32(offset, false)
    const type = decodeLatin1(bytes, offset + 4, offset + 8)
    let bodyStart = offset + 8
    let boxSize = size32
    if (size32 === 1) {
      if (offset + 16 > rangeEnd) break
      boxSize = view.getUint32(offset + 8, false) * 2 ** 32 + view.getUint32(offset + 12, false)
      bodyStart = offset + 16
    } else if (size32 === 0) {
      boxSize = rangeEnd - offset
    }
    if (boxSize < 8 || offset + boxSize > rangeEnd) break
    boxes.push({ type, end: offset + boxSize, bodyStart })
    offset += boxSize
  }
  return boxes
}

/** Reads the first `covr` atom's `data` payload out of an MP4/M4A `moov/udta/meta/ilst` chain. */
function extractMp4Artwork(bytes: Uint8Array): ExtractedAudioArtwork | undefined {
  const moov = readMp4Boxes(bytes, 0, bytes.length).find((box) => box.type === 'moov')
  if (!moov) return undefined
  const udta = readMp4Boxes(bytes, moov.bodyStart, moov.end).find((box) => box.type === 'udta')
  if (!udta) return undefined
  const meta = readMp4Boxes(bytes, udta.bodyStart, udta.end).find((box) => box.type === 'meta')
  if (!meta) return undefined
  // 'meta' is a full box here (unlike a plain container box): a 4-byte
  // version+flags header precedes its children.
  const ilst = readMp4Boxes(bytes, meta.bodyStart + 4, meta.end).find((box) => box.type === 'ilst')
  if (!ilst) return undefined
  const covr = readMp4Boxes(bytes, ilst.bodyStart, ilst.end).find((box) => box.type === 'covr')
  if (!covr) return undefined
  const data = readMp4Boxes(bytes, covr.bodyStart, covr.end).find((box) => box.type === 'data')
  if (!data || data.bodyStart + 8 > data.end) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const dataType = view.getUint32(data.bodyStart, false)
  const declaredMimeType = dataType === 14 ? 'image/png' : dataType === 13 ? 'image/jpeg' : undefined
  return artworkFromDeclaredOrSniffedType(declaredMimeType, bytes.slice(data.bodyStart + 8, data.end))
}

/**
 * Extracts embedded cover artwork from an audio file's own metadata, if any.
 * Supports MP3 (ID3v2 APIC/PIC) and M4A/MP4 (`covr`). Any other format, or
 * any file with no embedded picture, safely resolves to `undefined` — this
 * is a convenience default only; it never blocks or fails the underlying
 * audio upload.
 */
export async function extractEmbeddedAudioArtwork(file: File): Promise<ExtractedAudioArtwork | undefined> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    return extractId3v2Artwork(bytes) ?? extractMp4Artwork(bytes)
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Embedded title / track-number extraction (product-neutral). Reads MP3
// ID3v2 TIT2/TRCK (or the ID3v2.2 3-letter TT2/TRK) text frames and MP4/M4A
// `©nam`/`trkn` atoms, reusing the exact frame/box readers above. Used only
// as a convenience default for bulk track import staging; every value stays
// user-editable afterward and no failure here ever blocks a selected file.
// ---------------------------------------------------------------------------

export interface ExtractedAudioTags {
  readonly title?: string
  readonly trackNumber?: number
}

/** Decodes one ID3v2 text-information frame body (leading encoding byte + text). */
function decodeId3TextFrame(bytes: Uint8Array, start: number, end: number): string | undefined {
  if (start >= end) return undefined
  const encoding = bytes[start]
  const textStart = start + 1
  if (textStart > end) return undefined
  try {
    let decoded: string
    if (encoding === 0) {
      decoded = decodeLatin1(bytes, textStart, findNullTerminator(bytes, textStart, false))
    } else if (encoding === 3) {
      decoded = new TextDecoder('utf-8').decode(bytes.slice(textStart, end))
    } else if (encoding === 2) {
      decoded = new TextDecoder('utf-16be').decode(bytes.slice(textStart, end))
    } else {
      const hasBigEndianBom = textStart + 2 <= end && bytes[textStart] === 0xfe && bytes[textStart + 1] === 0xff
      const hasLittleEndianBom = textStart + 2 <= end && bytes[textStart] === 0xff && bytes[textStart + 1] === 0xfe
      const bomSkip = hasBigEndianBom || hasLittleEndianBom ? 2 : 0
      decoded = new TextDecoder(hasBigEndianBom ? 'utf-16be' : 'utf-16le').decode(bytes.slice(textStart + bomSkip, end))
    }
    const cleaned = decoded.replace(/\0+$/, '').trim()
    return cleaned || undefined
  } catch {
    return undefined
  }
}

function parseId3TrackNumber(text: string | undefined): number | undefined {
  if (!text) return undefined
  const match = text.match(/^\s*(\d{1,4})/)
  if (!match) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) && value > 0 ? value : undefined
}

/** Reads an MP3 ID3v2.2/2.3/2.4 tag looking for the title and track-number text frames. */
function extractId3v2Tags(bytes: Uint8Array): ExtractedAudioTags {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return {}
  const majorVersion = bytes[3]
  const flags = bytes[5]
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tagSize = readSyncSafeUint32(view, 6)
  const tagEnd = Math.min(bytes.length, 10 + tagSize)
  let offset = 10
  if ((flags & 0x40) !== 0 && offset + 4 <= tagEnd) {
    const extendedHeaderSize = majorVersion >= 4 ? readSyncSafeUint32(view, offset) : view.getUint32(offset, false)
    if (extendedHeaderSize > 0 && extendedHeaderSize < tagSize) offset += extendedHeaderSize
  }
  let title: string | undefined
  let trackNumber: number | undefined
  while (offset + 6 <= tagEnd && (title === undefined || trackNumber === undefined)) {
    if (majorVersion === 2) {
      const id = decodeLatin1(bytes, offset, offset + 3)
      const size = (bytes[offset + 3] << 16) | (bytes[offset + 4] << 8) | bytes[offset + 5]
      const frameStart = offset + 6
      if (size <= 0 || frameStart + size > tagEnd) break
      if (id === 'TT2') title = title ?? decodeId3TextFrame(bytes, frameStart, frameStart + size)
      if (id === 'TRK') trackNumber = trackNumber ?? parseId3TrackNumber(decodeId3TextFrame(bytes, frameStart, frameStart + size))
      offset = frameStart + size
    } else {
      if (offset + 10 > tagEnd) break
      const id = decodeLatin1(bytes, offset, offset + 4)
      if (!/^[A-Z0-9]{4}$/.test(id)) break // reached padding / corrupt frame id
      const size = majorVersion >= 4 ? readSyncSafeUint32(view, offset + 4) : view.getUint32(offset + 4, false)
      const frameStart = offset + 10
      if (size <= 0 || frameStart + size > tagEnd) break
      if (id === 'TIT2') title = title ?? decodeId3TextFrame(bytes, frameStart, frameStart + size)
      if (id === 'TRCK') trackNumber = trackNumber ?? parseId3TrackNumber(decodeId3TextFrame(bytes, frameStart, frameStart + size))
      offset = frameStart + size
    }
  }
  return { title, trackNumber }
}

/** Reads the `©nam`/`trkn` atoms out of an MP4/M4A `moov/udta/meta/ilst` chain. */
function extractMp4Tags(bytes: Uint8Array): ExtractedAudioTags {
  const moov = readMp4Boxes(bytes, 0, bytes.length).find((box) => box.type === 'moov')
  if (!moov) return {}
  const udta = readMp4Boxes(bytes, moov.bodyStart, moov.end).find((box) => box.type === 'udta')
  if (!udta) return {}
  const meta = readMp4Boxes(bytes, udta.bodyStart, udta.end).find((box) => box.type === 'meta')
  if (!meta) return {}
  const ilst = readMp4Boxes(bytes, meta.bodyStart + 4, meta.end).find((box) => box.type === 'ilst')
  if (!ilst) return {}
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const children = readMp4Boxes(bytes, ilst.bodyStart, ilst.end)

  let title: string | undefined
  const nameAtom = children.find((box) => box.type === '©nam')
  if (nameAtom) {
    const data = readMp4Boxes(bytes, nameAtom.bodyStart, nameAtom.end).find((box) => box.type === 'data')
    if (data && data.bodyStart + 8 <= data.end) {
      try {
        title = new TextDecoder('utf-8').decode(bytes.slice(data.bodyStart + 8, data.end)).trim() || undefined
      } catch { /* leave undefined */ }
    }
  }

  let trackNumber: number | undefined
  const trknAtom = children.find((box) => box.type === 'trkn')
  if (trknAtom) {
    const data = readMp4Boxes(bytes, trknAtom.bodyStart, trknAtom.end).find((box) => box.type === 'data')
    if (data && data.bodyStart + 8 + 4 <= data.end) {
      const value = view.getUint16(data.bodyStart + 8 + 2, false)
      trackNumber = value > 0 ? value : undefined
    }
  }

  return { title, trackNumber }
}

/**
 * Extracts embedded title/track-number tags from an audio file's own
 * metadata, if any. Supports MP3 (ID3v2 TIT2/TRCK, or the ID3v2.2 TT2/TRK)
 * and M4A/MP4 (`©nam`/`trkn`). Any other format, or a file with no matching
 * tag, safely resolves to an empty object — a convenience default only; it
 * never blocks or fails the underlying audio upload.
 */
export async function extractEmbeddedAudioTags(file: File): Promise<ExtractedAudioTags> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const id3 = extractId3v2Tags(bytes)
    if (id3.title !== undefined || id3.trackNumber !== undefined) return id3
    return extractMp4Tags(bytes)
  } catch {
    return {}
  }
}
