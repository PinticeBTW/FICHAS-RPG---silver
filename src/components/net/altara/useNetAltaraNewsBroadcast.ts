import { useCallback, useEffect, useRef, useState } from 'react'

import {
  fetchNetAltaraNewsBroadcastTuneState,
  signNetAltaraNewsCurrentBroadcastObject,
} from '../../../lib/netAltaraNewsBroadcastService'
import {
  NET_ALTARA_NEWS_BROADCAST_SIGNED_URL_GRACE_SECONDS,
  NET_ALTARA_NEWS_BROADCAST_SIGNED_URL_MAX_TTL_SECONDS,
  NET_ALTARA_NEWS_BROADCAST_SIGNED_URL_MIN_TTL_SECONDS,
  NetAltaraNewsBroadcastError,
  type NetAltaraNewsBroadcastTuneSample,
  type NetAltaraNewsBroadcastTuneState,
} from '../../../lib/netAltaraNewsBroadcastTypes'
import {
  estimatedNewsBroadcastServerNow,
  expectedNewsBroadcastOffsetSeconds,
  newsBroadcastAnchor,
  newsBroadcastSignedUrlTtlSeconds,
  type NewsBroadcastStationAnchor,
} from '../../../lib/newsBroadcastClock'

const VOLUME_KEY = 'net:altara-news-broadcast:volume:v1'
const MUTED_KEY = 'net:altara-news-broadcast:muted:v1'
const AUDIO_READY_TIMEOUT_MS = 15_000
const DRIFT_CHECK_MS = 5_000
interface BroadcastSyncOptions {
  readonly boundaryRecovery?: boolean
}

export type AltaraNewsBroadcastPhase =
  | 'synchronizing' | 'off-air' | 'ready-to-tune' | 'loading'
  | 'on-air' | 'breaking' | 'error'

export interface AltaraNewsBroadcastController {
  readonly phase: AltaraNewsBroadcastPhase
  readonly tuneState: NetAltaraNewsBroadcastTuneState | null
  readonly tuned: boolean
  readonly muted: boolean
  readonly volume: number
  readonly syncing: boolean
  readonly error: string | null
  readonly tuneIn: () => void
  readonly tuneOut: () => void
  readonly retry: () => void
  readonly setMuted: (muted: boolean) => void
  readonly setVolume: (volume: number) => void
}

function storedVolume(): number {
  const parsed = Number(window.localStorage.getItem(VOLUME_KEY))
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.72
}

function anchor(sample: NetAltaraNewsBroadcastTuneSample): NewsBroadcastStationAnchor | null {
  return newsBroadcastAnchor({
    serverNow: sample.state.serverNow,
    requestStartedAt: sample.requestStartedAt,
    responseReceivedAt: sample.responseReceivedAt,
    current: sample.state.current,
  })
}

function friendlyError(error: unknown): string {
  if (error instanceof NetAltaraNewsBroadcastError) return error.message
  if (error instanceof Error && error.name === 'NotAllowedError') {
    return 'Press Tune In to allow live ALTARA NEWS audio.'
  }
  return error instanceof Error ? error.message : 'The global ALTARA NEWS carrier could not be opened.'
}

function waitForMetadata(audio: HTMLAudioElement): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      audio.removeEventListener('loadedmetadata', loaded)
      audio.removeEventListener('error', failed)
      if (error) reject(error)
      else resolve()
    }
    const loaded = () => finish()
    const failed = () => finish(new Error('The signed ALTARA NEWS audio object could not be loaded.'))
    const timer = window.setTimeout(
      () => finish(new Error('The ALTARA NEWS carrier took too long to load.')),
      AUDIO_READY_TIMEOUT_MS,
    )
    audio.addEventListener('loadedmetadata', loaded)
    audio.addEventListener('error', failed)
    audio.load()
  })
}

