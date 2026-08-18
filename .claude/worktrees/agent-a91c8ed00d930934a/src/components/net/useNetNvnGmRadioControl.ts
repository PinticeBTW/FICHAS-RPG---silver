import { useCallback, useEffect, useRef, useState } from 'react'

import {
  endNetNvnGmRadioOverride,
  finalizeNetNvnGmRadioClipDelete,
  fetchNetNvnGmRadioControl,
  prepareNetNvnGmRadioClipDelete,
  removePreparedNetNvnGmRadioClipObject,
  setNetNvnGmRadioClipArchived,
  setNetNvnGmRadioBreakingStinger,
  setNetNvnGmRadioStationEnabled,
  startNetNvnGmRadioOverride,
  updateNetNvnGmRadioClip,
  uploadAndCreateNetNvnGmRadioClip,
} from '../../lib/netNvnRadioService'
import {
  NetNvnRadioError,
  type NetNvnGmRadioClipInput,
  type NetNvnGmRadioControlPayload,
  type NetNvnRadioMode,
} from '../../lib/netNvnRadioTypes'

export function useNetNvnGmRadioControl(
  enabled: boolean,
  realtimeInvalidationVersion: number,
) {
  const [payload, setPayload] = useState<NetNvnGmRadioControlPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadGenerationRef = useRef(0)
  const enabledRef = useRef(enabled)
  const payloadRef = useRef<NetNvnGmRadioControlPayload | null>(null)

  const apply = useCallback((next: NetNvnGmRadioControlPayload) => {
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
      const next = await fetchNetNvnGmRadioControl()
      if (!enabledRef.current || generation !== loadGenerationRef.current) return null
      return apply(next)
    } catch (nextError) {
      if (!enabledRef.current || generation !== loadGenerationRef.current) return null
      setError(nextError instanceof Error ? nextError.message : 'NVN Live Broadcast Control could not synchronize.')
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
      return
    }
    void load(Boolean(payloadRef.current))
  }, [enabled, load])

  const realtimeRef = useRef(realtimeInvalidationVersion)
  useEffect(() => {
    if (!enabled || realtimeInvalidationVersion <= realtimeRef.current) return
    realtimeRef.current = realtimeInvalidationVersion
    void load(true)
  }, [enabled, load, realtimeInvalidationVersion])

  const mutate = useCallback(async (
    operation: () => Promise<NetNvnGmRadioControlPayload>,
  ) => {
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
    uploadClip: (file: File, input: NetNvnGmRadioClipInput) =>
      mutate(() => uploadAndCreateNetNvnGmRadioClip(file, input)),
    updateClip: (clipId: string, input: NetNvnGmRadioClipInput) =>
      mutate(() => updateNetNvnGmRadioClip(clipId, input)),
    setArchived: (clipId: string, archived: boolean) =>
      mutate(() => setNetNvnGmRadioClipArchived(clipId, archived)),
    deletePermanently: async (clipId: string) => {
      setError(null)
      let prepared = payloadRef.current
      let clip = prepared?.clips.find((candidate) => candidate.id === clipId)
      if (!clip?.pendingDeleteAt) {
        prepared = await prepareNetNvnGmRadioClipDelete(clipId)
        apply(prepared)
        clip = prepared.clips.find((candidate) => candidate.id === clipId)
      }
      if (!clip) {
        throw new NetNvnRadioError(
          'invalid-response',
          'NVN did not return the prepared audio record.',
        )
      }
      await removePreparedNetNvnGmRadioClipObject(clip)
      return apply(await finalizeNetNvnGmRadioClipDelete(clipId))
    },
    setStationEnabled: (stationEnabled: boolean) =>
      mutate(() => setNetNvnGmRadioStationEnabled(stationEnabled)),
    setBreakingStinger: (clipId: string | null) =>
      mutate(() => setNetNvnGmRadioBreakingStinger(clipId)),
    startOverride: (
      clipId: string,
      mode: Exclude<NetNvnRadioMode, 'rotation'>,
      replaceActive: boolean,
    ) => mutate(() => startNetNvnGmRadioOverride(clipId, mode, replaceActive)),
    endOverride: () => mutate(endNetNvnGmRadioOverride),
  }
}
