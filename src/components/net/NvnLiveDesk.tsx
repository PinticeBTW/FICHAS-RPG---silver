import { NewsPlatformLiveTimeline } from './news/NewsPlatformLiveTimeline'
import { adaptNvnIncident } from './news/nvnNewsPlatformAdapter'
import { NvnReaderFeedback, NvnRefreshStrip } from './NvnReaderFeedback'
import { NvnRadioDesk } from './NvnRadioDesk'
import type { NvnRadioController } from './useNetNvnRadio'
import { useNetNvnLiveDesk } from './useNetNvnLiveDesk'

function NvnIncidentDesk({
  enabled,
  realtimeInvalidationVersion,
  expectedIdentityLinkId,
}: {
  readonly enabled: boolean
  readonly realtimeInvalidationVersion: number
  readonly expectedIdentityLinkId?: string
}) {
  const live = useNetNvnLiveDesk(
    enabled,
    realtimeInvalidationVersion,
    expectedIdentityLinkId,
  )
  if (live.phase === 'loading' && !live.desk) return <NvnReaderFeedback title="Synchronizing live desk" detail="Retrieving the bounded authoritative incident ledger." loading />
  if (live.phase === 'failed' && !live.desk) return <NvnReaderFeedback title="Live desk unavailable" detail={live.error ?? 'The NVN live ledger could not be reached.'} error onRetry={live.retry} />

  return (
    <>
      {live.refreshing ? <NvnRefreshStrip message="LIVE ledger synchronizing…" /> : null}
      {live.error ? <NvnRefreshStrip message={live.error} error onRetry={live.retry} /> : null}
      <NewsPlatformLiveTimeline
        classNamePrefix="nvn"
        incident={live.desk ? adaptNvnIncident(live.desk) : undefined}
        emptyTitle="No active live incident"
        emptyCopy="There is no active NVN incident ledger on this grid."
        onRefresh={live.retry}
        refreshDisabled={live.refreshing}
      />
    </>
  )
}

export function NvnLiveDesk({
  enabled,
  realtimeInvalidationVersion,
  expectedIdentityLinkId,
  radio,
}: {
  readonly enabled: boolean
  readonly realtimeInvalidationVersion: number
  readonly expectedIdentityLinkId?: string
  readonly radio: NvnRadioController
}) {
  return (
    <div className="nvn-live-broadcast-stack">
      <NvnRadioDesk radio={radio} />
      <NvnIncidentDesk
        enabled={enabled}
        realtimeInvalidationVersion={realtimeInvalidationVersion}
        expectedIdentityLinkId={expectedIdentityLinkId}
      />
    </div>
  )
}
