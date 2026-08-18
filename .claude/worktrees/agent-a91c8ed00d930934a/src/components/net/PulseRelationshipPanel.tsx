import { ArrowLeft, RefreshCw } from 'lucide-react'

import type {
  NetPulseAccountSummary,
  NetPulseRelationshipDirection,
} from '../../lib/netPulseEngagementService'
import type { PulseAccount } from './pulseData'
import { PulseAccountSearchResults } from './PulseAccountSearchResults'
import { PulseLoadMore } from './PulseLoadMore'

interface PulseRelationshipPanelProps {
  readonly profile: PulseAccount
  readonly direction: NetPulseRelationshipDirection
  readonly results: readonly NetPulseAccountSummary[]
  readonly loading: boolean
  readonly hasMore: boolean
  readonly loadingMore: boolean
  readonly error?: string
  readonly currentAccountId: string | null
  readonly canFollow: boolean
  readonly pendingAccountIds: ReadonlySet<string>
  readonly isFollowing: (account: NetPulseAccountSummary) => boolean
  readonly onBack: () => void
  readonly onRetry: () => void
  readonly onLoadMore: () => void
  readonly onOpenProfile: (accountId: string) => void
  readonly onToggleFollow: (accountId: string) => void
}

export function PulseRelationshipPanel({
  profile,
  direction,
  results,
  loading,
  hasMore,
  loadingMore,
  error,
  currentAccountId,
  canFollow,
  pendingAccountIds,
  isFollowing,
  onBack,
  onRetry,
  onLoadMore,
  onOpenProfile,
  onToggleFollow,
}: PulseRelationshipPanelProps) {
  const title = direction === 'followers' ? 'FOLLOWERS' : 'FOLLOWING'
  return (
    <div className="pulse-relationships">
      <button type="button" className="pulse-back" onClick={onBack}>
        <ArrowLeft size={14} /> Back
      </button>
      <header className="pulse-relationships__head">
        <div>
          <h2>{title}</h2>
          <span>@{profile.handle}</span>
        </div>
        {loading && results.length > 0 ? <small role="status">REFRESHING SOCIAL GRAPH</small> : null}
      </header>
      {error && results.length === 0 ? (
        <div className="pulse-relationships__error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={onRetry}><RefreshCw size={13} /> Retry</button>
        </div>
      ) : (
        <PulseAccountSearchResults
          heading={title}
          showHeading={false}
          ariaLabel={`${title.toLowerCase()} of @${profile.handle}`}
          results={results}
          loading={loading}
          emptyTitle={direction === 'followers' ? 'NO FOLLOWERS YET' : 'NOT FOLLOWING ANYONE'}
          emptyDetail={direction === 'followers'
            ? 'No public PULSE accounts currently follow this profile.'
            : 'This profile is not following any public PULSE accounts.'}
          currentAccountId={currentAccountId}
          canFollow={canFollow}
          pendingAccountIds={pendingAccountIds}
          isFollowing={isFollowing}
          onOpenProfile={onOpenProfile}
          onToggleFollow={onToggleFollow}
        />
      )}
      <PulseLoadMore
        available={hasMore}
        pending={loadingMore}
        failed={Boolean(error && results.length > 0)}
        label={`Load more ${title.toLowerCase()}`}
        onLoad={onLoadMore}
      />
    </div>
  )
}
