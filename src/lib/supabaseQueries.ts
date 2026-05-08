type SupabaseFetchMeta = {
  functionName: string
  table: string
}

type SupabaseFetchOptions = {
  cacheMs?: number
  maxRetries?: number
  retryDelayMs?: number
}

const inFlightFetches = new Map<string, Promise<unknown>>()
const memoryCache = new Map<string, { expiresAt: number; value: unknown }>()

function getApproxJsonByteSize(value: unknown) {
  try {
    return new Blob([JSON.stringify(value)]).size
  } catch {
    return 0
  }
}

function countRows(value: unknown) {
  if (Array.isArray(value)) {
    return value.length
  }

  if (!value || typeof value !== 'object') {
    return undefined
  }

  const candidate = value as { data?: unknown }

  if (Array.isArray(candidate.data)) {
    return candidate.data.length
  }

  if (candidate.data && typeof candidate.data === 'object') {
    return 1
  }

  return undefined
}

function inspectPayload(value: unknown) {
  let includesFieldData = false
  let includesDataImage = false

  const visit = (entry: unknown) => {
    if (includesFieldData && includesDataImage) {
      return
    }

    if (typeof entry === 'string') {
      if (entry.includes('data:image')) {
        includesDataImage = true
      }
      return
    }

    if (!entry || typeof entry !== 'object') {
      return
    }

    if (Array.isArray(entry)) {
      for (const item of entry) {
        visit(item)
      }
      return
    }

    for (const [key, item] of Object.entries(entry as Record<string, unknown>)) {
      if (key === 'field_data' || key === 'fieldData') {
        includesFieldData = true
      }
      visit(item)
    }
  }

  visit(value)

  return {
    includesFieldData,
    includesDataImage,
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function extractStatus(error: unknown) {
  if (!error || typeof error !== 'object') {
    return null
  }

  const candidate = error as {
    status?: number
    statusCode?: number
    code?: string
    message?: string
  }

  if (typeof candidate.status === 'number') {
    return candidate.status
  }

  if (typeof candidate.statusCode === 'number') {
    return candidate.statusCode
  }

  if (typeof candidate.code === 'string' && /^\d{3}$/.test(candidate.code)) {
    return Number(candidate.code)
  }

  if (typeof candidate.message === 'string') {
    const match = candidate.message.match(/\b(5\d\d)\b/)
    if (match) {
      return Number(match[1])
    }
  }

  return null
}

function isTransientSupabaseError(error: unknown) {
  const status = extractStatus(error)

  if (status && [408, 425, 429, 500, 502, 503, 504, 521, 522, 524].includes(status)) {
    return true
  }

  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : typeof error === 'string'
        ? error.toLowerCase()
        : ''

  return (
    message.includes('failed to fetch') ||
    message.includes('fetch failed') ||
    message.includes('network') ||
    message.includes('service unavailable') ||
    message.includes('temporarily unavailable') ||
    message.includes('timeout') ||
    message.includes('cors')
  )
}

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

export function logSupabasePayload(
  meta: SupabaseFetchMeta & { operation?: string },
  payload: unknown,
  startedAt?: number,
) {
  if (!import.meta.env.DEV) {
    return
  }

  const inspection = inspectPayload(payload)

  console.debug('[SUPABASE_PAYLOAD]', {
    operation: meta.operation ?? meta.functionName,
    table: meta.table,
    bytes: getApproxJsonByteSize(payload),
    rows: countRows(payload),
    durationMs:
      typeof startedAt === 'number' ? Math.round(performance.now() - startedAt) : undefined,
    includesFieldData: inspection.includesFieldData,
    includesDataImage: inspection.includesDataImage,
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

  const maxRetries = Math.max(0, options.maxRetries ?? 2)
  const baseRetryDelayMs = Math.max(100, options.retryDelayMs ?? 450)

  const promise = (async () => {
    let attempt = 0

    while (true) {
      try {
        const startedAt = performance.now()
        const value = await Promise.resolve(fetcher())
        logSupabasePayload(meta, value, startedAt)

        if (options.cacheMs && options.cacheMs > 0) {
          memoryCache.set(key, {
            expiresAt: Date.now() + options.cacheMs,
            value,
          })
        }

        return value
      } catch (error) {
        if (!isTransientSupabaseError(error) || attempt >= maxRetries) {
          throw error
        }

        const waitMs = baseRetryDelayMs * Math.pow(2, attempt)
        if (import.meta.env.DEV) {
          console.debug('[SUPABASE_FETCH] retry', {
            functionName: meta.functionName,
            table: meta.table,
            attempt: attempt + 1,
            waitMs,
          })
        }

        attempt += 1
        await delay(waitMs)
      }
    }
  })()
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
