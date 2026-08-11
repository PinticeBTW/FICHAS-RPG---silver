import type {
  MediaOptimizationProfile,
  OptimizedMediaResult,
  OptimizedMediaVariant,
} from './mediaTypes'

const MAX_INPUT_BYTES = 20 * 1024 * 1024
const MAX_DECODED_PIXELS = 64_000_000
const MIN_SAVINGS_RATIO = 0.92

const PROFILE_RULES = {
  avatar: { maxLongEdge: 512, quality: 0.88, maxBytes: 10 * 1024 * 1024, thumbnail: 224, thumbnailQuality: 0.84 },
  wallpaper: { maxLongEdge: 2560, quality: 0.90, maxBytes: 15 * 1024 * 1024 },
  general: { maxLongEdge: 1800, quality: 0.88, maxBytes: 15 * 1024 * 1024 },
  'small-ui': { maxLongEdge: 512, quality: 0.94, maxBytes: 5 * 1024 * 1024 },
} as const

const RASTER_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])

export function validateImageInput(file: Blob, profile: MediaOptimizationProfile): string | null {
  const rules = PROFILE_RULES[profile]
  if (!file.type || !RASTER_MIME_TYPES.has(file.type)) {
    return file.type === 'image/svg+xml'
      ? 'User-uploaded SVG is not accepted for security reasons.'
      : 'Use a JPEG, PNG, WebP, AVIF, or animated GIF image.'
  }
  if (file.size <= 0) return 'The selected image is empty.'
  if (file.size > Math.min(MAX_INPUT_BYTES, rules.maxBytes)) {
    return `The selected image exceeds the ${Math.floor(rules.maxBytes / 1024 / 1024)} MB upload limit.`
  }
  return null
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
    else setTimeout(resolve, 0)
  })
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function containsAscii(bytes: Uint8Array, token: string): boolean {
  const needle = new TextEncoder().encode(token)
  outer: for (let index = 0; index <= bytes.length - needle.length; index += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (bytes[index + offset] !== needle[offset]) continue outer
    }
    return true
  }
  return false
}

async function isAnimated(file: Blob): Promise<boolean> {
  if (file.type === 'image/gif') return true
  if (file.type !== 'image/webp' && file.type !== 'image/avif') return false
  const header = new Uint8Array(await file.slice(0, Math.min(file.size, 128 * 1024)).arrayBuffer())
  return file.type === 'image/webp' ? containsAscii(header, 'ANIM') : containsAscii(header, 'trak')
}

async function decodeImage(file: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== 'function') throw new Error('This browser cannot safely process images.')
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('The selected file is not a decodable image.')
  }
}

function dimensionsFor(width: number, height: number, maxLongEdge: number) {
  const longEdge = Math.max(width, height)
  if (longEdge <= maxLongEdge) return { width, height }
  const scale = maxLongEdge / longEdge
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

function canvasBlob(canvas: HTMLCanvasElement | OffscreenCanvas, type: string, quality: number): Promise<Blob> {
  if (canvas instanceof HTMLCanvasElement) {
    return new Promise((resolve, reject) => canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('The browser could not encode this image.')),
      type,
      quality,
    ))
  }
  return canvas.convertToBlob({ type, quality })
}

async function encodeVariant(
  bitmap: ImageBitmap,
  maxLongEdge: number,
  quality: number,
  name: OptimizedMediaVariant['name'],
): Promise<OptimizedMediaVariant> {
  const size = dimensionsFor(bitmap.width, bitmap.height, maxLongEdge)
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(size.width, size.height)
    : Object.assign(document.createElement('canvas'), size)
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) throw new Error('The browser could not prepare the image canvas.')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, size.width, size.height)
  const blob = await canvasBlob(canvas, 'image/webp', quality)
  return { name, blob, mimeType: 'image/webp', width: size.width, height: size.height, extension: 'webp' }
}

function originalExtension(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/svg+xml') return 'svg'
  if (mimeType === 'image/gif') return 'gif'
  if (mimeType === 'image/avif') return 'avif'
  return mimeType.split('/')[1] || 'bin'
}

/**
 * Browser-native optimizer shared by every user-media upload. SVG is rejected
 * here: preserving unsanitized user SVG would create a script/XSS surface.
 * Static, reviewed SVG assets remain untouched by this pipeline.
 */
export async function optimizeImage(
  file: Blob,
  profile: MediaOptimizationProfile,
): Promise<OptimizedMediaResult> {
  const rules = PROFILE_RULES[profile]
  const validationError = validateImageInput(file, profile)
  if (validationError) throw new Error(validationError)

  await yieldToBrowser()
  const bitmap = await decodeImage(file)
  try {
    if (bitmap.width * bitmap.height > MAX_DECODED_PIXELS) {
      throw new Error('The selected image dimensions are too large to process safely.')
    }

    if (await isAnimated(file)) {
      return {
        profile,
        contentHash: await sha256(file),
        originalByteSize: file.size,
        preservedOriginal: true,
        variants: [{
          name: 'display', blob: file, mimeType: file.type,
          width: bitmap.width, height: bitmap.height, extension: originalExtension(file.type),
        }],
      }
    }

    const displayCandidate = await encodeVariant(bitmap, rules.maxLongEdge, rules.quality, 'display')
    const withinDisplayBounds = Math.max(bitmap.width, bitmap.height) <= rules.maxLongEdge
    const efficientOriginal = withinDisplayBounds
      && ['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type)
      && displayCandidate.blob.size >= file.size * MIN_SAVINGS_RATIO
    const display = efficientOriginal ? {
      name: 'display' as const,
      blob: file,
      mimeType: file.type,
      width: bitmap.width,
      height: bitmap.height,
      extension: originalExtension(file.type),
    } : displayCandidate

    const variants: OptimizedMediaVariant[] = [display]
    if (profile === 'avatar') {
      const avatarRules = PROFILE_RULES.avatar
      variants.push(await encodeVariant(bitmap, avatarRules.thumbnail, avatarRules.thumbnailQuality, 'thumbnail'))
    }
    return {
      profile,
      contentHash: await sha256(display.blob),
      originalByteSize: file.size,
      variants,
      preservedOriginal: display.blob === file,
    }
  } finally {
    bitmap.close()
  }
}

export async function optimizeCanvasBlob(blob: Blob, profile: MediaOptimizationProfile): Promise<OptimizedMediaResult> {
  return optimizeImage(blob, profile)
}
