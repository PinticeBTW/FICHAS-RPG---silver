import {
  inspectNetNvnRadioAudio,
  signNetNvnCurrentRadioObject,
} from '../../lib/netNvnRadioService'
import {
  NewsPlatformBroadcastControl,
} from './news/NewsPlatformBroadcastControl'
import type { CompleteNetNvnLocalMutation } from './useNetNvnRealtime'
import { useNetNvnGmRadioControl } from './useNetNvnGmRadioControl'

interface NvnRadioControlProps {
  readonly enabled: boolean
  readonly realtimeInvalidationVersion: number
  readonly beginLocalMutation: () => CompleteNetNvnLocalMutation
  readonly onDirtyChange: (dirty: boolean) => void
  readonly onNotice: (message: string) => void
  readonly onRadioStateChanged: () => void
}

const NVN_BROADCAST_CONFIG = {
  classNamePrefix: 'nvn',
  ariaLabel: 'NVN Live Broadcast Control',
  eyebrow: 'Broadcast desk',
  title: 'NVN Live Broadcast',
  networkCopy: 'One global station clock. Listener actions never alter the broadcast.',
  budgetLabel: 'NVN audio budget',
  noticePrefix: 'NVN LIVE',
  dialogBackdropClassName: 'nvn-newsroom-dialog-backdrop',
  dialogClassName: 'nvn-newsroom-dialog',
  unavailableCopy: 'LIVE Broadcast Control could not synchronize.',
} as const

export function NvnRadioControl({
  enabled,
  realtimeInvalidationVersion,
  beginLocalMutation,
  onDirtyChange,
  onNotice,
  onRadioStateChanged,
}: NvnRadioControlProps) {
  const nvnController = useNetNvnGmRadioControl(enabled, realtimeInvalidationVersion)
  const controller = {
    ...nvnController,
    inspectAudio: inspectNetNvnRadioAudio,
    signClip: signNetNvnCurrentRadioObject,
  }

  return (
    <NewsPlatformBroadcastControl
      controller={controller}
      config={NVN_BROADCAST_CONFIG}
      beginMutation={beginLocalMutation}
      onDirtyChange={onDirtyChange}
      onNotice={onNotice}
      onBroadcastStateChanged={onRadioStateChanged}
    />
  )
}
