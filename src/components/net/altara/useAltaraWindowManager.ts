import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  loadNetWindowLayouts,
  saveNetWindowLayout,
  type NetWindowRect,
  type NetWindowSnap,
  type StoredNetWindowLayout,
  type StoredNetWindowLayouts,
} from '../../../lib/netWindowLayoutStore'
import {
  clampNetWindowRect,
  getMaximizedNetWindowRect,
  getNetDesktopBounds,
  getSnappedNetWindowRect,
} from '../netWindowGeometry'
import {
  altaraAppCatalog,
  getAltaraAppDefinition,
  type AltaraAppId,
} from './altaraAppCatalog'

interface AltaraWindowState {
  readonly open: boolean
  readonly minimized: boolean
  readonly maximized: boolean
  readonly zIndex: number
  readonly rect: NetWindowRect
  readonly restoreRect?: NetWindowRect
  readonly snap: NetWindowSnap
}

type SnapPreview = {
  readonly id: AltaraAppId
  readonly snap: 'left' | 'right' | 'maximize'
} | null

const WINDOW_BASE_Z_INDEX = 40

/** Every locally remembered window id, shared with VEIL's own persistence
 * (see netWindowLayoutStore.ts) under the same per-profile record --
 * AltaraAppId strings never collide with VEIL's NetWindowId strings. */
const ALTARA_WINDOW_IDS: readonly AltaraAppId[] = altaraAppCatalog.map((app) => app.id)

function getInitialViewport() {
  return {
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 800 : window.innerHeight,
  }
}

function createDefaultRect(id: AltaraAppId, width: number, height: number): NetWindowRect {
  const bounds = getNetDesktopBounds(width, height)
  const definition = getAltaraAppDefinition(id)
  const cascade = Math.max(0, altaraAppCatalog.findIndex((app) => app.id === id)) * 24
  const windowWidth = Math.min(definition.window.width, bounds.width)
  const windowHeight = Math.min(definition.window.height, bounds.height)

  return clampNetWindowRect({
    x: bounds.left + 76 + cascade,
    y: bounds.top + 26 + cascade,
    width: windowWidth,
    height: windowHeight,
  }, definition.window, bounds)
}

function createClosedState(id: AltaraAppId, width: number, height: number): AltaraWindowState {
  return {
    open: false,
    minimized: false,
    maximized: false,
    zIndex: 0,
    rect: createDefaultRect(id, width, height),
    snap: 'none',
  }
}

/** Same remembered-state reconstruction VEIL uses: a locally saved rect is
 * only ever a starting point, re-clamped against the current viewport so a
 * window can never reopen off-screen after a resolution/window-size change. */
function getRememberedState(
  id: AltaraAppId,
  saved: StoredNetWindowLayouts,
  width: number,
  height: number,
): AltaraWindowState {
  const stored = saved[id]
  if (!stored) return createClosedState(id, width, height)

  const bounds = getNetDesktopBounds(width, height)
  const definition = getAltaraAppDefinition(id)
  const restoreRect = stored.restoreRect
    ? clampNetWindowRect(stored.restoreRect, definition.window, bounds)
    : undefined
  const rect = stored.maximized
    ? getMaximizedNetWindowRect(bounds)
    : stored.snap !== 'none'
      ? getSnappedNetWindowRect(stored.snap, bounds)
      : clampNetWindowRect(stored.rect, definition.window, bounds)

  return {
    open: false,
    minimized: false,
    maximized: stored.maximized,
    zIndex: 0,
    rect,
    ...(restoreRect ? { restoreRect } : {}),
    snap: stored.snap,
  }
}

