import { isNetOsId, type NetOsId } from './netOsTypes'

const STORAGE_PREFIX = 'rpgsilver-gm-system-os'
export const NET_GM_WORKSPACE_CHANGED_EVENT = 'net:gm-workspace-changed'

function storageKey(profileId: string): string {
  return `${STORAGE_PREFIX}:${profileId}`
}

export function readNetGmWorkspace(profileId: string): NetOsId {
  if (!profileId) return 'veil'
  try {
    const stored = window.localStorage.getItem(storageKey(profileId))
    return isNetOsId(stored) ? stored : 'veil'
  } catch {
    return 'veil'
  }
}

export function writeNetGmWorkspace(profileId: string, osId: NetOsId): void {
  if (!profileId || !isNetOsId(osId)) {
    throw new Error('A supported GM system environment is required.')
  }

  try {
    window.localStorage.setItem(storageKey(profileId), osId)
  } catch {
    throw new Error('The GM workspace preference could not be stored in this browser.')
  }

  window.dispatchEvent(new CustomEvent(NET_GM_WORKSPACE_CHANGED_EVENT, {
    detail: { profileId, osId },
  }))
}

export function isNetGmWorkspaceStorageEvent(
  event: StorageEvent,
  profileId: string,
): boolean {
  return event.storageArea === window.localStorage && event.key === storageKey(profileId)
}
