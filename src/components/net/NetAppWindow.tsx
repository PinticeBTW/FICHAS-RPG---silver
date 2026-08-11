import { Minus, Square, SquareStack, X, type LucideIcon } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

import type { NetWindowRect } from '../../lib/netWindowLayoutStore'
import {
  clampNetWindowRect,
  type NetDesktopBounds,
  type NetWindowConstraints,
} from './netWindowGeometry'

type ResizeDirection =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

type SnapPreview = 'left' | 'right' | 'maximize' | null

type ActiveInteraction = {
  kind: 'drag' | 'resize'
  pointerId: number
  startX: number
  startY: number
  startRect: NetWindowRect
  direction?: ResizeDirection
}

interface NetAppWindowProps {
  title: string
  subtitle?: string
  icon: LucideIcon
  accentRgb: string
  isOpen: boolean
  isMinimized: boolean
  isMaximized: boolean
  isSnapped: boolean
  isFocused?: boolean
  zIndex?: number
  rect: NetWindowRect
  bounds: NetDesktopBounds
  constraints: NetWindowConstraints
  isMobile: boolean
  onClose: () => void
  onMinimize: () => void
  onToggleMaximize: () => void
  onFocus?: () => void
  onPrepareDrag: (pointerX: number, pointerY: number) => NetWindowRect
  onRectCommit: (rect: NetWindowRect) => void
  onSnap: (snap: 'left' | 'right' | 'maximize') => void
  onSnapPreviewChange?: (preview: SnapPreview) => void
  children: ReactNode
}

const SNAP_THRESHOLD = 36

function getSnapPreview(
  pointerX: number,
  pointerY: number,
  bounds: NetDesktopBounds,
): SnapPreview {
  if (pointerY <= bounds.top + SNAP_THRESHOLD) return 'maximize'
  if (pointerX <= bounds.left + SNAP_THRESHOLD) return 'left'
  if (pointerX >= bounds.left + bounds.width - SNAP_THRESHOLD) return 'right'
  return null
}

function resizeRect(
  startRect: NetWindowRect,
  direction: ResizeDirection,
  deltaX: number,
  deltaY: number,
  constraints: NetWindowConstraints,
  bounds: NetDesktopBounds,
) {
  const right = startRect.x + startRect.width
  const bottom = startRect.y + startRect.height
  const minWidth = Math.min(constraints.minWidth, bounds.width)
  const minHeight = Math.min(constraints.minHeight, bounds.height)
  let left = startRect.x
  let top = startRect.y
  let nextRight = right
  let nextBottom = bottom

  if (direction.includes('left')) {
    left = Math.min(Math.max(bounds.left, startRect.x + deltaX), right - minWidth)
  }
  if (direction.includes('right')) {
    nextRight = Math.max(Math.min(bounds.left + bounds.width, right + deltaX), left + minWidth)
  }
  if (direction.includes('top')) {
    top = Math.min(Math.max(bounds.top, startRect.y + deltaY), bottom - minHeight)
  }
  if (direction.includes('bottom')) {
    nextBottom = Math.max(Math.min(bounds.top + bounds.height, bottom + deltaY), top + minHeight)
  }

  return clampNetWindowRect(
    {
      x: left,
      y: top,
      width: nextRight - left,
      height: nextBottom - top,
    },
    constraints,
    bounds,
  )
}

