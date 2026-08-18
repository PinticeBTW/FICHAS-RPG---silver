import {
  SHARED_MEDIA_REFERENCE_PREFIX,
  type SharedMediaReferenceV1,
  type SharedMediaVariant,
} from './mediaTypes'

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = '='.repeat((4 - normalized.length % 4) % 4)
  const binary = atob(normalized + padding)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function isVariant(value: unknown): value is SharedMediaVariant {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return (
    typeof row.path === 'string'
    && row.path.length > 0
    && row.path.length <= 1024
    && !row.path.startsWith('/')
    && !row.path.includes('..')
    && typeof row.mimeType === 'string'
    && row.mimeType.startsWith('image/')
    && Number.isSafeInteger(row.width)
    && Number(row.width) > 0
    && Number.isSafeInteger(row.height)
    && Number(row.height) > 0
    && Number.isSafeInteger(row.byteSize)
    && Number(row.byteSize) > 0
  )
}

export function createSharedMediaReference(reference: SharedMediaReferenceV1): string {
  const compact = {
    v: 1,
    h: reference.hash,
    d: {
      p: reference.display.path,
      m: reference.display.mimeType,
      w: reference.display.width,
      h: reference.display.height,
      b: reference.display.byteSize,
    },
    ...(reference.thumbnail ? {
      t: {
        p: reference.thumbnail.path,
        m: reference.thumbnail.mimeType,
        w: reference.thumbnail.width,
        h: reference.thumbnail.height,
        b: reference.thumbnail.byteSize,
      },
    } : {}),
  }
  return `${SHARED_MEDIA_REFERENCE_PREFIX}${bytesToBase64Url(new TextEncoder().encode(JSON.stringify(compact)))}`
}

export function parseSharedMediaReference(value: string | null | undefined): SharedMediaReferenceV1 | null {
  if (!value?.startsWith(SHARED_MEDIA_REFERENCE_PREFIX)) return null

  try {
    const decoded = new TextDecoder().decode(base64UrlToBytes(value.slice(SHARED_MEDIA_REFERENCE_PREFIX.length)))
    const raw = JSON.parse(decoded) as Record<string, unknown>
    const displayRaw = raw.d as Record<string, unknown>
    const thumbnailRaw = raw.t as Record<string, unknown> | undefined
    const display = {
      path: displayRaw?.p,
      mimeType: displayRaw?.m,
      width: displayRaw?.w,
      height: displayRaw?.h,
      byteSize: displayRaw?.b,
    }
    const thumbnail = thumbnailRaw ? {
      path: thumbnailRaw.p,
      mimeType: thumbnailRaw.m,
      width: thumbnailRaw.w,
      height: thumbnailRaw.h,
      byteSize: thumbnailRaw.b,
    } : undefined

    if (raw.v !== 1 || typeof raw.h !== 'string' || !/^[a-f0-9]{16,64}$/i.test(raw.h) || !isVariant(display)) {
      return null
    }
    if (thumbnail && !isVariant(thumbnail)) return null
    return { version: 1, hash: raw.h, display, ...(thumbnail ? { thumbnail } : {}) }
  } catch {
    return null
  }
}

export function isSharedMediaReference(value: string | null | undefined): boolean {
  return parseSharedMediaReference(value) !== null
}

