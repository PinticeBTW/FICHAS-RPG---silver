import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  recordNetAltaraMusicRecentPlay,
  signNetAltaraMusicTrack,
} from '../../../lib/netAltaraMusicService'
import type { NetAltaraMusicTrack } from '../../../lib/netAltaraMusicTypes'

export type AltaraMusicRepeatMode = 'off' | 'track' | 'queue'

export interface AltaraMusicPlayerController {
  readonly current: NetAltaraMusicTrack | null
  readonly queue: readonly NetAltaraMusicTrack[]
  readonly currentIndex: number
  readonly playing: boolean
  readonly loading: boolean
  readonly error?: string
  readonly currentTime: number
  readonly duration: number
  readonly volume: number
  readonly muted: boolean
  readonly shuffle: boolean
  readonly repeat: AltaraMusicRepeatMode
  readonly bindAudioElement: (element: HTMLAudioElement | null) => void
  readonly playQueue: (tracks: readonly NetAltaraMusicTrack[], startIndex?: number) => Promise<void>
  readonly playNext: (track: NetAltaraMusicTrack) => Promise<void>
  readonly addToQueue: (track: NetAltaraMusicTrack) => Promise<void>
  readonly removeFromQueue: (queueIndex: number) => void
  readonly moveQueueItem: (fromIndex: number, toIndex: number) => void
  readonly toggle: () => Promise<void>
  readonly previous: () => Promise<void>
  readonly next: () => Promise<void>
  readonly seek: (seconds: number) => void
  readonly setVolume: (volume: number) => void
  readonly toggleMuted: () => void
  readonly toggleShuffle: () => void
  readonly cycleRepeat: () => void
  readonly onTimeUpdate: () => void
  readonly onDurationChange: () => void
  readonly onPlaying: () => void
  readonly onPause: () => void
  readonly onEnded: () => void
  readonly onError: () => void
}

