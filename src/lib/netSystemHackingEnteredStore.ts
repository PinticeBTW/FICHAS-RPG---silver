const STORAGE_PREFIX = 'rpgsilver-net-system-hacking-entered'
export const NET_SYSTEM_HACKING_ENTERED_CHANGED_EVENT = 'net:system-hacking-entered-changed'

function storageKey(profileId: string): string {
  return `${STORAGE_PREFIX}:${profileId}`
}

/**
 * Purely a client-side "am I currently looking at the hacked target's
 * desktop, or still my own" toggle -- the server-side authority for whether
 * hacking access exists at all is net_system_hacking_sessions, unaffected
 * by this. A stale true left over after the underlying session already
 * ended is harmless: every consumer treats "entered" as meaningful only
 * when combined with an actually-active session.
 */
export function readNetSystemHackingEntered(profileId: string): boolean {
  if (!profileId) return false
  try {
    return window.localStorage.getItem(storageKey(profileId)) === 'true'
  } catch {
    return false
  }
}

export function writeNetSystemHackingEntered(profileId: string, entered: boolean): void {
  if (!profileId) return
  try {
    if (entered) window.localStorage.setItem(storageKey(profileId), 'true')
    else window.localStorage.removeItem(storageKey(profileId))
  } catch {
    // Best-effort only; the in-memory hook state still updates for this tab.
  }

  window.dispatchEvent(new CustomEvent(NET_SYSTEM_HACKING_ENTERED_CHANGED_EVENT, {
    detail: { profileId, entered },
  }))
}

export function isNetSystemHackingEnteredStorageEvent(
  event: StorageEvent,
  profileId: string,
): boolean {
  return event.storageArea === window.localStorage && event.key === storageKey(profileId)
}
