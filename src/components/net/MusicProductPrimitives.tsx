import { Heart, MoreHorizontal, Music2, Play, Plus, UserCog } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { NetAppProfileEditor } from './profile/NetAppProfileEditor'
import { useNetAppPresentation } from './profile/useNetAppIdentityPresentation'

export type MusicProductClassPrefix = 'vox-audio' | 'altara-music'

export interface MusicProductPlaylistOption {
  readonly id: string
  readonly title: string
}

function initials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'M'
}

export function MusicAppProfileEntry({
  appId,
  identityLinkId,
  ...props
}: {
  readonly appId: string
  readonly appLabel: string
  readonly classPrefix: MusicProductClassPrefix
  readonly identityLinkId?: string
  readonly fallbackDisplayName: string
}) {
  return (
    <MusicAppProfileEntryContent
      key={`${appId}:${identityLinkId ?? 'inactive'}`}
      appId={appId}
      identityLinkId={identityLinkId}
      {...props}
    />
  )
}

function MusicAppProfileEntryContent({
  appId,
  appLabel,
  classPrefix,
  identityLinkId,
  fallbackDisplayName,
}: {
  readonly appId: string
  readonly appLabel: string
  readonly classPrefix: MusicProductClassPrefix
  readonly identityLinkId?: string
  readonly fallbackDisplayName: string
}) {
  const presentation = useNetAppPresentation({
    appId,
    identityLinkId,
    enabled: Boolean(identityLinkId),
    fallbackDisplayName,
  })
  const [open, setOpen] = useState(false)
  const [failedUrl, setFailedUrl] = useState<string>()
  const displayName = presentation.displayName.trim() || fallbackDisplayName
  const visibleAvatarUrl = presentation.avatarUrl && presentation.avatarUrl !== failedUrl
    ? presentation.avatarUrl
    : undefined

  return (
    <div className={`${classPrefix}-profile-entry`}>
      <button
        type="button"
        className={`${classPrefix}-profile-entry__button`}
        disabled={!identityLinkId}
        aria-expanded={open}
        aria-label={`Edit ${appLabel} app profile`}
        title={identityLinkId ? `Edit ${appLabel} app profile` : 'No listening identity active'}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={`${classPrefix}-profile-entry__avatar`} aria-hidden="true">
          {visibleAvatarUrl
            ? <img src={visibleAvatarUrl} alt="" onError={() => setFailedUrl(visibleAvatarUrl)} />
            : initials(displayName)}
        </span>
        <span className={`${classPrefix}-profile-entry__copy`}>
          <strong>{displayName}</strong>
          <small>PRIVATE LISTENING CONTEXT</small>
        </span>
        <UserCog size={14} aria-hidden="true" />
      </button>
      {open && identityLinkId ? (
        <div className={`${classPrefix}-app-profile-popover`}>
          <NetAppProfileEditor
            appId={appId}
            appLabel={appLabel}
            identityLinkId={identityLinkId}
            onClose={() => setOpen(false)}
            onSaved={() => { void presentation.reload() }}
          />
        </div>
      ) : null}
    </div>
  )
}

export function MusicTrackContextMenu({
  classPrefix,
  trackTitle,
  artistId,
  releaseId,
  liked,
  playlists,
  activePersonalPlaylistId,
  onPlay,
  onPlayNext,
  onAddToQueue,
  queueActionsDisabled,
  onOpenArtist,
  onOpenRelease,
  onLike,
  onAddToPlaylist,
  onRemoveFromPlaylist,
}: {
  readonly classPrefix: MusicProductClassPrefix
  readonly trackTitle: string
  readonly artistId: string
  readonly releaseId?: string
  readonly liked: boolean
  readonly playlists: readonly MusicProductPlaylistOption[]
  readonly activePersonalPlaylistId?: string
  readonly onPlay: () => void
  readonly onPlayNext?: () => void
  readonly onAddToQueue?: () => void
  readonly queueActionsDisabled?: boolean
  readonly onOpenArtist: (artistId: string) => void
  readonly onOpenRelease: (releaseId: string) => void
  readonly onLike: () => void
  readonly onAddToPlaylist: (playlistId: string) => void
  readonly onRemoveFromPlaylist?: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node) || rootRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      toggleRef.current?.focus()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const run = (action: () => void) => {
    action()
    setOpen(false)
  }

  return (
    <div ref={rootRef} className={`${classPrefix}-track-menu`}>
      <button
        ref={toggleRef}
        type="button"
        className={`${classPrefix}-icon-action`}
        data-active={open ? 'true' : 'false'}
        aria-label={`More actions for ${trackTitle}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={`More actions for ${trackTitle}`}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div id={menuId} className={`${classPrefix}-track-menu__surface`} role="menu">
          <button type="button" role="menuitem" onClick={() => run(onPlay)}>
            <Play size={13} fill="currentColor" aria-hidden="true" /> PLAY FROM HERE
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!onPlayNext || queueActionsDisabled}
            onClick={() => onPlayNext ? run(onPlayNext) : undefined}
          >
            <Play size={13} aria-hidden="true" /> PLAY NEXT
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!onAddToQueue || queueActionsDisabled}
            onClick={() => onAddToQueue ? run(onAddToQueue) : undefined}
          >
            <Plus size={13} aria-hidden="true" /> ADD TO QUEUE
          </button>
          <button type="button" role="menuitem" onClick={() => run(() => onOpenArtist(artistId))}>
            <Music2 size={13} aria-hidden="true" /> GO TO ARTIST
          </button>
          {releaseId ? (
            <button type="button" role="menuitem" onClick={() => run(() => onOpenRelease(releaseId))}>
              <Music2 size={13} aria-hidden="true" /> GO TO RELEASE
            </button>
          ) : null}
          <button type="button" role="menuitem" onClick={() => run(onLike)}>
            <Heart size={13} fill={liked ? 'currentColor' : 'none'} aria-hidden="true" /> {liked ? 'UNLIKE' : 'LIKE'}
          </button>
          {activePersonalPlaylistId && onRemoveFromPlaylist ? (
            <button type="button" role="menuitem" onClick={() => run(onRemoveFromPlaylist)}>
              REMOVE FROM PLAYLIST
            </button>
          ) : null}
          <div className={`${classPrefix}-track-menu__playlist-group`} role="group" aria-label="Add to playlist">
            <span>ADD TO PLAYLIST</span>
            {playlists.length
              ? playlists.map((playlist) => (
                <button
                  type="button"
                  role="menuitem"
                  key={playlist.id}
                  onClick={() => run(() => onAddToPlaylist(playlist.id))}
                >
                  {playlist.title}
                </button>
              ))
              : <button type="button" role="menuitem" disabled>NO PLAYLISTS AVAILABLE</button>}
          </div>
        </div>
      ) : null}
    </div>
  )
}