export function useNetAltaraNewsBroadcast(
  enabled: boolean,
  expectedIdentityLinkId: string | undefined,
  realtimeInvalidationVersion: number,
): AltaraNewsBroadcastController {
  const [phase, setPhase] = useState<AltaraNewsBroadcastPhase>('synchronizing')
  const [tuneState, setTuneState] = useState<NetAltaraNewsBroadcastTuneState | null>(null)
  const [tuned, setTuned] = useState(false)
  const [muted, setMutedState] = useState(() => window.localStorage.getItem(MUTED_KEY) === 'true')
  const [volume, setVolumeState] = useState(storedVolume)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const tunedRef = useRef(false)
  const enabledRef = useRef(enabled)
  const mutedRef = useRef(muted)
  const volumeRef = useRef(volume)
  const identityRef = useRef(expectedIdentityLinkId)
  const generationRef = useRef(0)
  const anchorRef = useRef<NewsBroadcastStationAnchor | null>(null)
  const transmissionRef = useRef<string | null>(null)
  const hasPayloadRef = useRef(false)
  const boundaryRef = useRef<number | null>(null)
  const syncRef = useRef<(
    play: boolean,
    options?: BroadcastSyncOptions,
  ) => Promise<void>>(async () => {})

  const clearBoundary = useCallback(() => {
    if (boundaryRef.current !== null) window.clearTimeout(boundaryRef.current)
    boundaryRef.current = null
  }, [])

  const stopAudio = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    anchorRef.current = null
    transmissionRef.current = null
  }, [])

  const synchronize = useCallback(async (
    play: boolean,
    options: BroadcastSyncOptions = {},
  ) => {
    const identityLinkId = identityRef.current
    if (!enabledRef.current || !identityLinkId) return
    const generation = ++generationRef.current
    setSyncing(hasPayloadRef.current)
    if (play) setPhase('loading')
    setError(null)
    try {
      const sample = await fetchNetAltaraNewsBroadcastTuneState(identityLinkId)
      if (!enabledRef.current || generation !== generationRef.current
        || identityRef.current !== identityLinkId) return
      const stationAnchor = anchor(sample)
      hasPayloadRef.current = true
      setTuneState(sample.state)
      if (!sample.state.current || !stationAnchor) {
        clearBoundary()
        stopAudio()
        setPhase('off-air')
        return
      }
      clearBoundary()
      boundaryRef.current = window.setTimeout(() => {
        boundaryRef.current = null
        void syncRef.current(tunedRef.current)
      }, Math.max(
        50,
        stationAnchor.clipEndsAtMs - estimatedNewsBroadcastServerNow(stationAnchor) + 40,
      ))
      if (!play || !tunedRef.current) {
        setPhase('ready-to-tune')
        return
      }
      if (stationAnchor.clipEndsAtMs - estimatedNewsBroadcastServerNow(stationAnchor) < 300) return
      const audio = audioRef.current
      if (!audio) throw new Error('The ALTARA NEWS audio engine is unavailable.')
      const transmissionKey = `${sample.state.current.clipId}:${sample.state.current.startedAt}`
      const expected = expectedNewsBroadcastOffsetSeconds(stationAnchor, sample.state.current.durationMs)
      if (transmissionRef.current === transmissionKey && audio.currentSrc) {
        anchorRef.current = stationAnchor
        if (Math.abs(audio.currentTime - expected) > 1) audio.currentTime = expected
        if (audio.paused) await audio.play()
        setPhase(sample.state.mode === 'breaking' ? 'breaking' : 'on-air')
        return
      }
      stopAudio()
      const ttl = newsBroadcastSignedUrlTtlSeconds(
        stationAnchor,
        NET_ALTARA_NEWS_BROADCAST_SIGNED_URL_MIN_TTL_SECONDS,
        NET_ALTARA_NEWS_BROADCAST_SIGNED_URL_MAX_TTL_SECONDS,
        NET_ALTARA_NEWS_BROADCAST_SIGNED_URL_GRACE_SECONDS,
      )
      let signedUrl: string
      try {
        signedUrl = await signNetAltaraNewsCurrentBroadcastObject(
          sample.state.current.objectPath,
          ttl,
        )
      } catch (signingError) {
        const needsAuthoritativeRecovery = signingError instanceof NetAltaraNewsBroadcastError
          && signingError.code === 'signing-failed'
        if (needsAuthoritativeRecovery && !options.boundaryRecovery) {
          await syncRef.current(play, { boundaryRecovery: true })
          return
        }
        throw signingError
      }
      if (!enabledRef.current || generation !== generationRef.current) return
      audio.src = signedUrl
      audio.preload = 'auto'
      await waitForMetadata(audio)
      if (!enabledRef.current || generation !== generationRef.current) return
      anchorRef.current = stationAnchor
      audio.currentTime = Math.min(
        expectedNewsBroadcastOffsetSeconds(stationAnchor, sample.state.current.durationMs),
        Number.isFinite(audio.duration) ? Math.max(0, audio.duration - 0.08) : expected,
      )
      audio.volume = volumeRef.current
      audio.muted = mutedRef.current
      await audio.play()
      if (!enabledRef.current || generation !== generationRef.current) {
        audio.pause()
        return
      }
      transmissionRef.current = transmissionKey
      setPhase(sample.state.mode === 'breaking' ? 'breaking' : 'on-air')
    } catch (nextError) {
      if (!enabledRef.current || generation !== generationRef.current) return
      stopAudio()
      setPhase('error')
      setError(friendlyError(nextError))
    } finally {
      if (generation === generationRef.current) setSyncing(false)
    }
  }, [clearBoundary, stopAudio])

  useEffect(() => { syncRef.current = synchronize }, [synchronize])

  useEffect(() => {
    enabledRef.current = enabled
    identityRef.current = expectedIdentityLinkId
    generationRef.current += 1
    clearBoundary()
    stopAudio()
    hasPayloadRef.current = false
    setTuneState(null)
    setError(null)
    if (!enabled || !expectedIdentityLinkId) {
      setPhase('synchronizing')
      return
    }
    if (!audioRef.current) audioRef.current = new Audio()
    void synchronize(tunedRef.current)
  }, [clearBoundary, enabled, expectedIdentityLinkId, stopAudio, synchronize])

  useEffect(() => {
    if (enabled && expectedIdentityLinkId && realtimeInvalidationVersion > 0) {
      void synchronize(tunedRef.current)
    }
  }, [enabled, expectedIdentityLinkId, realtimeInvalidationVersion, synchronize])

  useEffect(() => {
    if (!enabled || !expectedIdentityLinkId) return undefined
    const resume = () => {
      if (document.visibilityState === 'visible') void synchronize(tunedRef.current)
    }
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('pageshow', resume)
    return () => {
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('pageshow', resume)
    }
  }, [enabled, expectedIdentityLinkId, synchronize])

  useEffect(() => {
    if (!enabled || !tuned) return undefined
    const timer = window.setInterval(() => {
      const audio = audioRef.current
      const stationAnchor = anchorRef.current
      const current = tuneState?.current
      if (!audio || !stationAnchor || !current || audio.paused) return
      const expected = expectedNewsBroadcastOffsetSeconds(stationAnchor, current.durationMs)
      if (Math.abs(audio.currentTime - expected) > 1) audio.currentTime = expected
    }, DRIFT_CHECK_MS)
    return () => window.clearInterval(timer)
  }, [enabled, tuneState, tuned])

  useEffect(() => () => {
    generationRef.current += 1
    clearBoundary()
    stopAudio()
    audioRef.current = null
  }, [clearBoundary, stopAudio])

  const tuneIn = useCallback(() => {
    tunedRef.current = true
    setTuned(true)
    void synchronize(true)
  }, [synchronize])
  const tuneOut = useCallback(() => {
    generationRef.current += 1
    tunedRef.current = false
    setTuned(false)
    stopAudio()
    setError(null)
    setPhase(tuneState?.current ? 'ready-to-tune' : 'off-air')
  }, [stopAudio, tuneState])
  const retry = useCallback(() => {
    tunedRef.current = true
    setTuned(true)
    void synchronize(true)
  }, [synchronize])
  const setMuted = useCallback((next: boolean) => {
    mutedRef.current = next
    setMutedState(next)
    window.localStorage.setItem(MUTED_KEY, String(next))
    if (audioRef.current) audioRef.current.muted = next
  }, [])
  const setVolume = useCallback((next: number) => {
    const bounded = Math.min(Math.max(next, 0), 1)
    volumeRef.current = bounded
    setVolumeState(bounded)
    window.localStorage.setItem(VOLUME_KEY, String(bounded))
    if (audioRef.current) audioRef.current.volume = bounded
  }, [])

  return { phase, tuneState, tuned, muted, volume, syncing, error, tuneIn, tuneOut, retry, setMuted, setVolume }
}
