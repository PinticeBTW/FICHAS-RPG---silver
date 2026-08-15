import { useCallback, useEffect, useRef, useState } from 'react'

import {
  endNetAltaraNewsGmBroadcastOverride,
  fetchNetAltaraNewsGmBroadcastControl,
  finalizeNetAltaraNewsGmBroadcastClipDelete,
  inspectNetAltaraNewsBroadcastAudio,
  prepareNetAltaraNewsGmBroadcastClipDelete,
  removePreparedNetAltaraNewsGmBroadcastClipObject,
  setNetAltaraNewsGmBroadcastBreakingStinger,
  setNetAltaraNewsGmBroadcastClipArchived,
  setNetAltaraNewsGmBroadcastStationEnabled,
  signNetAltaraNewsCurrentBroadcastObject,
  startNetAltaraNewsGmBroadcastOverride,
  updateNetAltaraNewsGmBroadcastClip,
  uploadAndCreateNetAltaraNewsGmBroadcastClip,
} from '../../../lib/netAltaraNewsBroadcastService'
import {
  NetAltaraNewsBroadcastError,
  type NetAltaraNewsBroadcastMode,
  type NetAltaraNewsGmBroadcastClipInput,
  type NetAltaraNewsGmBroadcastPayload,
} from '../../../lib/netAltaraNewsBroadcastTypes'
import { subscribeToNetAltaraNews } from '../../../lib/netAltaraNewsRealtimeService'

export function useNetAltaraNewsGmBroadcastControl(enabled: boolean) {
  const [payload, setPayload] = useState<NetAltaraNewsGmBroadcastPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadGenerationRef = useRef(0)
  const enabledRef = useRef(enabled)
  const payloadRef = useRef<NetAltaraNewsGmBroadcastPayload | null>(null)
  const refreshTimerRef = useRef<number | null>(null)

  const apply = useCallback((next: NetAltaraNewsGmBroadcastPayload) => {
    payloadRef.current = next
    setPayload(next)
    setError(null)
    return next
  }, [])

  const load = useCallback(async (background = false) => {
    if (!enabledRef.current) return null
    const generation = ++loadGenerationRef.current
    if (background && payloadRef.current) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const next = await fetchNetAltaraNewsGmBroadcastControl()
      if (!enabledRef.current || generation !== loadGenerationRef.current) return null
      return apply(next)
    } catch (nextError) {
      if (!enabledRef.current || generation !== loadGenerationRef.current) return null
      setError(nextError instanceof Error ? nextError.message : 'ALTARA NEWS Broadcast Control could not synchronize.')
      return null
    } finally {
      if (generation === loadGenerationRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [apply])

  useEffect(() => {
    enabledRef.current = enabled
    if (!enabled) {
      loadGenerationRef.current += 1
      setLoading(false)
      setRefreshing(false)
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current)
      return
    }
    void load(Boolean(payloadRef.current))
  }, [enabled, load])

  useEffect(() => {
    if (!enabled) return undefined
    return subscribeToNetAltaraNews((_articleChanged, _liveChanged, broadcastChanged) => {
      if (!broadcastChanged) return
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null
        void load(true)
      }, 220)
    }, () => {})
  }, [enabled, load])

  useEffect(() => () => {
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current)
  }, [])

  const mutate = useCallback(async (
    operation: () => Promise<NetAltaraNewsGmBroadcastPayload>,
  ) => {
    loadGenerationRef.current += 1
    setLoading(false)
    setRefreshing(false)
    setError(null)
    const next = await operation()
    return apply(next)
  }, [apply])

  return {
    payload,
    loading,
    refreshing,
    error,
    refresh: load,
    retry: () => void load(Boolean(payloadRef.current)),
    inspectAudio: inspectNetAltaraNewsBroadcastAudio,
    signClip: signNetAltaraNewsCurrentBroadcastObject,
    uploadClip: (file: File, input: NetAltaraNewsGmBroadcastClipInput) =>
      mutate(() => uploadAndCreateNetAltaraNewsGmBroadcastClip(file, input)),
    updateClip: (clipId: string, input: NetAltaraNewsGmBroadcastClipInput) =>
      mutate(() => updateNetAltaraNewsGmBroadcastClip(clipId, input)),
    setArchived: (clipId: string, archived: boolean) =>
      mutate(() => setNetAltaraNewsGmBroadcastClipArchived(clipId, archived)),
    deletePermanently: async (clipId: string) => {
      setError(null)
      let prepared = payloadRef.current
      let clip = prepared?.clips.find((candidate) => candidate.id === clipId)
      if (!clip?.pendingDeleteAt) {
        prepared = await prepareNetAltaraNewsGmBroadcastClipDelete(clipId)
        apply(prepared)
        clip = prepared.clips.find((candidate) => candidate.id === clipId)
      }
      if (!clip) {
        throw new NetAltaraNewsBroadcastError(
          'invalid-response',
          'ALTARA NEWS did not return the prepared audio record.',
        )
      }
      await removePreparedNetAltaraNewsGmBroadcastClipObject(clip)
      return apply(await finalizeNetAltaraNewsGmBroadcastClipDelete(clipId))
    },
    setStationEnabled: (stationEnabled: boolean) =>
      mutate(() => setNetAltaraNewsGmBroadcastStationEnabled(stationEnabled)),
    setBreakingStinger: (clipId: string | null) =>
      mutate(() => setNetAltaraNewsGmBroadcastBreakingStinger(clipId)),
    startOverride: (
      clipId: string,
      mode: Exclude<NetAltaraNewsBroadcastMode, 'rotation'>,
      replaceActive: boolean,
    ) => mutate(() => startNetAltaraNewsGmBroadcastOverride(clipId, mode, replaceActive)),
    endOverride: () => mutate(endNetAltaraNewsGmBroadcastOverride),
  }
}