export function NetAppWindow({
  title,
  subtitle,
  icon: Icon,
  accentRgb,
  isOpen,
  isMinimized,
  isMaximized,
  isSnapped,
  isFocused = true,
  zIndex,
  rect,
  bounds,
  constraints,
  isMobile,
  onClose,
  onMinimize,
  onToggleMaximize,
  onFocus,
  onPrepareDrag,
  onRectCommit,
  onSnap,
  onSnapPreviewChange,
  children,
}: NetAppWindowProps) {
  const lastPointerFocusAtRef = useRef(0)
  const interactionRef = useRef<ActiveInteraction | null>(null)
  const previewRef = useRef<SnapPreview>(null)
  const [transientRect, setTransientRect] = useState<NetWindowRect | null>(null)
  const transientRectRef = useRef<NetWindowRect | null>(null)
  const snapPreviewChangeRef = useRef(onSnapPreviewChange)

  snapPreviewChangeRef.current = onSnapPreviewChange

  const visibleRect = transientRect ?? rect

  useEffect(() => {
    if (!interactionRef.current) {
      transientRectRef.current = null
      setTransientRect(null)
    }
  }, [rect.x, rect.y, rect.width, rect.height])

  useEffect(() => {
    return () => snapPreviewChangeRef.current?.(null)
  }, [])

  if (!isOpen) return null

  const setPreview = (preview: SnapPreview) => {
    if (previewRef.current === preview) return
    previewRef.current = preview
    snapPreviewChangeRef.current?.(preview)
  }

  const updateTransientRect = (nextRect: NetWindowRect | null) => {
    transientRectRef.current = nextRect
    setTransientRect(nextRect)
  }

  const finishInteraction = (cancelled = false) => {
    const interaction = interactionRef.current
    if (!interaction) return

    interactionRef.current = null
    const preview = previewRef.current
    setPreview(null)
    const finalRect = transientRectRef.current ?? rect
    updateTransientRect(null)

    if (!cancelled && interaction.kind === 'drag' && preview) {
      onSnap(preview)
      return
    }

    onRectCommit(finalRect)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const interaction = interactionRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return

    const deltaX = event.clientX - interaction.startX
    const deltaY = event.clientY - interaction.startY

    if (interaction.kind === 'drag') {
      updateTransientRect(
        clampNetWindowRect(
          {
            ...interaction.startRect,
            x: interaction.startRect.x + deltaX,
            y: interaction.startRect.y + deltaY,
          },
          constraints,
          bounds,
        ),
      )
      setPreview(getSnapPreview(event.clientX, event.clientY, bounds))
      return
    }

    updateTransientRect(
      resizeRect(
        interaction.startRect,
        interaction.direction!,
        deltaX,
        deltaY,
        constraints,
        bounds,
      ),
    )
  }

  const beginInteraction = (
    event: ReactPointerEvent<HTMLElement>,
    kind: ActiveInteraction['kind'],
    direction?: ResizeDirection,
  ) => {
    if (event.button !== 0 || isMobile || isMinimized) return

    onFocus?.()
    lastPointerFocusAtRef.current = Date.now()

    const startRect =
      kind === 'drag' && (isMaximized || isSnapped)
        ? onPrepareDrag(event.clientX, event.clientY)
        : visibleRect

    interactionRef.current = {
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRect,
      direction,
    }
    updateTransientRect(startRect)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const style = {
    '--app-rgb': accentRgb,
    left: `${visibleRect.x}px`,
    top: `${visibleRect.y}px`,
    width: `${visibleRect.width}px`,
    height: `${visibleRect.height}px`,
    ...(typeof zIndex === 'number' ? { zIndex } : {}),
  } as CSSProperties

  return (
    <section
      className="net-app-window"
      style={style}
      data-minimized={isMinimized ? 'true' : 'false'}
      data-maximized={isMaximized ? 'true' : 'false'}
      data-snapped={isSnapped ? 'true' : 'false'}
      data-focused={isFocused ? 'true' : 'false'}
      role="dialog"
      aria-label={title}
      aria-hidden={isMinimized ? 'true' : 'false'}
      onMouseDown={() => {
        lastPointerFocusAtRef.current = Date.now()
        onFocus?.()
      }}
      onFocusCapture={(event) => {
        const previousFocus = event.relatedTarget
        if (
          (previousFocus instanceof Node && event.currentTarget.contains(previousFocus)) ||
          Date.now() - lastPointerFocusAtRef.current < 100
        ) return
        onFocus?.()
      }}
    >
      <header
        className="net-app-window__bar"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('button, a, input, select, textarea, [data-no-window-drag]')) return
          beginInteraction(event, 'drag')
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={() => finishInteraction()}
        onPointerCancel={() => finishInteraction(true)}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) return
          onToggleMaximize()
        }}
      >
        <div className="net-app-window__identity">
          <span className="net-app-window__icon"><Icon size={15} strokeWidth={1.8} /></span>
          <div className="net-app-window__titles">
            <strong>{title}</strong>
            {subtitle ? <small>{subtitle}</small> : null}
          </div>
        </div>

        <div className="net-app-window__controls">
          <button type="button" onClick={onMinimize} aria-label={`Minimize ${title}`} title="Minimize"><Minus size={13} /></button>
          {!isMobile ? (
            <button type="button" onClick={onToggleMaximize} aria-label={isMaximized ? `Restore ${title}` : `Maximize ${title}`} title={isMaximized ? 'Restore' : 'Maximize'}>
              {isMaximized ? <SquareStack size={12} /> : <Square size={12} />}
            </button>
          ) : null}
          <button type="button" className="net-app-window__close" onClick={onClose} aria-label={`Close ${title}`} title="Close"><X size={14} /></button>
        </div>
      </header>

      <div className="net-app-window__body">{children}</div>

      {!isMobile && !isMaximized && !isSnapped ? (
        <div className="net-app-window__resize-layer" aria-hidden="true">
          {(['left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((direction) => (
            <div
              key={direction}
              className="net-app-window__resize-handle"
              data-direction={direction}
              onPointerDown={(event) => beginInteraction(event, 'resize', direction)}
              onPointerMove={handlePointerMove}
              onPointerUp={() => finishInteraction()}
              onPointerCancel={() => finishInteraction(true)}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}
