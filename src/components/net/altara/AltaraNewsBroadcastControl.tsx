import {
  NewsPlatformBroadcastControl,
} from '../news/NewsPlatformBroadcastControl'
import { useNetAltaraNewsGmBroadcastControl } from './useNetAltaraNewsGmBroadcastControl'

const ALTARA_BROADCAST_CONFIG = {
  classNamePrefix: 'altara-news',
  ariaLabel: 'ALTARA NEWS Broadcast Control',
  eyebrow: 'Broadcast desk · synchronized audio',
  title: 'ALTARA NEWS Broadcast',
  networkCopy: 'One global ALTARA station clock shared across every connected city. Listener controls never alter the authoritative broadcast.',
  budgetLabel: 'ALTARA secure audio budget',
  noticePrefix: 'NEWSROOM',
  dialogBackdropClassName: 'altara-newsroom-dialog-backdrop',
  dialogClassName: 'altara-newsroom-dialog',
  unavailableCopy: 'The synchronized audio desk is unavailable.',
} as const

export function AltaraNewsBroadcastControl({
  enabled,
  onNotice,
}: {
  readonly enabled: boolean
  readonly onNotice: (message: string) => void
}) {
  const controller = useNetAltaraNewsGmBroadcastControl(enabled)

  return (
    <NewsPlatformBroadcastControl
      controller={controller}
      config={ALTARA_BROADCAST_CONFIG}
      onNotice={onNotice}
    />
  )
}
