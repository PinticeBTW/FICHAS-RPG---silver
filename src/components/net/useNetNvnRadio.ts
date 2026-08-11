import { useCallback, useEffect, useRef, useState } from 'react'

import {
  fetchNetNvnRadioTuneState,
  signNetNvnCurrentRadioObject,
} from '../../lib/netNvnRadioService'
import {
  NET_NVN_RADIO_SIGNED_URL_GRACE_SECONDS,
  NET_NVN_RADIO_SIGNED_URL_MAX_TTL_SECONDS,
  NET_NVN_RADIO_SIGNED_URL_MIN_TTL_SECONDS,
  NetNvnRadioError,
  type NetNvnRadioTuneSample,
  type NetNvnRadioTuneState,
} from '../../lib/netNvnRadioTypes'

const VOLUME_STORAGE_KEY = 'net:nvn-radio:volume:v1'
const MUTED_STORAGE_KEY = 'net:nvn-radio:muted:v1'
const AUDIO_READY_TIMEOUT_MS = 15_000
const DRIFT_CHECK_MS = 5_000
const RESYNC_DRIFT_SECONDS = 1
const BOUNDARY_SIGN_TOLERANCE_MS = 150

export type NvnRadioPhase =
  | 'synchronizing'
  | 'off-air'
  | 'ready-to-tune'
  | 'loading'
  | 'on-air'
  | 'breaking'
  | 'error'

export interface NvnRadioController {
  readonly phase: NvnRadioPhase
  readonly tuneState: NetNvnRadioTuneState | null
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
  readonly resynchronize: () => void
}

interface StationAnchor {
  readonly serverNowAtReceiveMs: number
  readonly responseReceivedAt: number
  readonly clipStartedAtMs: number
  readonly clipEndsAtMs: number
}

interface RadioSyncOptions {
  readonly reuseConfirmed?: boolean
  readonly boundaryRecovery?: boolean
}

function storedVolume(): number {
  const parsed = Number(window.localStorage.getItem(VOLUME_STORAGE_KEY))
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.72
}

function friendlyRadioError(error: unknown): string {
  if (error instanceof NetNvnRadioError) return error.message
  if (error instanceof Error && error.name === 'NotAllowedError') {
    return 'Browser playback permission is required. Press Tune In to join the live station.'
  }
  return error instanceof Error ? error.message : 'The live NVN transmission could not be opened.'
}

function anchorFromSample(sample: NetNvnRadioTuneSample): StationAnchor | null {
  if (!sample.state.current) return null
  const rttMs = Math.max(0, sample.responseReceivedAt - sample.requestStartedAt)
  return {
    serverNowAtReceiveMs: Date.parse(sample.state.serverNow) + rttMs / 2,
    responseReceivedAt: sample.responseReceivedAt,
    clipStartedAtMs: Date.parse(sample.state.current.startedAt),
    clipEndsAtMs: Date.parse(sample.state.current.endsAt),
  }
}

function estimatedServerNow(anchor: StationAnchor): number {
  return anchor.serverNowAtReceiveMs + Math.max(0, performance.now() - anchor.responseReceivedAt)
}

function expectedOffsetSeconds(anchor: StationAnchor, durationMs: number): number {
  const raw = (estimatedServerNow(anchor) - anchor.clipStartedAtMs) / 1000
  return Math.min(Math.max(raw, 0), Math.max(0, durationMs / 1000 - 0.08))
}

function signedUrlTtlSeconds(anchor: StationAnchor): number {
  const remainingSeconds = Math.max(0, anchor.clipEndsAtMs - estimatedServerNow(anchor)) / 1000
  return Math.min(
    NET_NVN_RADIO_SIGNED_URL_MAX_TTL_SECONDS,
    Math.max(
      NET_NVN_RADIO_SIGNED_URL_MIN_TTL_SECONDS,
      Math.ceil(remainingSeconds + NET_NVN_RADIO_SIGNED_URL_GRACE_SECONDS),
    ),
  )
}

function waitForAudioMetadata(audio: HTMLAudioElement): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      audio.removeEventListener('loadedmetadata', handleLoaded)
      audio.removeEventListener('error', handleError)
      if (error) reject(error)
      else resolve()
    }
    const handleLoaded = () => finish()
    const handleError = () => finish(new Error('The signed live audio object could not be loaded.'))
    const timer = window.setTimeout(
      () => finish(new Error('The signed live audio object took too long to load.')),
      AUDIO_READY_TIMEOUT_MS,
    )
    audio.addEventListener('loadedmetadata', handleLoaded)
    audio.addEventListener('error', handleError)
    audio.load()
  })
}

