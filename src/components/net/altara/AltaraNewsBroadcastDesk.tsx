import type { NetAltaraNewsBroadcastClipKind } from '../../../lib/netAltaraNewsBroadcastTypes'
import { NewsPlatformBroadcastPlayer } from '../news/NewsPlatformBroadcastPlayer'
import type { AltaraNewsBroadcastController } from './useNetAltaraNewsBroadcast'

const kindLabels: Record<NetAltaraNewsBroadcastClipKind, string> = {
  news: 'Global news',
  bulletin: 'Special bulletin',
  'station-id': 'Network identification',
  jingle: 'Network interval',
  advertisement: 'Commercial transmission',
  weather: 'Weather desk',
  traffic: 'Transit desk',
  interview: 'Interview',
  'public-service': 'Public service',
  ambience: 'Network ambience',
  other: 'ALTARA programme',
}

export function AltaraNewsBroadcastDesk({
  broadcast,
}: {
  readonly broadcast: AltaraNewsBroadcastController
}) {
  const current = broadcast.tuneState?.current
  const onAir = broadcast.tuneState?.stationStatus === 'on-air' && Boolean(current)
  return (
    <NewsPlatformBroadcastPlayer
      classNamePrefix="altara-news"
      broadcast={{
        productLabel: 'ALTARA NEWS Broadcast',
        programmeLabel: 'Global Network Radio',
        status: onAir
          ? broadcast.tuneState?.mode === 'breaking' ? 'breaking' : 'on-air'
          : broadcast.phase === 'loading' || broadcast.phase === 'ready-to-tune'
            ? 'synchronizing'
            : broadcast.phase,
        ...(current?.publicLabel ? { currentLabel: current.publicLabel } : {}),
        ...(current ? { currentKindLabel: kindLabels[current.clipKind] } : {}),
        transmissionLabel: broadcast.tuneState?.mode === 'play-now'
          ? 'Special network bulletin'
          : current ? kindLabels[current.clipKind] : 'Global live carrier',
        ...(current ? { startedAt: current.startedAt, endsAt: current.endsAt } : {}),
        modeKey: broadcast.tuneState?.mode ?? 'rotation',
        joining: broadcast.phase === 'loading',
        tunedCopy: 'Carrier locked to the shared ALTARA network clock across every connected city.',
        untunedCopy: 'Tune in to join the global transmission at its current live position.',
        synchronizingCopy: 'Synchronizing the global ALTARA carrier…',
        offAirCopy: 'No active broadcast on the ALTARA global network.',
        tuned: broadcast.tuned,
        muted: broadcast.muted,
        volume: broadcast.volume,
        syncing: broadcast.syncing,
        ...(broadcast.error ? { error: broadcast.error } : {}),
        onTuneIn: broadcast.tuneIn,
        onTuneOut: broadcast.tuneOut,
        onRetry: broadcast.retry,
        onMutedChange: broadcast.setMuted,
        onVolumeChange: broadcast.setVolume,
      }}
    />
  )
}