export function useAltaraWindowManager(profileId?: string) {
  const [viewport, setViewport] = useState(getInitialViewport)
  const [windows, setWindows] = useState<Partial<Record<AltaraAppId, AltaraWindowState>>>({})
  const [snapPreview, setSnapPreview] = useState<SnapPreview>(null)
  const zIndexCounterRef = useRef(0)
  const bounds = useMemo(
    () => getNetDesktopBounds(viewport.width, viewport.height),
    [viewport.height, viewport.width],
  )
  const boundsRef = useRef(bounds)
  const viewportRef = useRef(viewport)
  const isMobile = viewport.width <= 760
  const savedLayoutsRef = useRef<StoredNetWindowLayouts>({})
  const layoutWriteRef = useRef<Promise<void>>(Promise.resolve())
  const profileIdRef = useRef(profileId)

  useEffect(() => {
    profileIdRef.current = profileId
  }, [profileId])

  const nextZIndex = useCallback(() => {
    zIndexCounterRef.current += 1
    return zIndexCounterRef.current
  }, [])

  const readWindow = useCallback((id: AltaraAppId): AltaraWindowState => (
    windows[id] ?? getRememberedState(id, savedLayoutsRef.current, viewport.width, viewport.height)
  ), [viewport.height, viewport.width, windows])

  const visibleRect = useCallback((id: AltaraAppId, state = readWindow(id)) => {
    if (isMobile || state.maximized) return getMaximizedNetWindowRect(bounds)
    if (state.snap !== 'none') return getSnappedNetWindowRect(state.snap, bounds)
    return clampNetWindowRect(state.rect, getAltaraAppDefinition(id).window, bounds)
  }, [bounds, isMobile, readWindow])

  const persistLayout = useCallback((id: AltaraAppId, state: AltaraWindowState) => {
    const userId = profileIdRef.current
    if (!userId) return

    const layout: Omit<StoredNetWindowLayout, 'updatedAt'> = {
      rect: state.rect,
      ...(state.restoreRect ? { restoreRect: state.restoreRect } : {}),
      snap: state.snap,
      maximized: state.maximized,
    }

    savedLayoutsRef.current = {
      ...savedLayoutsRef.current,
      [id]: { ...layout, updatedAt: Date.now() },
    }
    layoutWriteRef.current = layoutWriteRef.current
      .catch(() => undefined)
      .then(() => saveNetWindowLayout(userId, id, layout))
      .catch(() => {
        // Layout persistence is a local convenience; current geometry remains usable.
      })
  }, [])

  const openWindow = useCallback((id: AltaraAppId) => {
    setWindows((current) => {
      const existing = current[id] ?? getRememberedState(
        id,
        savedLayoutsRef.current,
        viewportRef.current.width,
        viewportRef.current.height,
      )
      return {
        ...current,
        [id]: {
          ...existing,
          open: true,
          minimized: false,
          zIndex: nextZIndex(),
        },
      }
    })
  }, [nextZIndex])

  const closeWindow = useCallback((id: AltaraAppId) => {
    setSnapPreview((current) => current?.id === id ? null : current)
    setWindows((current) => {
      const existing = current[id]
      if (!existing) return current
      return { ...current, [id]: { ...existing, open: false, minimized: false } }
    })
  }, [])

  const minimizeWindow = useCallback((id: AltaraAppId) => {
    setSnapPreview((current) => current?.id === id ? null : current)
    setWindows((current) => {
      const existing = current[id]
      if (!existing?.open) return current
      return { ...current, [id]: { ...existing, minimized: true } }
    })
  }, [])

  const focusWindow = useCallback((id: AltaraAppId) => {
    setWindows((current) => {
      const existing = current[id]
      if (!existing?.open || existing.minimized) return current
      return { ...current, [id]: { ...existing, zIndex: nextZIndex() } }
    })
  }, [nextZIndex])

  const toggleMaximize = useCallback((id: AltaraAppId) => {
    const existing = windows[id] ?? getRememberedState(
      id,
      savedLayoutsRef.current,
      viewportRef.current.width,
      viewportRef.current.height,
    )
    const definition = getAltaraAppDefinition(id)
    const normalRect = clampNetWindowRect(
      existing.restoreRect ?? existing.rect,
      definition.window,
      boundsRef.current,
    )
    const next: AltaraWindowState = existing.maximized
      ? {
          ...existing,
          maximized: false,
          minimized: false,
          rect: normalRect,
          restoreRect: undefined,
          snap: 'none',
          zIndex: nextZIndex(),
        }
      : {
          ...existing,
          maximized: true,
          minimized: false,
          rect: getMaximizedNetWindowRect(boundsRef.current),
          restoreRect: normalRect,
          snap: 'none',
          zIndex: nextZIndex(),
        }

    setWindows((current) => ({ ...current, [id]: next }))
    // The remembered "normal" position is the pre-maximize restoreRect, not
    // the maximized rect itself -- persisting here (not just on commitRect)
    // means toggling maximize can never corrupt or lose that position.
    persistLayout(id, next)
  }, [nextZIndex, persistLayout, windows])

  const commitRect = useCallback((id: AltaraAppId, rect: NetWindowRect) => {
    const existing = windows[id] ?? getRememberedState(
      id,
      savedLayoutsRef.current,
      viewportRef.current.width,
      viewportRef.current.height,
    )
    const next: AltaraWindowState = {
      ...existing,
      rect: clampNetWindowRect(rect, getAltaraAppDefinition(id).window, boundsRef.current),
    }

    setWindows((current) => ({ ...current, [id]: next }))
    persistLayout(id, next)
  }, [persistLayout, windows])

  const prepareDrag = useCallback((id: AltaraAppId, pointerX: number, pointerY: number) => {
    const current = windows[id] ?? getRememberedState(
      id,
      savedLayoutsRef.current,
      viewportRef.current.width,
      viewportRef.current.height,
    )
    const currentRect = visibleRect(id, current)
    const definition = getAltaraAppDefinition(id)
    const normalRect = clampNetWindowRect(
      current.restoreRect ?? current.rect,
      definition.window,
      boundsRef.current,
    )
    const grabOffset = Math.min(
      normalRect.width - 72,
      Math.max(72, ((pointerX - currentRect.x) / Math.max(currentRect.width, 1)) * normalRect.width),
    )
    const restoredRect = clampNetWindowRect({
      ...normalRect,
      x: pointerX - grabOffset,
      y: pointerY - 22,
    }, definition.window, boundsRef.current)

    setWindows((allWindows) => ({
      ...allWindows,
      [id]: {
        ...current,
        maximized: false,
        minimized: false,
        rect: restoredRect,
        restoreRect: undefined,
        snap: 'none',
        zIndex: nextZIndex(),
      },
    }))
    return restoredRect
  }, [nextZIndex, visibleRect, windows])

  const applySnap = useCallback((id: AltaraAppId, snap: 'left' | 'right' | 'maximize') => {
    const existing = windows[id] ?? getRememberedState(
      id,
      savedLayoutsRef.current,
      viewportRef.current.width,
      viewportRef.current.height,
    )
    const definition = getAltaraAppDefinition(id)
    const normalRect = clampNetWindowRect(
      existing.restoreRect ?? existing.rect,
      definition.window,
      boundsRef.current,
    )
    const next: AltaraWindowState = snap === 'maximize'
      ? {
          ...existing,
          maximized: true,
          minimized: false,
          rect: getMaximizedNetWindowRect(boundsRef.current),
          restoreRect: normalRect,
          snap: 'none',
          zIndex: nextZIndex(),
        }
      : {
          ...existing,
          maximized: false,
          minimized: false,
          rect: getSnappedNetWindowRect(snap, boundsRef.current),
          restoreRect: normalRect,
          snap,
          zIndex: nextZIndex(),
        }

    setWindows((current) => ({ ...current, [id]: next }))
    persistLayout(id, next)
  }, [nextZIndex, persistLayout, windows])

  const handleSnapPreview = useCallback((
    id: AltaraAppId,
    preview: 'left' | 'right' | 'maximize' | null,
  ) => {
    setSnapPreview((current) => {
      if (!preview) return current?.id === id ? null : current
      if (current?.id === id && current.snap === preview) return current
      return { id, snap: preview }
    })
  }, [])

  useEffect(() => {
    boundsRef.current = bounds
    viewportRef.current = viewport
  }, [bounds, viewport])

  useEffect(() => {
    const updateViewport = () => setViewport({
      width: window.innerWidth,
      height: window.innerHeight,
    })
    window.addEventListener('resize', updateViewport)
    return () => window.removeEventListener('resize', updateViewport)
  }, [])

  useEffect(() => {
    let cancelled = false
    savedLayoutsRef.current = {}

    if (!profileId) return () => { cancelled = true }

    loadNetWindowLayouts(profileId, ALTARA_WINDOW_IDS)
      .then((layouts) => {
        if (cancelled || profileIdRef.current !== profileId) return
        savedLayoutsRef.current = layouts
      })
      .catch(() => {
        // Default placement remains available if IndexedDB is unavailable.
      })

    return () => { cancelled = true }
  }, [profileId])

  const openVisibleIds = useMemo(() => (
    (Object.entries(windows) as [AltaraAppId, AltaraWindowState][])
      .filter(([, state]) => state.open && !state.minimized)
      .sort((left, right) => left[1].zIndex - right[1].zIndex)
      .map(([id]) => id)
  ), [windows])
  const focusedId = openVisibleIds.at(-1) ?? null

  const activateTaskbarApp = useCallback((id: AltaraAppId) => {
    const state = windows[id]
    if (!state?.open || state.minimized) {
      openWindow(id)
      return
    }
    if (focusedId === id) {
      minimizeWindow(id)
      return
    }
    focusWindow(id)
  }, [focusWindow, focusedId, minimizeWindow, openWindow, windows])

  const getManagedProps = useCallback((id: AltaraAppId) => {
    const state = readWindow(id)
    const rank = openVisibleIds.indexOf(id)
    return {
      isOpen: state.open,
      isMinimized: state.minimized,
      isMaximized: state.maximized,
      isSnapped: state.snap !== 'none',
      isFocused: focusedId === id,
      zIndex: rank < 0 ? WINDOW_BASE_Z_INDEX : WINDOW_BASE_Z_INDEX + rank,
      rect: visibleRect(id, state),
      bounds,
      constraints: getAltaraAppDefinition(id).window,
      isMobile,
      onClose: () => closeWindow(id),
      onMinimize: () => minimizeWindow(id),
      onToggleMaximize: () => toggleMaximize(id),
      onFocus: () => focusWindow(id),
      onPrepareDrag: (pointerX: number, pointerY: number) => prepareDrag(id, pointerX, pointerY),
      onRectCommit: (rect: NetWindowRect) => commitRect(id, rect),
      onSnap: (snap: 'left' | 'right' | 'maximize') => applySnap(id, snap),
      onSnapPreviewChange: (preview: 'left' | 'right' | 'maximize' | null) => (
        handleSnapPreview(id, preview)
      ),
    }
  }, [
    applySnap,
    bounds,
    closeWindow,
    commitRect,
    focusWindow,
    focusedId,
    handleSnapPreview,
    isMobile,
    minimizeWindow,
    openVisibleIds,
    prepareDrag,
    readWindow,
    toggleMaximize,
    visibleRect,
  ])

  const snapPreviewRect = useMemo(() => {
    if (!snapPreview || isMobile) return null
    return snapPreview.snap === 'maximize'
      ? getMaximizedNetWindowRect(bounds)
      : getSnappedNetWindowRect(snapPreview.snap, bounds)
  }, [bounds, isMobile, snapPreview])

  return {
    windows,
    focusedId,
    isMobile,
    snapPreviewRect,
    openWindow,
    closeWindow,
    activateTaskbarApp,
    getManagedProps,
  }
}