export function useNetNvnRadio(
  enabled: boolean,
  realtimeInvalidationVersion: number,
): NvnRadioController {
  const [phase, setPhase] = useState<NvnRadioPhase>('synchronizing')
  const [tuneState, setTuneState] = useState<NetNvnRadioTuneState | null>(null)
  const [tuned, setTuned] = useState(false)
  const [muted, setMutedState] = useState(() => window.localStorage.getItem(MUTED_STORAGE_KEY) === 'true')
  const [volume, setVolumeState] = useState(storedVolume)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const tunedRef = useRef(false)
  const mutedRef = useRef(muted)
  const volumeRef = useRef(volume)
  const enabledRef = useRef(enabled)
  const operationGenerationRef = useRef(0)
  const anchorRef = useRef<StationAnchor | null>(null)
  const boundaryTimerRef = useRef<number | null>(null)
  const transmissionKeyRef = useRef<string | null>(null)
  const latestSampleRef = useRef<NetNvnRadioTuneSample | null>(null)
  const initialSyncCompleteRef = useRef(false)
  const syncRef = useRef<(
    play: boolean,
    options?: RadioSyncOptions,
  ) => Promise<void>>(async () => {})

  const clearBoundary = useCallback(() => {
    if (boundaryTimerRef.current !== null) window.clearTimeout(boundaryTimerRef.current)
    boundaryTimerRef.current = null
  }, [])

  const stopAudio = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    anchorRef.current = null
    transmissionKeyRef.current = null
  }, [])

  const scheduleBoundary = useCallback((anchor: StationAnchor) => {
    clearBoundary()
    const remainingMs = Math.max(50, anchor.clipEndsAtMs - estimatedServerNow(anchor) + 40)
    boundaryTimerRef.current = window.setTimeout(() => {
      boundaryTimerRef.current = null
      if (enabledRef.current) void syncRef.current(tunedRef.current)
    }, remainingMs)
  }, [clearBoundary])

  const synchronize = useCallback(async (
    play: boolean,
    options: RadioSyncOptions = {},
  ) => {
    if (!enabledRef.current) return
    const generation = ++operationGenerationRef.current
    setSyncing(initialSyncCompleteRef.current)
    if (play) setPhase('loading')
    setError(null)
    try {
      const reusableSample = options.reuseConfirmed ? latestSampleRef.current : null
      const reusableAnchor = reusableSample ? anchorFromSample(reusableSample) : null
      const sample = reusableSample?.state.current
        && reusableAnchor
        && reusableAnchor.clipEndsAtMs - estimatedServerNow(reusableAnchor) >= 300
        ? reusableSample
        : await fetchNetNvnRadioTuneState()
      if (!enabledRef.current || generation !== operationGenerationRef.current) return
      latestSampleRef.current = sample
      initialSyncCompleteRef.current = true
      setTuneState(sample.state)
      const anchor = anchorFromSample(sample)

      if (!sample.state.current || !anchor) {
        clearBoundary()
        stopAudio()
        setPhase('off-air')
        return
      }

      scheduleBoundary(anchor)
      if (!play || !tunedRef.current) {
        setPhase('ready-to-tune')
        return
      }
      if (anchor.clipEndsAtMs - estimatedServerNow(anchor) < 300) {
        setPhase('loading')
        return
      }

      const audio = audioRef.current
      if (!audio) throw new Error('The NVN audio engine is unavailable.')
      const transmissionKey = `${sample.state.current.clipId}:${sample.state.current.startedAt}`
      if (transmissionKeyRef.current === transmissionKey && audio.currentSrc) {
        anchorRef.current = anchor
        const expected = expectedOffsetSeconds(anchor, sample.state.current.durationMs)
        if (Math.abs(audio.currentTime - expected) > RESYNC_DRIFT_SECONDS) {
          audio.currentTime = expected
        }
        if (audio.paused) await audio.play()
        setPhase(sample.state.mode === 'breaking' ? 'breaking' : 'on-air')
        return
      }

      stopAudio()
      let signedUrl: string
      try {
        signedUrl = await signNetNvnCurrentRadioObject(
          sample.state.current.objectPath,
          signedUrlTtlSeconds(anchor),
        )
      } catch (signingError) {
        const crossedAuthoritativeBoundary =
          signingError instanceof NetNvnRadioError
          && signingError.code === 'signing-failed'
          && estimatedServerNow(anchor) >= anchor.clipEndsAtMs - BOUNDARY_SIGN_TOLERANCE_MS
        if (crossedAuthoritativeBoundary && !options.boundaryRecovery) {
          await syncRef.current(play, { boundaryRecovery: true })
          return
        }
        throw signingError
      }
      if (!enabledRef.current || generation !== operationGenerationRef.current) return
      audio.src = signedUrl
      audio.preload = 'auto'
      await waitForAudioMetadata(audio)
      if (!enabledRef.current || generation !== operationGenerationRef.current) return
      anchorRef.current = anchor
      const authoritativeOffset = expectedOffsetSeconds(anchor, sample.state.current.durationMs)
      const playableCeiling = Number.isFinite(audio.duration)
        ? Math.max(0, audio.duration - 0.08)
        : authoritativeOffset
      audio.currentTime = Math.min(authoritativeOffset, playableCeiling)
      audio.volume = volumeRef.current
      audio.muted = mutedRef.current
      try {
        await audio.play()
      } catch (playError) {
        if (playError instanceof DOMException && playError.name === 'NotAllowedError') {
          tunedRef.current = false
          setTuned(false)
          setPhase('ready-to-tune')
          throw new NetNvnRadioError('autoplay-blocked', 'Press Tune In to allow NVN Live Broadcast playback.')
        }
        throw playError
      }
      if (!enabledRef.current || generation !== operationGenerationRef.current) {
        audio.pause()
        return
      }
      transmissionKeyRef.current = transmissionKey
      setPhase(sample.state.mode === 'breaking' ? 'breaking' : 'on-air')
    } catch (nextError) {
      if (!enabledRef.current || generation !== operationGenerationRef.current) return
      stopAudio()
      setPhase('error')
      setError(friendlyRadioError(nextError))
    } finally {
      if (generation === operationGenerationRef.current) setSyncing(false)
    }
  }, [clearBoundary, scheduleBoundary, stopAudio])

  useEffect(() => {
    syncRef.current = synchronize
  }, [synchronize])

  useEffect(() => {
    enabledRef.current = enabled
    if (!enabled) {
      operationGenerationRef.current += 1
      clearBoundary()
      stopAudio()
      initialSyncCompleteRef.current = false
      latestSampleRef.current = null
      setTuneState(null)
      setSyncing(false)
      setPhase('synchronizing')
      return undefined
    }
    if (!audioRef.current) audioRef.current = new Audio()
    const audio = audioRef.current
    const handleAudioFailure = () => {
      if (!tunedRef.current || !audio.currentSrc) return
      operationGenerationRef.current += 1
      audio.pause()
      anchorRef.current = null
      transmissionKeyRef.current = null
      setSyncing(false)
      setPhase('error')
      setError('The live NVN audio carrier was interrupted. Tune in again to rejoin the current broadcast.')
    }
    audio.addEventListener('error', handleAudioFailure)
    void synchronize(tunedRef.current)
    return () => audio.removeEventListener('error', handleAudioFailure)
  }, [clearBoundary, enabled, stopAudio, synchronize])

  useEffect(() => {
    if (!enabled || realtimeInvalidationVersion <= 0) return
    void synchronize(tunedRef.current)
  }, [enabled, realtimeInvalidationVersion, synchronize])

  useEffect(() => {
    if (!enabled) return undefined
    const handleResume = () => {
      if (document.visibilityState === 'visible') void synchronize(tunedRef.current)
    }
    document.addEventListener('visibilitychange', handleResume)
    window.addEventListener('pageshow', handleResume)
    return () => {
      document.removeEventListener('visibilitychange', handleResume)
      window.removeEventListener('pageshow', handleResume)
    }
  }, [enabled, synchronize])

  useEffect(() => {
    if (!enabled || !tuned) return undefined
    const timer = window.setInterval(() => {
      const audio = audioRef.current
      const anchor = anchorRef.current
      const current = tuneState?.current
      if (!audio || !anchor || !current || audio.paused) return
      const expected = expectedOffsetSeconds(anchor, current.durationMs)
      if (Math.abs(audio.currentTime - expected) > RESYNC_DRIFT_SECONDS) {
        audio.currentTime = expected
      }
    }, DRIFT_CHECK_MS)
    return () => window.clearInterval(timer)
  }, [enabled, tuneState, tuned])

  useEffect(() => () => {
    operationGenerationRef.current += 1
    clearBoundary()
    stopAudio()
    audioRef.current = null
  }, [clearBoundary, stopAudio])

  const tuneIn = useCallback(() => {
    tunedRef.current = true
    setTuned(true)
    void synchronize(true, { reuseConfirmed: true })
  }, [synchronize])

  const tuneOut = useCallback(() => {
    operationGenerationRef.current += 1
    tunedRef.current = false
    setTuned(false)
    stopAudio()
    setError(null)
    setPhase(tuneState?.current ? 'ready-to-tune' : 'off-air')
  }, [stopAudio, tuneState])

  const setMuted = useCallback((nextMuted: boolean) => {
    mutedRef.current = nextMuted
    setMutedState(nextMuted)
    window.localStorage.setItem(MUTED_STORAGE_KEY, String(nextMuted))
    if (audioRef.current) audioRef.current.muted = nextMuted
  }, [])

  const setVolume = useCallback((nextVolume: number) => {
    const bounded = Math.min(Math.max(nextVolume, 0), 1)
    volumeRef.current = bounded
    setVolumeState(bounded)
    window.localStorage.setItem(VOLUME_STORAGE_KEY, String(bounded))
    if (audioRef.current) audioRef.current.volume = bounded
  }, [])

  const resynchronize = useCallback(() => {
    void synchronize(tunedRef.current)
  }, [synchronize])

  const retry = useCallback(() => {
    tunedRef.current = true
    setTuned(true)
    void synchronize(true)
  }, [synchronize])

  return {
    phase,
    tuneState,
    tuned,
    muted,
    volume,
    syncing,
    error,
    tuneIn,
    tuneOut,
    retry,
    setMuted,
    setVolume,
    resynchronize,
  }
}
