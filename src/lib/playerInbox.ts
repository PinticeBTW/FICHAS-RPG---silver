export type PlayerInboxMessage = {
  id: string
  title: string
  body: string
  senderProfileId: string
  senderName: string
  sentAt: string
  readAt?: string
  archivedAt?: string
}

export type SilverMessageRecipientOption = {
  id: string
  label: string
}

export const PLAYER_MESSAGES_FIELD_KEY = 'PLAYER_MESSAGES'
const PLAYER_INBOX_SOUND_URL = '/sounds/silver-alert.mp3'

export function parsePlayerInboxMessages(value: string): PlayerInboxMessage[] {
  if (!value.trim()) {
    return []
  }

  try {
    const parsed = JSON.parse(value)

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => {
        const safeEntry = entry as Record<string, unknown>

        return {
          id: typeof safeEntry.id === 'string' ? safeEntry.id : crypto.randomUUID(),
          title: typeof safeEntry.title === 'string' ? safeEntry.title : '',
          body: typeof safeEntry.body === 'string' ? safeEntry.body : '',
          senderProfileId:
            typeof safeEntry.senderProfileId === 'string' ? safeEntry.senderProfileId : '',
          senderName: typeof safeEntry.senderName === 'string' ? safeEntry.senderName : 'Silver',
          sentAt:
            typeof safeEntry.sentAt === 'string'
              ? safeEntry.sentAt
              : new Date().toISOString(),
          readAt: typeof safeEntry.readAt === 'string' ? safeEntry.readAt : undefined,
          archivedAt: typeof safeEntry.archivedAt === 'string' ? safeEntry.archivedAt : undefined,
        }
      })
      .sort((left, right) => new Date(right.sentAt).getTime() - new Date(left.sentAt).getTime())
  } catch {
    return []
  }
}

export function serializePlayerInboxMessages(messages: PlayerInboxMessage[]) {
  return JSON.stringify(messages)
}

export function mergePlayerInboxMessageValues(localValue: string, remoteValue: string) {
  const localMessages = parsePlayerInboxMessages(localValue)
  const remoteMessages = parsePlayerInboxMessages(remoteValue)
  const localById = new Map(localMessages.map((message) => [message.id, message]))
  const remoteById = new Map(remoteMessages.map((message) => [message.id, message]))
  const mergedIds = Array.from(new Set([...remoteById.keys(), ...localById.keys()]))

  const mergedMessages = mergedIds
    .map((id) => {
      const remoteMessage = remoteById.get(id)
      const localMessage = localById.get(id)

      if (remoteMessage && localMessage) {
        return {
          ...remoteMessage,
          readAt: localMessage.readAt ?? remoteMessage.readAt,
          archivedAt: localMessage.archivedAt ?? remoteMessage.archivedAt,
        }
      }

      return remoteMessage ?? localMessage ?? null
    })
    .filter((message): message is PlayerInboxMessage => message !== null)
    .sort((left, right) => new Date(right.sentAt).getTime() - new Date(left.sentAt).getTime())

  return serializePlayerInboxMessages(mergedMessages)
}

export function buildPlayerInboxMessage({
  title,
  body,
  senderProfileId,
  senderName,
}: {
  title: string
  body: string
  senderProfileId: string
  senderName: string
}): PlayerInboxMessage {
  return {
    id: crypto.randomUUID(),
    title: title.trim(),
    body: body.trim(),
    senderProfileId,
    senderName,
    sentAt: new Date().toISOString(),
  }
}

export function getUnreadPlayerInboxCount(messages: PlayerInboxMessage[]) {
  return messages.filter((message) => !message.readAt && !message.archivedAt).length
}

export async function playPlayerInboxAlert() {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const audio = new Audio(PLAYER_INBOX_SOUND_URL)
    audio.volume = 0.75
    await audio.play()
    return
  } catch {
    // Fallback para um beep simples quando o browser bloquear autoplay.
  }

  const AudioContextCtor =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

  if (!AudioContextCtor) {
    return
  }

  const context = new AudioContextCtor()
  const gain = context.createGain()
  gain.connect(context.destination)
  gain.gain.setValueAtTime(0.0001, context.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.14, context.currentTime + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.42)

  const oscillator = context.createOscillator()
  oscillator.type = 'triangle'
  oscillator.frequency.setValueAtTime(720, context.currentTime)
  oscillator.frequency.linearRampToValueAtTime(1040, context.currentTime + 0.16)
  oscillator.frequency.linearRampToValueAtTime(860, context.currentTime + 0.3)
  oscillator.connect(gain)
  oscillator.start()
  oscillator.stop(context.currentTime + 0.44)

  window.setTimeout(() => {
    void context.close()
  }, 700)
}
