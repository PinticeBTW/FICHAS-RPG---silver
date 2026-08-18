import { Check, Minus, Plus, RotateCcw, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function clampOffset(offset: { x: number; y: number }, maxX: number, maxY: number) {
  return {
    x: clamp(offset.x, -maxX, maxX),
    y: clamp(offset.y, -maxY, maxY),
  }
}

interface ImageCropDialogProps {
  source: string
  title?: string
  description?: string
  aspectRatio: number
  outputWidth: number
  outputHeight?: number
  accentColor?: string
  onCancel: () => void
  onConfirm: (blob: Blob) => void | Promise<void>
}

export function ImageCropDialog({
  source,
  title = 'Ajustar foto',
  description = 'Arrasta a imagem e usa o zoom ate ficar no enquadramento certo.',
  aspectRatio,
  outputWidth,
  outputHeight,
  accentColor = '#f3e600',
  onCancel,
  onConfirm,
}: ImageCropDialogProps) {
  const safeAspectRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1
  const finalOutputHeight = outputHeight ?? Math.max(1, Math.round(outputWidth / safeAspectRatio))
  const imageRef = useRef<HTMLImageElement | null>(null)
  const dragStateRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startOffsetX: number
    startOffsetY: number
  } | null>(null)
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [processingError, setProcessingError] = useState<string | null>(null)

  const previewSize = useMemo(() => {
    const maxLongEdge = 380

    if (safeAspectRatio >= 1) {
      return {
        width: maxLongEdge,
        height: Math.max(180, Math.round(maxLongEdge / safeAspectRatio)),
      }
    }

    return {
      width: Math.max(220, Math.round(maxLongEdge * safeAspectRatio)),
      height: maxLongEdge,
    }
  }, [safeAspectRatio])

  const coverScale = useMemo(() => {
    if (!naturalSize.width || !naturalSize.height) {
      return 1
    }

    return Math.max(previewSize.width / naturalSize.width, previewSize.height / naturalSize.height)
  }, [naturalSize.height, naturalSize.width, previewSize.height, previewSize.width])

  const displayedWidth = naturalSize.width * coverScale * zoom
  const displayedHeight = naturalSize.height * coverScale * zoom
  const maxOffsetX = Math.max(0, (displayedWidth - previewSize.width) / 2)
  const maxOffsetY = Math.max(0, (displayedHeight - previewSize.height) / 2)
  const clampedOffset = useMemo(
    () => clampOffset(offset, maxOffsetX, maxOffsetY),
    [maxOffsetX, maxOffsetY, offset],
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  const handleZoomChange = (nextZoom: number) => {
    setZoom(clamp(nextZoom, 1, 3))
  }

  const resetCrop = () => {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!naturalSize.width || !naturalSize.height) {
      return
    }

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffsetX: clampedOffset.x,
      startOffsetY: clampedOffset.y,
    }
    setIsDragging(true)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return
    }

    const nextOffset = clampOffset(
      {
        x: dragState.startOffsetX + (event.clientX - dragState.startX),
        y: dragState.startOffsetY + (event.clientY - dragState.startY),
      },
      maxOffsetX,
      maxOffsetY,
    )

    setOffset(nextOffset)
  }

  const finishDragging = (event?: React.PointerEvent<HTMLDivElement>) => {
    if (event && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    dragStateRef.current = null
    setIsDragging(false)
  }

  const handleConfirm = async () => {
    const image = imageRef.current

    if (!image || !naturalSize.width || !naturalSize.height || !displayedWidth || !displayedHeight) {
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = outputWidth
    canvas.height = finalOutputHeight
    const context = canvas.getContext('2d')

    if (!context) {
      return
    }

    const scaleToNatural = naturalSize.width / displayedWidth
    const sourceWidth = previewSize.width * scaleToNatural
    const sourceHeight = previewSize.height * scaleToNatural
    const unclampedX = ((displayedWidth - previewSize.width) / 2 - clampedOffset.x) * scaleToNatural
    const unclampedY = ((displayedHeight - previewSize.height) / 2 - clampedOffset.y) * scaleToNatural
    const sourceX = clamp(unclampedX, 0, Math.max(0, naturalSize.width - sourceWidth))
    const sourceY = clamp(unclampedY, 0, Math.max(0, naturalSize.height - sourceHeight))

    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    )

    setProcessing(true)
    setProcessingError(null)
    try {
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error('Falha a preparar a imagem.')),
        'image/webp',
        0.96,
      ))
      await onConfirm(blob)
    } catch (error) {
      setProcessingError(error instanceof Error ? error.message : 'Falha a preparar a imagem.')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-[28px] border border-white/10 bg-[#0b0b0b] p-5 text-white shadow-[0_24px_90px_rgba(0,0,0,0.55)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="panel-title">Foto</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">{title}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-stone-400">{description}</p>
          </div>

          <button
            type="button"
            onClick={onCancel}
            disabled={processing}
            className="signal-button inline-flex h-10 w-10 items-center justify-center p-0 text-sm"
            data-variant="ghost"
            title="Fechar"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_270px]">
          <div className="flex min-w-0 items-center justify-center rounded-[24px] border border-white/10 bg-black/30 p-4">
            <div
              className="relative overflow-hidden rounded-[20px] border bg-black/40 shadow-[0_0_0_1px_rgba(255,255,255,0.06)]"
              style={{
                width: `${previewSize.width}px`,
                height: `${previewSize.height}px`,
                borderColor: `${accentColor}55`,
              }}
            >
              <div
                className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={finishDragging}
                onPointerCancel={finishDragging}
                style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
              >
                <img
                  ref={imageRef}
                  src={source}
                  alt=""
                  draggable={false}
                  onLoad={(event) => {
                    setNaturalSize({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    })
                    resetCrop()
                  }}
                  className="pointer-events-none absolute select-none"
                  style={{
                    left: '50%',
                    top: '50%',
                    width: `${displayedWidth}px`,
                    height: `${displayedHeight}px`,
                    maxWidth: 'none',
                    transform: `translate(calc(-50% + ${clampedOffset.x}px), calc(-50% + ${clampedOffset.y}px))`,
                  }}
                />

                <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]" />
                <div
                  className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_2px]"
                  style={{ color: `${accentColor}66` }}
                />
              </div>
            </div>
          </div>

          {processingError ? <p role="alert" className="text-sm text-rose-300">{processingError}</p> : null}

          <div className="space-y-4 rounded-[24px] border border-white/10 bg-black/25 p-4">
            <div>
              <p className="panel-title text-stone-400">Zoom</p>
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleZoomChange(zoom - 0.1)}
                  className="signal-button inline-flex h-10 w-10 items-center justify-center p-0 text-sm"
                  data-variant="ghost"
                  title="Diminuir zoom"
                >
                  <Minus size={14} />
                </button>

                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.01}
                  value={zoom}
                  onChange={(event) => handleZoomChange(Number(event.target.value))}
                  className="w-full"
                  style={{ accentColor }}
                />

                <button
                  type="button"
                  onClick={() => handleZoomChange(zoom + 0.1)}
                  className="signal-button inline-flex h-10 w-10 items-center justify-center p-0 text-sm"
                  data-variant="ghost"
                  title="Aumentar zoom"
                >
                  <Plus size={14} />
                </button>
              </div>
              <p className="mt-2 text-sm text-stone-400">{Math.round(zoom * 100)}%</p>
            </div>

            <div className="rounded-[18px] border border-white/10 bg-black/25 px-4 py-3 text-sm leading-7 text-stone-400">
              Arrasta a foto para a esquerda, direita, cima ou baixo ate ficar como queres.
            </div>

            <button
              type="button"
              onClick={resetCrop}
              className="signal-button inline-flex items-center gap-2 px-4 py-2 text-sm"
              data-variant="ghost"
            >
              <RotateCcw size={14} />
              Repor enquadramento
            </button>

            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="button"
                onClick={handleConfirm}
                disabled={processing}
                className="signal-button inline-flex items-center gap-2 px-4 py-2 text-sm"
              >
                <Check size={14} />
                {processing ? 'A processar…' : 'Usar foto'}
              </button>
              <button
                type="button"
                onClick={onCancel}
                disabled={processing}
                className="signal-button inline-flex items-center gap-2 px-4 py-2 text-sm"
                data-variant="ghost"
              >
                <X size={14} />
                Cancelar
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
