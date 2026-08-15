import { supabase, SUPABASE_CONFIG_ERROR } from '../supabase'
import { optimizeImage } from './imageOptimization'
import {
  cacheMediaInflight,
  cacheSignedMediaUrl,
  invalidateSignedMediaPath,
  readMediaInflight,
  readSignedMediaGeneration,
  readSignedMediaUrl,
} from './mediaCache'
import { createSharedMediaReference, parseSharedMediaReference } from './mediaReference'
import {
  SHARED_MEDIA_BUCKET,
  SHARED_MEDIA_IMMUTABLE_CACHE_CONTROL,
  SHARED_MEDIA_REFERENCE_PREFIX,
  type MediaOptimizationProfile,
  type SharedMediaReferenceV1,
  type SharedMediaScope,
} from './mediaTypes'

const SIGNED_URL_SECONDS = 60 * 60
const SIGNED_URL_CACHE_MS = 55 * 60 * 1000
// Draft/public lifecycle can change during a live newsroom session. Keep news
// capability URLs short-lived so a previously issued URL ages out promptly
// after an article is returned to Draft; every fresh sign is still server-RLS checked.
const NVN_SIGNED_URL_SECONDS = 5 * 60
const NVN_SIGNED_URL_CACHE_MS = 4 * 60 * 1000
const SIGNED_URL_REQUEST_TIMEOUT_MS = 15_000

export type SharedMediaRequestedVariant = 'display' | 'thumbnail'

function mediaResolutionError(sourceError: unknown, fallbackMessage: string): Error {
  if (sourceError instanceof Error) return sourceError
  if (sourceError && typeof sourceError === 'object') {
    const message = (sourceError as { readonly message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return new Error(message)
  }
  return new Error(fallbackMessage)
}

function signedUrlPolicy(path: string) {
  return path.startsWith('nvn-article/') || path.startsWith('altara-news-article/')
    ? { seconds: NVN_SIGNED_URL_SECONDS, cacheMs: NVN_SIGNED_URL_CACHE_MS }
    : { seconds: SIGNED_URL_SECONDS, cacheMs: SIGNED_URL_CACHE_MS }
}

function client() {
  if (!supabase) throw new Error(SUPABASE_CONFIG_ERROR)
  return supabase
}

async function withSignedUrlTimeout<T>(
  request: PromiseLike<T>,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Secure image authorization timed out.'))
    }, SIGNED_URL_REQUEST_TIMEOUT_MS)
  })
  try {
    return await Promise.race([Promise.resolve(request), timeout])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

function safeSegment(value: string, label: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(normalized)) throw new Error(`Invalid media ${label}.`)
  return normalized
}

function variantPath(scope: SharedMediaScope, hash: string, filename: string): string {
  return [
    safeSegment(scope.subjectKind, 'subject kind'),
    safeSegment(scope.subjectId, 'subject id'),
    safeSegment(scope.mediaKind, 'kind'),
    safeSegment(scope.slot ?? 'primary', 'slot'),
    safeSegment(hash.slice(0, 32), 'version'),
    filename,
  ].join('/')
}

function requestSignedUrl(
  path: string,
  seconds: number,
) {
  try {
    return client().storage.from(SHARED_MEDIA_BUCKET).createSignedUrl(path, seconds)
  } catch (error) {
    throw mediaResolutionError(error, 'Secure image authorization could not be requested.')
  }
}

function requestSignedUrls(
  paths: string[],
  seconds: number,
) {
  try {
    return client().storage.from(SHARED_MEDIA_BUCKET).createSignedUrls(paths, seconds)
  } catch (error) {
    throw mediaResolutionError(error, 'Secure image authorization could not be requested.')
  }
}

async function signPath(path: string): Promise<string> {
  const cached = readSignedMediaUrl(path)
  if (cached) return cached
  const active = readMediaInflight(path)
  if (active) {
    return active.catch((error: unknown) => {
      throw mediaResolutionError(error, 'Secure image authorization failed.')
    })
  }

  const policy = signedUrlPolicy(path)
  const requestGeneration = readSignedMediaGeneration(path)
  const storageRequest = requestSignedUrl(path, policy.seconds)
  const request = withSignedUrlTimeout(storageRequest)
    .then(({ data, error }) => {
      if (error) {
        throw mediaResolutionError(error, 'Secure image authorization failed.')
      }
      if (!data?.signedUrl) {
        throw new Error('Storage returned no signed URL.')
      }
      if (readSignedMediaGeneration(path) !== requestGeneration) {
        throw new Error('Image authorization changed during signing.')
      }
      cacheSignedMediaUrl(path, data.signedUrl, policy.cacheMs)
      return data.signedUrl
    })
    .catch((error: unknown) => {
      throw mediaResolutionError(error, 'Secure image authorization failed.')
    })
  cacheMediaInflight(path, request)
  return request
}

export async function resolveSharedMediaUrl(
  value: string | null | undefined,
  variant: SharedMediaRequestedVariant = 'display',
): Promise<string | undefined> {
  if (!value) return undefined
  const reference = parseSharedMediaReference(value)
  if (!reference && value.startsWith(SHARED_MEDIA_REFERENCE_PREFIX)) {
    throw new Error('The shared-media descriptor could not be parsed.')
  }
  if (!reference) return value
  const selected = variant === 'thumbnail' ? reference.thumbnail ?? reference.display : reference.display
  return signPath(selected.path)
}

/** Precisely expires the display/thumbnail capabilities represented by one descriptor. */
export function invalidateSharedMediaReference(
  value: string | null | undefined,
): void {
  const reference = parseSharedMediaReference(value)
  if (!reference) return
  const paths = new Set([
    reference.display.path,
    ...(reference.thumbnail ? [reference.thumbnail.path] : []),
  ])
  for (const path of paths) invalidateSignedMediaPath(path)
}

