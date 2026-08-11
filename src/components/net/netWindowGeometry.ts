import type { NetWindowRect, NetWindowSnap } from '../../lib/netWindowLayoutStore'

export interface NetDesktopBounds {
  left: number
  top: number
  width: number
  height: number
}

export interface NetWindowConstraints {
  minWidth: number
  minHeight: number
}

const TITLEBAR_VISIBLE_WIDTH = 96
const TITLEBAR_HEIGHT = 46

export function getNetDesktopBounds(viewportWidth: number, viewportHeight: number): NetDesktopBounds {
  const mobile = viewportWidth <= 760
  const left = mobile ? 0 : 16
  const right = mobile ? 0 : 16
  const top = mobile ? 58 : 62
  const bottom = mobile ? 78 : 92

  return {
    left,
    top,
    width: Math.max(0, viewportWidth - left - right),
    height: Math.max(0, viewportHeight - top - bottom),
  }
}

export function getBoundsRight(bounds: NetDesktopBounds) {
  return bounds.left + bounds.width
}

export function getBoundsBottom(bounds: NetDesktopBounds) {
  return bounds.top + bounds.height
}

export function clampNetWindowRect(
  rect: NetWindowRect,
  constraints: NetWindowConstraints,
  bounds: NetDesktopBounds,
): NetWindowRect {
  const width = Math.min(
    Math.max(Math.min(constraints.minWidth, bounds.width), rect.width),
    bounds.width,
  )
  const height = Math.min(
    Math.max(Math.min(constraints.minHeight, bounds.height), rect.height),
    bounds.height,
  )
  const minX = bounds.left - Math.max(0, width - TITLEBAR_VISIBLE_WIDTH)
  const maxX = getBoundsRight(bounds) - TITLEBAR_VISIBLE_WIDTH
  const minY = bounds.top
  const maxY = getBoundsBottom(bounds) - Math.min(TITLEBAR_HEIGHT, height)

  return {
    x: Math.min(Math.max(rect.x, minX), Math.max(minX, maxX)),
    y: Math.min(Math.max(rect.y, minY), Math.max(minY, maxY)),
    width,
    height,
  }
}

export function getSnappedNetWindowRect(
  snap: Exclude<NetWindowSnap, 'none'>,
  bounds: NetDesktopBounds,
): NetWindowRect {
  const width = Math.floor(bounds.width / 2)

  return {
    x: snap === 'left' ? bounds.left : bounds.left + width,
    y: bounds.top,
    width: snap === 'left' ? width : bounds.width - width,
    height: bounds.height,
  }
}

export function getMaximizedNetWindowRect(bounds: NetDesktopBounds): NetWindowRect {
  return {
    x: bounds.left,
    y: bounds.top,
    width: bounds.width,
    height: bounds.height,
  }
}