export function useAltaraMusicPlayer(
  identitySessionKey: string,
  expectedIdentityLinkId?: string,
): AltaraMusicPlayerController {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const generationRef = useRef(0)
  const queueRef = useRef<readonly NetAltaraMusicTrack[]>([])
  const indexRef = useRef(-1)
  const identityRef = useRef(expectedIdentityLinkId)
  const shuffleRef = useRef(false)
  const repeatRef = useRef<AltaraMusicRepeatMode>('off')
  const [queue, setQueue] = useState<readonly NetAltaraMusicTrack[]>([])
  const [index, setIndex] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(0.78)
  const [muted, setMuted] = useState(false)
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState<AltaraMusicRepeatMode>('off')

  queueRef.current = queue
  indexRef.current = index
  identityRef.current = expectedIdentityLinkId
  shuffleRef.current = shuffle
  repeatRef.current = repeat

  const current = index >= 0 ? queue[index] ?? null : null

  const commitQueue = useCallback((nextQueue: readonly NetAltaraMusicTrack[], nextIndex = indexRef.current) => {
    queueRef.current = nextQueue
    indexRef.current = nextIndex
    setQueue(nextQueue)
    setIndex(nextIndex)
  }, [])

  const loadIndex = useCallback(async (nextIndex: number, nextQueue = queueRef.current) => {
    const identityLinkId = identityRef.current
    const track = nextQueue[nextIndex]
    const audio = audioRef.current
    if (!identityLinkId || !track || !audio) return
    const generation = ++generationRef.current
    setLoading(true)
    setError(undefined)
    try {
      const signedUrl = await signNetAltaraMusicTrack(track)
      if (generationRef.current !== generation || identityRef.current !== identityLinkId) return
      const sameSource = audio.dataset.trackId === track.id
        && audio.dataset.objectPath === track.audioObjectPath
      commitQueue(nextQueue, nextIndex)
      if (!sameSource) {
        audio.src = signedUrl
        audio.dataset.trackId = track.id
        audio.dataset.objectPath = track.audioObjectPath
        audio.currentTime = 0
        setCurrentTime(0)
      }
      audio.volume = volume
      audio.muted = muted
      await audio.play()
      if (generationRef.current !== generation || identityRef.current !== identityLinkId) return
      setPlaying(true)
      void recordNetAltaraMusicRecentPlay(identityLinkId, track.id).catch(() => undefined)
    } catch (loadError) {
      if (generationRef.current !== generation) return
      setPlaying(false)
      setError(loadError instanceof Error ? loadError.message : 'This track could not be opened securely.')
    } finally {
      if (generationRef.current === generation) setLoading(false)
    }
  }, [commitQueue, muted, volume])

  const playQueue = useCallback(async (
    tracks: readonly NetAltaraMusicTrack[],
    startIndex = 0,
  ) => {
    if (!tracks.length || startIndex < 0 || startIndex >= tracks.length) return
    await loadIndex(startIndex, [...tracks])
  }, [loadIndex])

  const playNext = useCallback(async (track: NetAltaraMusicTrack) => {
    const activeQueue = [...queueRef.current]
    let currentIndex = indexRef.current
    const currentTrack = currentIndex >= 0 ? activeQueue[currentIndex] : undefined
    if (!activeQueue.length || currentIndex < 0 || !currentTrack) {
      await loadIndex(0, [track])
      return
    }
    if (currentTrack.id === track.id) return

    const existingIndex = activeQueue.findIndex((queuedTrack) => queuedTrack.id === track.id)
    if (existingIndex >= 0) {
      activeQueue.splice(existingIndex, 1)
      if (existingIndex < currentIndex) currentIndex -= 1
    }
    activeQueue.splice(currentIndex + 1, 0, track)
    commitQueue(activeQueue, currentIndex)
  }, [commitQueue, loadIndex])

  const addToQueue = useCallback(async (track: NetAltaraMusicTrack) => {
    const activeQueue = [...queueRef.current]
    let currentIndex = indexRef.current
    const currentTrack = currentIndex >= 0 ? activeQueue[currentIndex] : undefined
    if (!activeQueue.length || currentIndex < 0 || !currentTrack) {
      await loadIndex(0, [track])
      return
    }
    if (currentTrack.id === track.id) return

    const existingIndex = activeQueue.findIndex((queuedTrack) => queuedTrack.id === track.id)
    if (existingIndex >= 0) {
      activeQueue.splice(existingIndex, 1)
      if (existingIndex < currentIndex) currentIndex -= 1
    }
    activeQueue.push(track)
    commitQueue(activeQueue, currentIndex)
  }, [commitQueue, loadIndex])

  const removeFromQueue = useCallback((queueIndex: number) => {
    const activeQueue = [...queueRef.current]
    const currentIndex = indexRef.current
    if (queueIndex <= currentIndex || queueIndex < 0 || queueIndex >= activeQueue.length) return
    activeQueue.splice(queueIndex, 1)
    commitQueue(activeQueue, currentIndex)
  }, [commitQueue])

  const moveQueueItem = useCallback((fromIndex: number, toIndex: number) => {
    const activeQueue = [...queueRef.current]
    const currentIndex = indexRef.current
    if (
      fromIndex <= currentIndex
      || toIndex <= currentIndex
      || fromIndex < 0
      || toIndex < 0
      || fromIndex >= activeQueue.length
      || toIndex >= activeQueue.length
      || fromIndex === toIndex
    ) return
    const [moved] = activeQueue.splice(fromIndex, 1)
    if (!moved) return
    activeQueue.splice(toIndex, 0, moved)
    commitQueue(activeQueue, currentIndex)
  }, [commitQueue])

  const next = useCallback(async () => {
    const activeQueue = queueRef.current
    if (!activeQueue.length) return
    let nextIndex: number
    if (shuffleRef.current && activeQueue.length > 1) {
      const candidates = activeQueue.map((_, candidateIndex) => candidateIndex)
        .filter((candidateIndex) => candidateIndex !== indexRef.current)
      nextIndex = candidates[Math.floor(Math.random() * candidates.length)] ?? 0
    } else {
      nextIndex = indexRef.current + 1
      if (nextIndex >= activeQueue.length) {
        if (repeatRef.current !== 'queue') {
          audioRef.current?.pause()
          setPlaying(false)
          return
        }
        nextIndex = 0
      }
    }
    await loadIndex(nextIndex, activeQueue)
  }, [loadIndex])

  const previous = useCallback(async () => {
    const audio = audioRef.current
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0
      setCurrentTime(0)
      return
    }
    const activeQueue = queueRef.current
    if (!activeQueue.length) return
    const previousIndex = indexRef.current <= 0
      ? repeatRef.current === 'queue' ? activeQueue.length - 1 : 0
      : indexRef.current - 1
    await loadIndex(previousIndex, activeQueue)
  }, [loadIndex])

  const toggle = useCallback(async () => {
    const audio = audioRef.current
    if (!audio) return
    if (!current) return
    if (audio.paused) {
      try {
        await audio.play()
        setPlaying(true)
      } catch (playError) {
        setError(playError instanceof Error ? playError.message : 'Playback could not start.')
      }
    } else {
      audio.pause()
      setPlaying(false)
    }
  }, [current])

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(seconds)) return
    audio.currentTime = Math.min(Math.max(seconds, 0), Number.isFinite(audio.duration) ? audio.duration : seconds)
    setCurrentTime(audio.currentTime)
  }, [])

  const setVolume = useCallback((nextVolume: number) => {
    const safeVolume = Math.min(1, Math.max(0, nextVolume))
    setVolumeState(safeVolume)
    if (audioRef.current) audioRef.current.volume = safeVolume
  }, [])

  const toggleMuted = useCallback(() => {
    setMuted((value) => {
      if (audioRef.current) audioRef.current.muted = !value
      return !value
    })
  }, [])

  const toggleShuffle = useCallback(() => setShuffle((value) => !value), [])
  const cycleRepeat = useCallback(() => setRepeat((value) => value === 'off' ? 'queue' : value === 'queue' ? 'track' : 'off'), [])
  const bindAudioElement = useCallback((element: HTMLAudioElement | null) => {
    audioRef.current = element
  }, [])
  const onTimeUpdate = useCallback(() => setCurrentTime(audioRef.current?.currentTime ?? 0), [])
  const onDurationChange = useCallback(() => {
    setDuration(Number.isFinite(audioRef.current?.duration) ? audioRef.current?.duration ?? 0 : 0)
  }, [])
  const onPlaying = useCallback(() => setPlaying(true), [])
  const onPause = useCallback(() => setPlaying(false), [])
  const onError = useCallback(() => {
    setPlaying(false)
    setError('The secure audio stream was interrupted.')
  }, [])

  const onEnded = useCallback(() => {
    if (repeatRef.current === 'track') {
      const audio = audioRef.current
      if (!audio) return
      audio.currentTime = 0
      void audio.play().catch(() => setError('Playback could not resume.'))
      return
    }
    void next()
  }, [next])

  useEffect(() => {
    generationRef.current += 1
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.removeAttribute('data-track-id')
      audio.removeAttribute('data-object-path')
      audio.load()
    }
    queueRef.current = []
    indexRef.current = -1
    setQueue([])
    setIndex(-1)
    setPlaying(false)
    setLoading(false)
    setError(undefined)
    setCurrentTime(0)
    setDuration(0)
  }, [identitySessionKey])

  return useMemo(() => ({
    current,
    queue,
    currentIndex: index,
    playing,
    loading,
    ...(error ? { error } : {}),
    currentTime,
    duration,
    volume,
    muted,
    shuffle,
    repeat,
    bindAudioElement,
    playQueue,
    playNext,
    addToQueue,
    removeFromQueue,
    moveQueueItem,
    toggle,
    previous,
    next,
    seek,
    setVolume,
    toggleMuted,
    toggleShuffle,
    cycleRepeat,
    onTimeUpdate,
    onDurationChange,
    onPlaying,
    onPause,
    onEnded,
    onError,
  }), [
    addToQueue, bindAudioElement, current, currentTime, cycleRepeat, duration,
    error, index, loading, moveQueueItem, muted, next, onDurationChange,
    onEnded, onError, onPause, onPlaying, onTimeUpdate, playNext, playQueue,
    playing, previous, queue, removeFromQueue, repeat, seek, setVolume,
    shuffle, toggle, toggleMuted, toggleShuffle, volume,
  ])
}
