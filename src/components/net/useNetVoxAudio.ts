import { useCallback, useEffect, useRef, useState } from 'react'

import {
  deleteNetVoxAudioPersonalPlaylist,
  fetchNetVoxAudioArtist,
  fetchNetVoxAudioHome,
  fetchNetVoxAudioLibrary,
  fetchNetVoxAudioPlaylist,
  fetchNetVoxAudioRelease,
  saveNetVoxAudioPersonalPlaylist,
  searchNetVoxAudio,
  setNetVoxAudioPersonalPlaylistTrack,
  setNetVoxAudioTrackLiked,
} from '../../lib/netVoxAudioService'
import type {
  NetVoxAudioArtistDetail,
  NetVoxAudioCollection,
  NetVoxAudioLibrary,
  NetVoxAudioPlaylistDetail,
  NetVoxAudioReleaseDetail,
} from '../../lib/netVoxAudioTypes'

type Detail =
  | { readonly kind: 'artist'; readonly value: NetVoxAudioArtistDetail }
  | { readonly kind: 'release'; readonly value: NetVoxAudioReleaseDetail }
  | { readonly kind: 'playlist'; readonly value: NetVoxAudioPlaylistDetail }

export interface NetVoxAudioController {
  readonly loading: boolean
  readonly refreshing: boolean
  readonly mutating: boolean
  readonly error?: string
  readonly home?: NetVoxAudioCollection
  readonly library?: NetVoxAudioLibrary
  readonly search?: NetVoxAudioCollection
  readonly detail?: Detail
  readonly reload: () => void
  readonly runSearch: (query: string) => Promise<void>
  readonly clearSearch: () => void
  readonly openArtist: (id: string) => Promise<void>
  readonly openRelease: (id: string) => Promise<void>
  readonly openPlaylist: (id: string) => Promise<void>
  readonly closeDetail: () => void
  readonly setLiked: (trackId: string, liked: boolean) => Promise<void>
  readonly savePlaylist: (input: { readonly id?: string; readonly title: string; readonly description?: string }) => Promise<string>
  readonly deletePlaylist: (id: string) => Promise<void>
  readonly setPlaylistTrack: (playlistId: string, trackId: string, included: boolean) => Promise<void>
}

function reason(error: unknown) {
  return error instanceof Error ? error.message : 'VOX AUDIO could not synchronize.'
}

