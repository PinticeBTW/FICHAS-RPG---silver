export type NetWindowSnap = 'none' | 'left' | 'right'

export interface NetWindowRect {
  x: number
  y: number
  width: number
  height: number
}

export interface StoredNetWindowLayout {
  rect: NetWindowRect
  restoreRect?: NetWindowRect
  snap: NetWindowSnap
  maximized: boolean
  updatedAt: number
}

export type StoredNetWindowLayouts = Record<string, StoredNetWindowLayout>

const DB_NAME = 'rpgsilver-net-window-layouts'
const DB_VERSION = 1
const STORE_NAME = 'layouts'

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

export async function loadNetWindowLayouts(
  userId: string,
  allowedWindowIds?: readonly string[],
): Promise<StoredNetWindowLayouts> {
  const db = await openDb()

  try {
    const stored = await new Promise<StoredNetWindowLayouts>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(userId)

      request.onsuccess = () => {
        resolve((request.result as StoredNetWindowLayouts | undefined) ?? {})
      }
      request.onerror = () => reject(request.error)
    })

    if (!allowedWindowIds) return stored

    const allowed = new Set(allowedWindowIds)
    const current = Object.fromEntries(
      Object.entries(stored).filter(([windowId]) => allowed.has(windowId)),
    ) satisfies StoredNetWindowLayouts

    if (Object.keys(current).length === Object.keys(stored).length) return current

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put(current, userId)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })

    return current
  } finally {
    db.close()
  }
}

export async function saveNetWindowLayout(
  userId: string,
  windowId: string,
  layout: Omit<StoredNetWindowLayout, 'updatedAt'>,
): Promise<void> {
  const db = await openDb()

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(userId)

      request.onsuccess = () => {
        const existing = (request.result as StoredNetWindowLayouts | undefined) ?? {}
        store.put(
          {
            ...existing,
            [windowId]: { ...layout, updatedAt: Date.now() },
          } satisfies StoredNetWindowLayouts,
          userId,
        )
      }
      request.onerror = () => reject(request.error)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}

export async function deleteNetWindowLayouts(userId: string): Promise<void> {
  const db = await openDb()

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).delete(userId)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}
