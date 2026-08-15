export interface NewsBroadcastTimingSample {
  readonly serverNow: string
  readonly requestStartedAt: number
  readonly responseReceivedAt: number
  readonly current: {
    readonly startedAt: string
    readonly endsAt: string
    readonly durationMs: number
  } | null
}

export interface NewsBroadcastStationAnchor {
  readonly serverNowAtReceiveMs: number
  readonly responseReceivedAt: number
  readonly clipStartedAtMs: number
  readonly clipEndsAtMs: number
}

export function newsBroadcastAnchor(
  sample: NewsBroadcastTimingSample,
): NewsBroadcastStationAnchor | null {
  if (!sample.current) return null
  const rttMs = Math.max(0, sample.responseReceivedAt - sample.requestStartedAt)
  return {
    serverNowAtReceiveMs: Date.parse(sample.serverNow) + rttMs / 2,
    responseReceivedAt: sample.responseReceivedAt,
    clipStartedAtMs: Date.parse(sample.current.startedAt),
    clipEndsAtMs: Date.parse(sample.current.endsAt),
  }
}

export function estimatedNewsBroadcastServerNow(
  anchor: NewsBroadcastStationAnchor,
): number {
  return anchor.serverNowAtReceiveMs
    + Math.max(0, performance.now() - anchor.responseReceivedAt)
}

export function expectedNewsBroadcastOffsetSeconds(
  anchor: NewsBroadcastStationAnchor,
  durationMs: number,
): number {
  const raw = (estimatedNewsBroadcastServerNow(anchor) - anchor.clipStartedAtMs) / 1000
  return Math.min(Math.max(raw, 0), Math.max(0, durationMs / 1000 - 0.08))
}

export function newsBroadcastSignedUrlTtlSeconds(
  anchor: NewsBroadcastStationAnchor,
  minimumSeconds: number,
  maximumSeconds: number,
  graceSeconds: number,
): number {
  const remainingSeconds = Math.max(
    0,
    anchor.clipEndsAtMs - estimatedNewsBroadcastServerNow(anchor),
  ) / 1000
  return Math.min(
    maximumSeconds,
    Math.max(minimumSeconds, Math.ceil(remainingSeconds + graceSeconds)),
  )
}