/** Resolves a list in one Storage request; useful for directory/feed rows. */
export async function resolveSharedMediaUrls(
  values: readonly (string | null | undefined)[],
  variant: SharedMediaRequestedVariant = 'display',
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const pending = new Map<string, string[]>()
  const requests: Array<{
    readonly path: string
    readonly values: readonly string[]
    readonly request: Promise<string>
  }> = []
  for (const value of values) {
    if (!value) continue
    const reference = parseSharedMediaReference(value)
    if (!reference && value.startsWith(SHARED_MEDIA_REFERENCE_PREFIX)) {
      throw new Error('The shared-media descriptor could not be parsed.')
    }
    if (!reference) {
      result.set(value, value)
      continue
    }
    const path = (variant === 'thumbnail' ? reference.thumbnail ?? reference.display : reference.display).path
    const cached = readSignedMediaUrl(path)
    if (cached) result.set(value, cached)
    else {
      const active = readMediaInflight(path)
      if (active) requests.push({ path, values: [value], request: active })
      else pending.set(path, [...(pending.get(path) ?? []), value])
    }
  }

  const groups = new Map<string, { seconds: number; cacheMs: number; paths: string[] }>()
  for (const path of pending.keys()) {
    const policy = signedUrlPolicy(path)
    const key = `${policy.seconds}:${policy.cacheMs}`
    const group = groups.get(key) ?? { ...policy, paths: [] }
    group.paths.push(path)
    groups.set(key, group)
  }
  for (const group of groups.values()) {
    const requestGenerations = new Map(
      group.paths.map((path) => [path, readSignedMediaGeneration(path)]),
    )
    let storageBatchRequest: ReturnType<typeof requestSignedUrls>
    try {
      storageBatchRequest = requestSignedUrls(group.paths, group.seconds)
    } catch (error) {
      for (const path of group.paths) {
        const failedRequest = Promise.reject(mediaResolutionError(
          error,
          'Secure image authorization could not be requested.',
        ))
        cacheMediaInflight(path, failedRequest)
        requests.push({ path, values: pending.get(path) ?? [], request: failedRequest })
      }
      continue
    }
    const batchRequest = withSignedUrlTimeout(storageBatchRequest)
    for (const path of group.paths) {
      const pathRequest = batchRequest.then(({ data, error }) => {
        if (error) {
          throw mediaResolutionError(error, 'Secure image authorization failed.')
        }
        const row = data?.find((candidate) => candidate.path === path)
        if (!row?.signedUrl || row.error) {
          throw mediaResolutionError(
            row?.error,
            'Storage returned no signed URL for this object path.',
          )
        }
        if (readSignedMediaGeneration(path) !== requestGenerations.get(path)) {
          throw new Error('Image authorization changed during signing.')
        }
        cacheSignedMediaUrl(path, row.signedUrl, group.cacheMs)
        return row.signedUrl
      }).catch((error: unknown) => {
        throw mediaResolutionError(error, 'Secure image authorization failed.')
      })
      cacheMediaInflight(path, pathRequest)
      requests.push({
        path,
        values: pending.get(path) ?? [],
        request: pathRequest,
      })
    }
  }

  await Promise.all(requests.map(async ({ values: originals, request }) => {
    const url = await request
    for (const original of originals) result.set(original, url)
  }))
  return result
}

/** Optional cache warming: callers never wait on Storage signing to render authoritative data. */
export function prewarmSharedMediaUrls(
  values: readonly (string | null | undefined)[],
  variant: SharedMediaRequestedVariant = 'display',
): void {
  void resolveSharedMediaUrls(values, variant).catch(() => undefined)
}

export async function uploadSharedImage(
  scope: SharedMediaScope,
  file: Blob,
  profile: MediaOptimizationProfile,
): Promise<{ readonly reference: string; readonly media: SharedMediaReferenceV1; readonly savedBytes: number }> {
  const optimized = await optimizeImage(file, profile)
  const storage = client().storage.from(SHARED_MEDIA_BUCKET)
  const uploadedPaths: string[] = []
  try {
    const mediaVariants = await Promise.all(optimized.variants.map(async (variant) => {
      const path = variantPath(scope, optimized.contentHash, `${variant.name}.${variant.extension}`)
      const { error } = await storage.upload(path, variant.blob, {
        cacheControl: SHARED_MEDIA_IMMUTABLE_CACHE_CONTROL,
        contentType: variant.mimeType,
        upsert: false,
      })
      if (error && !/already exists|duplicate/i.test(error.message)) throw error
      if (!error) uploadedPaths.push(path)
      return {
        name: variant.name,
        path,
        mimeType: variant.mimeType,
        width: variant.width,
        height: variant.height,
        byteSize: variant.blob.size,
      }
    }))
    const display = mediaVariants.find((entry) => entry.name === 'display')
    const thumbnail = mediaVariants.find((entry) => entry.name === 'thumbnail')
    if (!display) throw new Error('The optimized image has no display variant.')
    const media: SharedMediaReferenceV1 = {
      version: 1,
      hash: optimized.contentHash,
      display,
      ...(thumbnail ? { thumbnail } : {}),
    }
    return {
      reference: createSharedMediaReference(media),
      media,
      savedBytes: Math.max(0, optimized.originalByteSize - mediaVariants.reduce((sum, entry) => sum + entry.byteSize, 0)),
    }
  } catch (error) {
    if (uploadedPaths.length) await storage.remove(uploadedPaths).catch(() => undefined)
    throw new Error(`Image upload failed: ${error instanceof Error ? error.message : 'unknown error'}`)
  }
}
