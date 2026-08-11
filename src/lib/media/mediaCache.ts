interface SignedUrlCacheEntry {
  readonly url: string
  readonly expiresAt: number
}

const signedUrls = new Map<string, SignedUrlCacheEntry>()
const inflight = new Map<string, Promise<string>>()
const generations = new Map<string, number>()

export function readSignedMediaUrl(path: string): string | undefined {
  const entry = signedUrls.get(path)
  if (!entry || entry.expiresAt <= Date.now()) {
    signedUrls.delete(path)
    return undefined
  }
  return entry.url
}

export function cacheSignedMediaUrl(path: string, url: string, lifetimeMs: number): void {
  signedUrls.set(path, { url, expiresAt: Date.now() + lifetimeMs })
}

export function readMediaInflight(path: string): Promise<string> | undefined {
  return inflight.get(path)
}

export function cacheMediaInflight(path: string, promise: Promise<string>): void {
  inflight.set(path, promise)
  const clear = () => {
    if (inflight.get(path) === promise) inflight.delete(path)
  }
  void promise.then(clear, clear)
}

export function readSignedMediaGeneration(path: string): number {
  return generations.get(path) ?? 0
}

/**
 * Revokes only this tab's cached capability for one immutable object path.
 * The generation guard prevents a sign request that began before invalidation
 * from repopulating the cache after article media has been attached/replaced.
 */
export function invalidateSignedMediaPath(path: string): void {
  signedUrls.delete(path)
  inflight.delete(path)
  generations.set(path, readSignedMediaGeneration(path) + 1)
}

export function clearSharedMediaCache(): void {
  const paths = new Set([...signedUrls.keys(), ...inflight.keys()])
  for (const path of paths) invalidateSignedMediaPath(path)
}
