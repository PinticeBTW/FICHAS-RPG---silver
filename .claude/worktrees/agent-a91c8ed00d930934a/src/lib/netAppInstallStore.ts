import {
  isNetOptionalAppId,
  type NetOptionalAppId,
} from '../components/net/netAppCatalog'

const DB_NAME = 'rpgsilver-net-app-library'
const DB_VERSION = 1
const STORE_NAME = 'installations'

type StoredNetAppInstallations = {
  optionalAppIds: NetOptionalAppId[]
  updatedAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function normalizeAppIds(value: unknown): NetOptionalAppId[] {
  if (!Array.isArray(value)) return []

  return [...new Set(value.filter((id): id is NetOptionalAppId =>
    typeof id === 'string' && isNetOptionalAppId(id),
  ))]
}

export async function loadInstalledApps(userId: string): Promise<NetOptionalAppId[]> {
  const database = await openDb()

  try {
    return await new Promise<NetOptionalAppId[]>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(userId)
      request.onsuccess = () => {
        const stored = request.result as StoredNetAppInstallations | undefined
        resolve(normalizeAppIds(stored?.optionalAppIds))
      }
      request.onerror = () => reject(request.error)
    })
  } finally {
    database.close()
  }
}

export async function saveInstalledApps(
  userId: string,
  appIds: readonly NetOptionalAppId[],
): Promise<void> {
  const database = await openDb()
  const optionalAppIds = normalizeAppIds(appIds)

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put(
        { optionalAppIds, updatedAt: Date.now() } satisfies StoredNetAppInstallations,
        userId,
      )
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}

export async function installApp(userId: string, appId: NetOptionalAppId): Promise<NetOptionalAppId[]> {
  const installed = await loadInstalledApps(userId)
  const next = installed.includes(appId) ? installed : [...installed, appId]
  await saveInstalledApps(userId, next)
  return next
}

export async function uninstallApp(userId: string, appId: NetOptionalAppId): Promise<NetOptionalAppId[]> {
  const next = (await loadInstalledApps(userId)).filter((id) => id !== appId)
  await saveInstalledApps(userId, next)
  return next
}
