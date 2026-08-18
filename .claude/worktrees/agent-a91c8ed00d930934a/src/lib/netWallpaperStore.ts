export type WallpaperFit = 'cover' | 'contain'
export type WallpaperPosition = 'center' | 'top' | 'bottom'

export interface StoredWallpaper {
  blob: Blob
  fit: WallpaperFit
  position: WallpaperPosition
  updatedAt: number
}

const DB_NAME = 'rpgsilver-net-os'
const DB_VERSION = 1
const STORE_NAME = 'wallpapers'

export const WALLPAPER_MAX_BYTES = 10 * 1024 * 1024
export const WALLPAPER_ACCEPTED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveWallpaper(
  userId: string,
  blob: Blob,
  fit: WallpaperFit,
  position: WallpaperPosition,
): Promise<void> {
  const db = await openDb()

  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')

      const record: StoredWallpaper = {
        blob,
        fit,
        position,
        updatedAt: Date.now(),
      }

      tx.objectStore(STORE_NAME).put(record, userId)

      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export async function loadWallpaper(
  userId: string,
): Promise<StoredWallpaper | null> {
  const db = await openDb()

  try {
    return await new Promise<StoredWallpaper | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')

      const request = tx.objectStore(STORE_NAME).get(userId)

      request.onsuccess = () => {
        resolve((request.result as StoredWallpaper | undefined) ?? null)
      }

      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

export async function deleteWallpaper(userId: string): Promise<void> {
  const db = await openDb()

  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')

      tx.objectStore(STORE_NAME).delete(userId)

      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export function wallpaperPositionToCss(position: WallpaperPosition): string {
  if (position === 'top') return 'center top'
  if (position === 'bottom') return 'center bottom'
  return 'center center'
}

export function validateWallpaperFile(file: File): string | null {
  if (
    !WALLPAPER_ACCEPTED_TYPES.includes(
      file.type as (typeof WALLPAPER_ACCEPTED_TYPES)[number],
    )
  ) {
    return 'Only PNG, JPG/JPEG and WEBP images are supported.'
  }

  if (file.size > WALLPAPER_MAX_BYTES) {
    return 'Image is too large. Maximum file size is 10 MB.'
  }

  return null
}
