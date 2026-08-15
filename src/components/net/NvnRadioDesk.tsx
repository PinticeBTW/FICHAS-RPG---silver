import type { NetNvnRadioClipKind } from '../../lib/netNvnRadioTypes'
import { NewsPlatformBroadcastPlayer } from './news/NewsPlatformBroadcastPlayer'
import type { NvnRadioController } from './useNetNvnRadio'

const CLIP_KIND_LABELS: Record<NetNvnRadioClipKind, string> = {
  news: 'City news',
  bulletin: 'Special bulletin',
  'station-id': 'Station identification',
  jingle: 'Station interval',
  advertisement: 'Commercial transmission',
  weather: 'Weather desk',
  traffic: 'Traffic desk',
  interview: 'Interview',
  'public-service': 'Public service',
  ambience: 'City ambience',
  other: 'NVN programme',
}

export function NvnRadioDesk({ radio }: { readonly radio: NvnRadioController }) {
  const current = radio.tuneState?.current
  const authoritativeOnAir = radio.tuneState?.stationStatus === 'on-air' && Boolean(current)
  return (
    <NewsPlatformBroadcastPlayer
      classNamePrefix="nvn"
      broadcast={{
        productLabel: 'NVN Live Broadcast',
        programmeLabel: 'City News Network',
        status: authoritativeOnAir
          ? radio.tuneState?.mode === 'breaking' ? 'breaking' : 'on-air'
          : radio.phase === 'loading' || radio.phase === 'ready-to-tune'
            ? 'synchronizing'
            : radio.phase,
        ...(current?.publicLabel ? { currentLabel: current.publicLabel } : {}),
        ...(current ? { currentKindLabel: CLIP_KIND_LABELS[current.clipKind] } : {}),
        transmissionLabel: radio.tuneState?.mode === 'play-now'
          ? 'Special bulletin'
          : current ? CLIP_KIND_LABELS[current.clipKind] : 'Live bulletin',
        ...(current ? { startedAt: current.startedAt, endsAt: current.endsAt } : {}),
        modeKey: radio.tuneState?.mode ?? 'rotation',
        joining: radio.phase === 'loading',
        tunedCopy: 'Live carrier locked. This transmission follows the citywide station clock.',
        untunedCopy: 'Tune in to join the transmission at its current live position.',
        synchronizingCopy: 'Synchronizing the citywide carrier…',
        offAirCopy: 'NVN Live Broadcast is not transmitting on the public grid.',
        tuned: radio.tuned,
        muted: radio.muted,
        volume: radio.volume,
        syncing: radio.syncing,
        ...(radio.error ? { error: radio.error } : {}),
        onTuneIn: radio.tuneIn,
        onTuneOut: radio.tuneOut,
        onRetry: radio.retry,
        onMutedChange: radio.setMuted,
        onVolumeChange: radio.setVolume,
      }}
    />
  )
}
