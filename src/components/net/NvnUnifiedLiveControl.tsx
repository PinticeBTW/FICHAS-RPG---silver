import { RadioTower, Rows3 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { NvnLiveControl } from './NvnLiveControl'
import { NvnNewsroomConfirmation } from './NvnNewsroomControl'
import { NvnRadioControl } from './NvnRadioControl'
import type { CompleteNetNvnLocalMutation } from './useNetNvnRealtime'

type LiveControlSurface = 'broadcast' | 'incident'

interface NvnUnifiedLiveControlProps {
  readonly enabled: boolean
  readonly liveRealtimeInvalidationVersion: number
  readonly radioRealtimeInvalidationVersion: number
  readonly beginLiveMutation: () => CompleteNetNvnLocalMutation
  readonly beginRadioMutation: () => CompleteNetNvnLocalMutation
  readonly onDirtyChange: (dirty: boolean) => void
  readonly onNotice: (message: string) => void
  readonly onRadioStateChanged: () => void
}

export function NvnUnifiedLiveControl({
  enabled,
  liveRealtimeInvalidationVersion,
  radioRealtimeInvalidationVersion,
  beginLiveMutation,
  beginRadioMutation,
  onDirtyChange,
  onNotice,
  onRadioStateChanged,
}: NvnUnifiedLiveControlProps) {
  const [surface, setSurface] = useState<LiveControlSurface>('broadcast')
  const [surfaceDirty, setSurfaceDirty] = useState(false)
  const [requestedSurface, setRequestedSurface] = useState<LiveControlSurface | null>(null)

  useEffect(() => {
    onDirtyChange(surfaceDirty)
    return () => onDirtyChange(false)
  }, [onDirtyChange, surfaceDirty])

  const openSurface = (next: LiveControlSurface) => {
    if (next === surface) return
    if (surfaceDirty) {
      setRequestedSurface(next)
      return
    }
    setSurface(next)
  }

  return (
    <section className="nvn-unified-live-control" aria-label="NVN Live Control">
      <header className="nvn-unified-live-control__header">
        <div>
          <span>GM system · Live Control</span>
          <h2>NVN Live Control</h2>
          <p>Broadcast authority and the text incident desk share one editorial workspace.</p>
        </div>
        <nav aria-label="LIVE Control surfaces">
          <button
            type="button"
            data-active={surface === 'broadcast' ? 'true' : undefined}
            aria-current={surface === 'broadcast' ? 'page' : undefined}
            onClick={() => openSurface('broadcast')}
          >
            <RadioTower size={14} aria-hidden="true" /> Broadcast
          </button>
          <button
            type="button"
            data-active={surface === 'incident' ? 'true' : undefined}
            aria-current={surface === 'incident' ? 'page' : undefined}
            onClick={() => openSurface('incident')}
          >
            <Rows3 size={14} aria-hidden="true" /> Incident desk
          </button>
        </nav>
      </header>

      <div className="nvn-unified-live-control__surface">
        {surface === 'broadcast' ? (
          <NvnRadioControl
            enabled={enabled}
            realtimeInvalidationVersion={radioRealtimeInvalidationVersion}
            beginLocalMutation={beginRadioMutation}
            onDirtyChange={setSurfaceDirty}
            onNotice={onNotice}
            onRadioStateChanged={onRadioStateChanged}
          />
        ) : (
          <NvnLiveControl
            enabled={enabled}
            realtimeInvalidationVersion={liveRealtimeInvalidationVersion}
            beginLocalMutation={beginLiveMutation}
            onDirtyChange={setSurfaceDirty}
            onNotice={onNotice}
          />
        )}
      </div>

      {requestedSurface ? (
        <NvnNewsroomConfirmation
          title="Discard unsaved LIVE changes?"
          body="Switching LIVE surfaces will discard local editorial changes that have not been saved."
          confirmLabel="Discard and switch"
          tone="danger"
          onCancel={() => setRequestedSurface(null)}
          onConfirm={() => {
            setSurfaceDirty(false)
            setSurface(requestedSurface)
            setRequestedSurface(null)
          }}
        />
      ) : null}
    </section>
  )
}
