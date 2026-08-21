const NET_MESSENGER_NOTIFICATION_SOUND_URL = '/sounds/silver-alert.mp3'
const NOTIFICATION_COOLDOWN_MS = 450

let notificationAudio: HTMLAudioElement | null = null
let lastNotificationAt = 0

function audioContextConstructor() {
  if (typeof window === 'undefined') return undefined
  return window.AudioContext
    || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
}

async function playFallbackTone() {
  const AudioContextCtor = audioContextConstructor()
  if (!AudioContextCtor) return

  const context = new AudioContextCtor()
  try {
    if (context.state === 'suspended') await context.resume()

    const gain = context.createGain()
    gain.connect(context.destination)
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.1, context.currentTime + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.38)

    const firstTone = context.createOscillator()
    firstTone.type = 'sine'
    firstTone.frequency.setValueAtTime(660, context.currentTime)
    firstTone.connect(gain)
    firstTone.start(context.currentTime)
    firstTone.stop(context.currentTime + 0.16)

    const secondTone = context.createOscillator()
    secondTone.type = 'sine'
    secondTone.frequency.setValueAtTime(880, context.currentTime + 0.16)
    secondTone.connect(gain)
    secondTone.start(context.currentTime + 0.16)
    secondTone.stop(context.currentTime + 0.38)
  } catch {
    // Notification audio is cosmetic and must never affect Messenger state.
  } finally {
    window.setTimeout(() => void context.close(), 650)
  }
}

/**
 * Plays one restrained network-message alert. Browsers may reject media
 * autoplay before the user has interacted with the page, so a generated
 * two-tone chime is attempted as a non-fatal fallback.
 */
export async function playNetMessengerNotificationSound() {
  if (typeof window === 'undefined') return

  const now = Date.now()
  if (now - lastNotificationAt < NOTIFICATION_COOLDOWN_MS) return
  lastNotificationAt = now

  try {
    if (!notificationAudio) {
      notificationAudio = new Audio(NET_MESSENGER_NOTIFICATION_SOUND_URL)
      notificationAudio.preload = 'auto'
      notificationAudio.volume = 0.55
    }
    notificationAudio.currentTime = 0
    await notificationAudio.play()
  } catch {
    await playFallbackTone()
  }
}
