import { useCallback, useEffect, useRef, useState } from 'react'

import {
  clearNetIdentityWallpaper,
  fetchNetIdentitySystem,
  setNetIdentityAppInstalled,
  updateNetIdentityWallpaperPresentation,
  uploadNetIdentityWallpaper,
  type NetIdentitySystemSnapshot,
} from '../../../lib/netIdentitySystemService'
import type { WallpaperFit, WallpaperPosition } from '../../../lib/netWallpaperStore'
import type { NetOptionalAppId } from '../netAppCatalog'

export type NetIdentitySystemState =
  | { readonly status: 'unavailable' }
  | { readonly status: 'loading'; readonly identityLinkId: string }
  | { readonly status: 'ready'; readonly system: NetIdentitySystemSnapshot }
  | { readonly status: 'error'; readonly identityLinkId: string; readonly reason: string }

export interface NetIdentitySystemController {
  readonly state: NetIdentitySystemState
  readonly mutating: boolean
  readonly setAppInstalled: (appId: NetOptionalAppId, installed: boolean) => Promise<boolean>
  readonly setWallpaper: (
    file: File,
    fit: WallpaperFit,
    position: WallpaperPosition,
  ) => Promise<boolean>
  readonly updateWallpaperPresentation: (
    fit: WallpaperFit,
    position: WallpaperPosition,
  ) => Promise<boolean>
  readonly clearWallpaper: () => Promise<boolean>
  readonly reload: () => void
}

function loadFailureReason(error: unknown): string {
  return error instanceof Error ? error.message : 'Character system profile could not be synchronized.'
}

/**
 * The active identity link is the cache boundary. Every change immediately
 * returns the shell to safe defaults before any server result can render.
 */
export function useNetIdentitySystem(identityLinkId?: string): NetIdentitySystemController {
  const [state, setState] = useState<NetIdentitySystemState>({ status: 'unavailable' })
  const [mutating, setMutating] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const activeLinkRef = useRef<string | undefined>(identityLinkId)
  const stateRef = useRef<NetIdentitySystemState>(state)
  const mutationRef = useRef(false)

  activeLinkRef.current = identityLinkId
  stateRef.current = state

  useEffect(() => {
    activeLinkRef.current = identityLinkId
    mutationRef.current = false
    setMutating(false)
  }, [identityLinkId])

  useEffect(() => {
    let cancelled = false
    const expectedLinkId = identityLinkId

    if (!expectedLinkId) {
      const unavailableState = { status: 'unavailable' } as const
      stateRef.current = unavailableState
      setState(unavailableState)
      return () => { cancelled = true }
    }

    const loadingState = { status: 'loading', identityLinkId: expectedLinkId } as const
    stateRef.current = loadingState
    setState(loadingState)
    void fetchNetIdentitySystem(expectedLinkId)
      .then((system) => {
        if (cancelled || activeLinkRef.current !== expectedLinkId) return
        const readyState = { status: 'ready', system } as const
        stateRef.current = readyState
        setState(readyState)
      })
      .catch((error) => {
        if (cancelled || activeLinkRef.current !== expectedLinkId) return
        const errorState = {
          status: 'error',
          identityLinkId: expectedLinkId,
          reason: loadFailureReason(error),
        } as const
        stateRef.current = errorState
        setState(errorState)
      })

    return () => { cancelled = true }
  }, [identityLinkId, reloadToken])

  const runMutation = useCallback(async (
    operation: (system: NetIdentitySystemSnapshot) => Promise<NetIdentitySystemSnapshot>,
  ): Promise<boolean> => {
    const currentState = stateRef.current
    if (mutationRef.current || currentState.status !== 'ready') return false
    const expectedLinkId = currentState.system.identityLinkId
    if (activeLinkRef.current !== expectedLinkId) return false
    mutationRef.current = true
    setMutating(true)

    try {
      const system = await operation(currentState.system)
      if (activeLinkRef.current !== expectedLinkId || system.identityLinkId !== expectedLinkId) return false
      const readyState = { status: 'ready', system } as const
      stateRef.current = readyState
      setState(readyState)
      return true
    } finally {
      if (activeLinkRef.current === expectedLinkId) {
        mutationRef.current = false
        setMutating(false)
      }
    }
  }, [])

  const setAppInstalled = useCallback((appId: NetOptionalAppId, installed: boolean) => (
    runMutation(async (system) => {
      await setNetIdentityAppInstalled(system.identityLinkId, appId, installed)
      const nextIds = installed
        ? system.installedOptionalAppIds.includes(appId)
          ? system.installedOptionalAppIds
          : [...system.installedOptionalAppIds, appId]
        : system.installedOptionalAppIds.filter((candidate) => candidate !== appId)

      return { ...system, installedOptionalAppIds: nextIds }
    })
  ), [runMutation])

  const setWallpaper = useCallback((
    file: File,
    fit: WallpaperFit,
    position: WallpaperPosition,
  ) => runMutation(async (system) => ({
    ...system,
    wallpaper: await uploadNetIdentityWallpaper(system.identityLinkId, file, {
      fit,
      position,
      ...(system.wallpaper?.path ? { previousPath: system.wallpaper.path } : {}),
    }),
    updatedAt: new Date().toISOString(),
  })), [runMutation])

  const updateWallpaperPresentation = useCallback((
    fit: WallpaperFit,
    position: WallpaperPosition,
  ) => runMutation(async (system) => {
    if (!system.wallpaper) throw new Error('Upload a character wallpaper before changing its presentation.')
    return {
      ...system,
      wallpaper: await updateNetIdentityWallpaperPresentation(
        system.identityLinkId,
        system.wallpaper.path,
        fit,
        position,
      ),
      updatedAt: new Date().toISOString(),
    }
  }), [runMutation])

  const clearWallpaper = useCallback(() => runMutation(async (system) => {
    await clearNetIdentityWallpaper(system.identityLinkId, system.wallpaper?.path)
    return { ...system, wallpaper: null, updatedAt: new Date().toISOString() }
  }), [runMutation])

  const reload = useCallback(() => setReloadToken((value) => value + 1), [])

  const loadedIdentityLinkId = state.status === 'ready'
    ? state.system.identityLinkId
    : state.status === 'loading' || state.status === 'error'
      ? state.identityLinkId
      : undefined
  const exposedState: NetIdentitySystemState = !identityLinkId
    ? { status: 'unavailable' }
    : loadedIdentityLinkId === identityLinkId
      ? state
      : { status: 'loading', identityLinkId }

  return {
    state: exposedState,
    mutating: exposedState.status === 'ready' ? mutating : false,
    setAppInstalled,
    setWallpaper,
    updateWallpaperPresentation,
    clearWallpaper,
    reload,
  }
}
