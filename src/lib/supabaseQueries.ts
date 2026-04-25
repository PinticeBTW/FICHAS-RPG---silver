type SupabaseFetchMeta = {
  functionName: string
  table: string
}

type SupabaseFetchOptions = {
  cacheMs?: number
}

const inFlightFetches = new Map<string, Promise<unknown>>()
const memoryCache = new Map<string, { expiresAt: number; value: unknown }>()

export function logSupabaseFetch({ functionName, table }: SupabaseFetchMeta) {
  if (!import.meta.env.DEV) {
    return
  }

  console.debug('[SUPABASE_FETCH]', {
    functionName,
    table,
    timestamp: new Date().toISOString(),
  })
}

export async function runSupabaseFetch<T>(
  key: string,
  meta: SupabaseFetchMeta,
  fetcher: () => T | PromiseLike<T>,
  options: SupabaseFetchOptions = {},
): Promise<T> {
  const now = Date.now()
  const cached = memoryCache.get(key)

  if (cached && cached.expiresAt > now) {
    return cached.value as T
  }

  const inFlight = inFlightFetches.get(key)

  if (inFlight) {
    return inFlight as Promise<T>
  }

  logSupabaseFetch(meta)

  const promise = Promise.resolve(fetcher())
    .then((value) => {
      if (options.cacheMs && options.cacheMs > 0) {
        memoryCache.set(key, {
          expiresAt: Date.now() + options.cacheMs,
          value,
        })
      }

      return value
    })
    .finally(() => {
      inFlightFetches.delete(key)
    })

  inFlightFetches.set(key, promise)
  return promise
}

export function clearSupabaseFetchCache(keyPrefix?: string) {
  if (!keyPrefix) {
    memoryCache.clear()
    return
  }

  for (const key of memoryCache.keys()) {
    if (key.startsWith(keyPrefix)) {
      memoryCache.delete(key)
    }
  }
}