export function useNetVoxAudio(
  enabled: boolean,
  expectedIdentityLinkId?: string,
): NetVoxAudioController {
  const generationRef = useRef(0)
  const identityRef = useRef(expectedIdentityLinkId)
  const [reloadToken, setReloadToken] = useState(0)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [mutating, setMutating] = useState(false)
  const [error, setError] = useState<string>()
  const [home, setHome] = useState<NetVoxAudioCollection>()
  const [library, setLibrary] = useState<NetVoxAudioLibrary>()
  const [search, setSearch] = useState<NetVoxAudioCollection>()
  const [detail, setDetail] = useState<Detail>()

  identityRef.current = expectedIdentityLinkId

  const load = useCallback(async (background = false) => {
    const identityLinkId = identityRef.current
    if (!enabled || !identityLinkId) return
    const generation = ++generationRef.current
    if (background) setRefreshing(true)
    else setLoading(true)
    setError(undefined)
    try {
      const [nextHome, nextLibrary] = await Promise.all([
        fetchNetVoxAudioHome(identityLinkId),
        fetchNetVoxAudioLibrary(identityLinkId),
      ])
      if (generationRef.current !== generation || identityRef.current !== identityLinkId) return
      setHome(nextHome)
      setLibrary(nextLibrary)
    } catch (loadError) {
      if (generationRef.current === generation) setError(reason(loadError))
    } finally {
      if (generationRef.current === generation) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [enabled])

  useEffect(() => {
    generationRef.current += 1
    setHome(undefined)
    setLibrary(undefined)
    setSearch(undefined)
    setDetail(undefined)
    setError(undefined)
    setLoading(Boolean(enabled && expectedIdentityLinkId))
    setRefreshing(false)
    setMutating(false)
    if (enabled && expectedIdentityLinkId) void load(false)
  }, [enabled, expectedIdentityLinkId, load, reloadToken])

  const runForIdentity = useCallback(async <T,>(operation: (identityLinkId: string) => Promise<T>): Promise<T> => {
    const identityLinkId = identityRef.current
    if (!enabled || !identityLinkId) throw new Error('An installed VOX AUDIO runtime identity is required.')
    const generation = generationRef.current
    const result = await operation(identityLinkId)
    if (generationRef.current !== generation || identityRef.current !== identityLinkId) {
      throw new Error('VOX AUDIO identity changed while the request was running.')
    }
    return result
  }, [enabled])

  const runSearch = useCallback(async (query: string) => {
    setRefreshing(true)
    setError(undefined)
    try {
      setSearch(await runForIdentity((identityLinkId) => searchNetVoxAudio(identityLinkId, query)))
    } catch (searchError) {
      setError(reason(searchError))
    } finally {
      setRefreshing(false)
    }
  }, [runForIdentity])

  const openDetail = useCallback(async (
    kind: Detail['kind'],
    id: string,
  ) => {
    setRefreshing(true)
    setError(undefined)
    try {
      if (kind === 'artist') {
        setDetail({ kind, value: await runForIdentity((identityLinkId) => fetchNetVoxAudioArtist(identityLinkId, id)) })
      } else if (kind === 'release') {
        setDetail({ kind, value: await runForIdentity((identityLinkId) => fetchNetVoxAudioRelease(identityLinkId, id)) })
      } else {
        setDetail({ kind, value: await runForIdentity((identityLinkId) => fetchNetVoxAudioPlaylist(identityLinkId, id)) })
      }
    } catch (detailError) {
      setError(reason(detailError))
    } finally {
      setRefreshing(false)
    }
  }, [runForIdentity])

  const mutate = useCallback(async <T,>(operation: (identityLinkId: string) => Promise<T>): Promise<T> => {
    if (mutating) throw new Error('Another VOX AUDIO library change is still being saved.')
    setMutating(true)
    setError(undefined)
    try {
      const result = await runForIdentity(operation)
      await load(true)
      return result
    } catch (mutationError) {
      setError(reason(mutationError))
      throw mutationError
    } finally {
      setMutating(false)
    }
  }, [load, mutating, runForIdentity])

  return {
    loading,
    refreshing,
    mutating,
    ...(error ? { error } : {}),
    ...(home ? { home } : {}),
    ...(library ? { library } : {}),
    ...(search ? { search } : {}),
    ...(detail ? { detail } : {}),
    reload: () => setReloadToken((value) => value + 1),
    runSearch,
    clearSearch: () => setSearch(undefined),
    openArtist: (id) => openDetail('artist', id),
    openRelease: (id) => openDetail('release', id),
    openPlaylist: (id) => openDetail('playlist', id),
    closeDetail: () => setDetail(undefined),
    setLiked: async (trackId, liked) => {
      await mutate((identityLinkId) => setNetVoxAudioTrackLiked(identityLinkId, trackId, liked))
      setSearch((current) => current ? {
        ...current,
        tracks: current.tracks.map((track) => track.id === trackId ? { ...track, liked } : track),
      } : current)
      setDetail((current) => current ? {
        ...current,
        value: {
          ...current.value,
          tracks: current.value.tracks.map((track) => track.id === trackId ? { ...track, liked } : track),
        },
      } as Detail : current)
    },
    savePlaylist: (input) => mutate((identityLinkId) => saveNetVoxAudioPersonalPlaylist(identityLinkId, input)),
    deletePlaylist: (id) => mutate((identityLinkId) => deleteNetVoxAudioPersonalPlaylist(identityLinkId, id)),
    setPlaylistTrack: async (playlistId, trackId, included) => {
      await mutate((identityLinkId) => setNetVoxAudioPersonalPlaylistTrack(identityLinkId, playlistId, trackId, included))
      if (detail?.kind === 'playlist' && detail.value.playlist.id === playlistId) {
        await openDetail('playlist', playlistId)
      }
    },
  }
}
