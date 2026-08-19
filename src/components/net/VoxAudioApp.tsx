import {
  ArrowLeft,
  AudioLines,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Disc3,
  GripVertical,
  Heart,
  Library,
  ListMusic,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Repeat1,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { SharedMediaImage } from '../shared/SharedMediaImage'
import {
  extractEmbeddedAudioArtwork,
  extractEmbeddedAudioTags,
  type ExtractedAudioTags,
} from '../../lib/audio/audioStorage'
import {
  removeSharedMediaReference,
  uploadSharedImage,
} from '../../lib/media/mediaStorage'
import {
  createNetVoxAudioGmTrack,
  deleteNetVoxAudioGmTrack,
  fetchNetVoxAudioStudio,
  inspectNetVoxAudioAudioFile,
  replaceNetVoxAudioGmTrackAudio,
  saveNetVoxAudioGmArtist,
  saveNetVoxAudioGmPlaylist,
  saveNetVoxAudioGmRelease,
  setNetVoxAudioGmPlaylistTrack,
  updateNetVoxAudioGmTrack,
} from '../../lib/netVoxAudioService'
import {
  NET_VOX_AUDIO_AUDIO_BYTE_BUDGET,
  formatVoxAudioDuration,
  netVoxAudioReleaseTypes,
  netVoxAudioStatuses,
  type NetVoxAudioGmArtist,
  type NetVoxAudioGmPlaylist,
  type NetVoxAudioGmRelease,
  type NetVoxAudioGmTrack,
  type NetVoxAudioPlaylist,
  type NetVoxAudioStatus,
  type NetVoxAudioStudioPayload,
  type NetVoxAudioTrack,
} from '../../lib/netVoxAudioTypes'
import { MusicAppProfileEntry, MusicTrackContextMenu } from './MusicProductPrimitives'
import { useNetVoxAudio } from './useNetVoxAudio'
import type { VoxAudioPlayerController } from './useVoxAudioPlayer'

import '../../styles/voxAudio.css'

export type VoxAudioMode = 'reader' | 'studio'
type ReaderNav = 'home' | 'search' | 'library' | 'liked' | 'playlists'

interface VoxAudioAppProps {
  readonly mode: VoxAudioMode
  readonly enabled: boolean
  readonly expectedIdentityLinkId?: string
  readonly identityName: string
  readonly player: VoxAudioPlayerController
  readonly onNotice: (message: string) => void
}

function Artwork({ source, label, kind = 'square' }: {
  readonly source?: string
  readonly label: string
  readonly kind?: 'square' | 'artist' | 'hero' | 'banner'
}) {
  const fallback = <span className="vox-audio-artwork__fallback"><Music2 aria-hidden="true" /></span>
  return (
    <span className="vox-audio-artwork" data-kind={kind}>
      {source ? (
        <SharedMediaImage
          source={source}
          variant={kind === 'hero' || kind === 'banner' ? 'display' : 'thumbnail'}
          alt={label}
          loadingFallback={fallback}
          errorFallback={fallback}
        />
      ) : fallback}
    </span>
  )
}

function Feedback({ icon, title, copy, action }: {
  readonly icon?: ReactNode
  readonly title: string
  readonly copy: string
  readonly action?: ReactNode
}) {
  return (
    <section className="vox-audio-feedback">
      {icon ?? <Disc3 size={28} aria-hidden="true" />}
      <h2>{title}</h2>
      <p>{copy}</p>
      {action}
    </section>
  )
}

function TrackList({
  tracks,
  player,
  playlists,
  onLike,
  onAddToPlaylist,
  activePersonalPlaylistId,
  onRemoveFromPlaylist,
  onOpenArtist,
  onOpenRelease,
}: {
  readonly tracks: readonly NetVoxAudioTrack[]
  readonly player: VoxAudioPlayerController
  readonly playlists: readonly NetVoxAudioPlaylist[]
  readonly onLike: (track: NetVoxAudioTrack) => void
  readonly onAddToPlaylist: (playlistId: string, trackId: string) => void
  readonly activePersonalPlaylistId?: string
  readonly onRemoveFromPlaylist?: (playlistId: string, trackId: string) => void
  readonly onOpenArtist: (artistId: string) => void
  readonly onOpenRelease: (releaseId: string) => void
}) {
  if (!tracks.length) return null
  return (
    <div className="vox-audio-track-list" role="list">
      {tracks.map((track, index) => {
        const isCurrent = player.current?.id === track.id
        const releaseId = track.releaseId
        const removeFromPlaylist = activePersonalPlaylistId && onRemoveFromPlaylist
          ? () => onRemoveFromPlaylist(activePersonalPlaylistId, track.id)
          : undefined
        return (
          <article key={track.id} role="listitem" data-current={isCurrent ? 'true' : 'false'}>
            <button
              type="button"
              className="vox-audio-track-play"
              aria-label={`${isCurrent && player.playing ? 'Pause' : 'Play'} ${track.title}`}
              onClick={() => {
                if (isCurrent) void player.toggle()
                else void player.playQueue(tracks, index)
              }}
            >
              {isCurrent && player.playing ? <Pause size={14} /> : <Play size={14} />}
            </button>
            {releaseId ? (
              <button
                type="button"
                className="vox-audio-track-artwork-button"
                aria-label={`Open ${track.releaseTitle ?? track.title}`}
                title={track.releaseTitle ? `Open ${track.releaseTitle}` : 'Open release'}
                onClick={() => onOpenRelease(releaseId)}
              >
                <Artwork source={track.artworkRef} label="" />
              </button>
            ) : (
              <Artwork source={track.artworkRef} label="" />
            )}
            <span className="vox-audio-track-copy">
              <strong>{track.title}</strong>
              <small>
                <button type="button" className="vox-audio-metadata-link" onClick={() => onOpenArtist(track.artistId)}>
                  {track.artistName}
                </button>
                {track.explicit ? <span> · EXPLICIT</span> : null}
              </small>
            </span>
            {releaseId ? (
              <button type="button" className="vox-audio-track-release" onClick={() => onOpenRelease(releaseId)}>
                {track.releaseTitle ?? 'OPEN RELEASE'}
              </button>
            ) : (
              <span className="vox-audio-track-release">VOX AUDIO ORIGINAL</span>
            )}
            <button
              type="button"
              className="vox-audio-icon-action"
              data-active={track.liked ? 'true' : 'false'}
              onClick={() => onLike(track)}
              aria-label={`${track.liked ? 'Remove' : 'Add'} ${track.title} ${track.liked ? 'from' : 'to'} liked songs`}
            >
              <Heart size={14} fill={track.liked ? 'currentColor' : 'none'} />
            </button>
            <MusicTrackContextMenu
              classPrefix="vox-audio"
              trackTitle={track.title}
              artistId={track.artistId}
              releaseId={track.releaseId}
              liked={track.liked}
              playlists={playlists}
              activePersonalPlaylistId={activePersonalPlaylistId}
              onPlay={() => {
                if (isCurrent) void player.toggle()
                else void player.playQueue(tracks, index)
              }}
              onPlayNext={() => { void player.playNext(track) }}
              onAddToQueue={() => { void player.addToQueue(track) }}
              queueActionsDisabled={isCurrent}
              onOpenArtist={onOpenArtist}
              onOpenRelease={onOpenRelease}
              onLike={() => onLike(track)}
              onAddToPlaylist={(playlistId) => onAddToPlaylist(playlistId, track.id)}
              onRemoveFromPlaylist={removeFromPlaylist}
            />
            <time>{formatVoxAudioDuration(track.durationMs)}</time>
          </article>
        )
      })}
    </div>
  )
}

function CollectionRail({
  title,
  children,
  action,
}: {
  readonly title: string
  readonly children: ReactNode
  readonly action?: ReactNode
}) {
  return <section className="vox-audio-rail"><header><h2>{title}</h2>{action}</header><div>{children}</div></section>
}

function PlayerQueuePanel({
  player,
  onClose,
}: {
  readonly player: VoxAudioPlayerController
  readonly onClose: () => void
}) {
  const track = player.current
  const currentIndex = player.currentIndex
  const upNext = currentIndex >= 0 ? player.queue.slice(currentIndex + 1) : []

  return (
    <aside id="vox-audio-player-queue" className="vox-audio-player__queue">
      <header>
        <div>
          <strong>QUEUE</strong>
          <small>{upNext.length} UP NEXT</small>
        </div>
        <button type="button" onClick={onClose} aria-label="Close playback queue"><X size={14} /></button>
      </header>
      <section className="vox-audio-player__queue-section">
        <header><span>NOW PLAYING</span></header>
        {track ? (
          <article className="vox-audio-player__queue-row" data-current="true">
            <small className="vox-audio-player__queue-position">NOW</small>
            <Artwork source={track.artworkRef} label="" />
            <span><strong>{track.title}</strong><small>{track.artistName}{track.releaseTitle ? ` · ${track.releaseTitle}` : ''}</small></span>
            <time>{formatVoxAudioDuration(track.durationMs)}</time>
          </article>
        ) : <p className="vox-audio-player__queue-empty">Choose a track to start a queue.</p>}
      </section>
      <section className="vox-audio-player__queue-section">
        <header><span>UP NEXT</span><small>{upNext.length ? `${upNext.length} ${upNext.length === 1 ? 'TRACK' : 'TRACKS'}` : 'EMPTY'}</small></header>
        {upNext.length ? upNext.map((queuedTrack, offset) => {
          const queueIndex = currentIndex + 1 + offset
          return (
            <article className="vox-audio-player__queue-row" key={`${queuedTrack.id}:${queueIndex}`}>
              <small className="vox-audio-player__queue-position">{String(offset + 1).padStart(2, '0')}</small>
              <Artwork source={queuedTrack.artworkRef} label="" />
              <span><strong>{queuedTrack.title}</strong><small>{queuedTrack.artistName}{queuedTrack.releaseTitle ? ` · ${queuedTrack.releaseTitle}` : ''}</small></span>
              <time>{formatVoxAudioDuration(queuedTrack.durationMs)}</time>
              <div className="vox-audio-player__queue-actions">
                <button type="button" disabled={offset === 0} onClick={() => player.moveQueueItem(queueIndex, queueIndex - 1)} aria-label={`Move ${queuedTrack.title} up`}><ChevronUp size={13} /></button>
                <button type="button" disabled={offset === upNext.length - 1} onClick={() => player.moveQueueItem(queueIndex, queueIndex + 1)} aria-label={`Move ${queuedTrack.title} down`}><ChevronDown size={13} /></button>
                <button type="button" onClick={() => player.removeFromQueue(queueIndex)} aria-label={`Remove ${queuedTrack.title} from queue`}><Trash2 size={13} /></button>
              </div>
            </article>
          )
        }) : <p className="vox-audio-player__queue-empty">Use Play Next or Add to Queue from any track menu.</p>}
      </section>
    </aside>
  )
}

function PlayerBar({
  player,
  onOpenArtist,
  onOpenRelease,
}: {
  readonly player: VoxAudioPlayerController
  readonly onOpenArtist: (artistId: string) => void
  readonly onOpenRelease: (releaseId: string) => void
}) {
  const track = player.current
  const currentReleaseId = track?.releaseId
  const [queueOpen, setQueueOpen] = useState(false)
  return (
    <footer className="vox-audio-player" data-empty={track ? 'false' : 'true'}>
      <div className="vox-audio-player__identity">
        {track && currentReleaseId ? (
          <button
            type="button"
            className="vox-audio-player__artwork-link"
            aria-label={`Open ${track.releaseTitle ?? track.title}`}
            title={track.releaseTitle ? `Open ${track.releaseTitle}` : 'Open release'}
            onClick={() => onOpenRelease(currentReleaseId)}
          >
            <Artwork source={track.artworkRef} label="" />
          </button>
        ) : (
          <Artwork source={track?.artworkRef} label="" />
        )}
        <span>
          <strong>{track?.title ?? 'READY WHEN YOU ARE'}</strong>
          <small>
            {track ? (
              <>
                <button type="button" className="vox-audio-metadata-link" onClick={() => onOpenArtist(track.artistId)}>
                  {track.artistName}
                </button>
                {track.releaseTitle ? (
                  currentReleaseId ? (
                    <>
                      {' · '}
                      <button type="button" className="vox-audio-metadata-link" onClick={() => onOpenRelease(currentReleaseId)}>
                        {track.releaseTitle}
                      </button>
                    </>
                  ) : ` · ${track.releaseTitle}`
                ) : null}
              </>
            ) : 'Choose a native track to begin'}
          </small>
        </span>
      </div>
      <div className="vox-audio-player__transport">
        <div>
          <button type="button" disabled={!track} data-active={player.shuffle ? 'true' : 'false'} onClick={player.toggleShuffle} aria-label={player.shuffle ? 'Disable shuffle' : 'Enable shuffle'} title={player.shuffle ? 'Shuffle on' : 'Shuffle off'}><Shuffle size={14} /></button>
          <button type="button" disabled={!track} onClick={() => { void player.previous() }} aria-label="Previous track"><SkipBack size={16} fill="currentColor" /></button>
          <button type="button" className="vox-audio-player__primary" disabled={!track || player.loading} onClick={() => { void player.toggle() }} aria-label={player.playing ? 'Pause' : 'Play'}>
            {player.loading ? <LoaderCircle className="vox-audio-spin" size={17} /> : player.playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
          </button>
          <button type="button" disabled={!track} onClick={() => { void player.next() }} aria-label="Next track"><SkipForward size={16} fill="currentColor" /></button>
          <button type="button" disabled={!track} data-active={player.repeat !== 'off' ? 'true' : 'false'} onClick={player.cycleRepeat} aria-label={`Repeat mode: ${player.repeat}`} title={`Repeat: ${player.repeat}`}>
            {player.repeat === 'track' ? <Repeat1 size={14} /> : <Repeat size={14} />}
          </button>
        </div>
        <label>
          <span>{formatVoxAudioDuration(player.currentTime * 1000)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(player.duration, 1)}
            step={0.1}
            value={Math.min(player.currentTime, Math.max(player.duration, 1))}
            disabled={!track}
            onChange={(event) => player.seek(Number(event.target.value))}
            aria-label="Track position"
          />
          <span>{formatVoxAudioDuration(player.duration > 0 ? player.duration * 1000 : track?.durationMs ?? 0)}</span>
        </label>
      </div>
      <div className="vox-audio-player__volume">
        <button type="button" disabled={!player.queue.length} data-active={queueOpen ? 'true' : 'false'} onClick={() => setQueueOpen((open) => !open)} aria-expanded={queueOpen} aria-controls="vox-audio-player-queue" aria-label="Show playback queue" title="Playback queue"><ListMusic size={14} /></button>
        <button type="button" onClick={player.toggleMuted} aria-label={player.muted ? 'Unmute' : 'Mute'}>{player.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
        <input type="range" min={0} max={1} step={0.02} value={player.volume} onChange={(event) => player.setVolume(Number(event.target.value))} aria-label="Volume" />
      </div>
      {queueOpen && player.queue.length ? <PlayerQueuePanel player={player} onClose={() => setQueueOpen(false)} /> : null}
      {player.error ? <p role="alert">{player.error}</p> : null}
    </footer>
  )
}

function AudioReader({
  enabled,
  identityName,
  expectedIdentityLinkId,
  player,
  onNotice,
}: Omit<VoxAudioAppProps, 'mode'>) {
  const audio = useNetVoxAudio(enabled, expectedIdentityLinkId)
  const [nav, setNav] = useState<ReaderNav>('home')
  const [query, setQuery] = useState('')
  const [newPlaylistTitle, setNewPlaylistTitle] = useState('')
  const [newPlaylistDescription, setNewPlaylistDescription] = useState('')
  const mainRef = useRef<HTMLElement | null>(null)
  const savedScrollRef = useRef(0)
  const home = audio.home
  const library = audio.library

  const like = (track: NetVoxAudioTrack) => {
    void audio.setLiked(track.id, !track.liked)
      .then(() => onNotice(`VOX AUDIO // ${track.liked ? 'REMOVED FROM' : 'ADDED TO'} LIKED SONGS`))
      .catch(() => undefined)
  }
  const addToPlaylist = (playlistId: string, trackId: string) => {
    void audio.setPlaylistTrack(playlistId, trackId, true)
      .then(() => onNotice('VOX AUDIO // TRACK ADDED TO PLAYLIST'))
      .catch(() => undefined)
  }
  const removeFromPlaylist = (playlistId: string, trackId: string) => {
    void audio.setPlaylistTrack(playlistId, trackId, false)
      .then(() => onNotice('VOX AUDIO // TRACK REMOVED FROM PLAYLIST'))
      .catch(() => undefined)
  }
  const rememberScroll = () => {
    savedScrollRef.current = mainRef.current?.scrollTop ?? 0
  }
  const restoreScroll = () => {
    window.requestAnimationFrame(() => {
      mainRef.current?.scrollTo({ top: savedScrollRef.current })
    })
  }
  const openArtist = (artistId: string) => {
    rememberScroll()
    void audio.openArtist(artistId)
  }
  const openRelease = (releaseId: string) => {
    rememberScroll()
    void audio.openRelease(releaseId)
  }
  const openPlaylist = (playlistId: string) => {
    rememberScroll()
    void audio.openPlaylist(playlistId)
  }
  const closeDetail = () => {
    audio.closeDetail()
    restoreScroll()
  }
  let content: ReactNode
  if (!enabled || !expectedIdentityLinkId) {
    content = <Feedback title="LISTENING IDENTITY UNAVAILABLE" copy="Open VOX AUDIO from an installed, authoritative VEIL runtime identity. GM System does not inherit a fictional library." />
  } else if (audio.loading && !home) {
    content = <Feedback icon={<LoaderCircle className="vox-audio-spin" size={28} />} title="OPENING YOUR LIBRARY" copy="Loading the published catalogue and your private listening state." />
  } else if (!home) {
    content = <Feedback title="VOX AUDIO UNAVAILABLE" copy={audio.error ?? 'The catalogue could not be opened.'} action={<button type="button" onClick={audio.reload}><RefreshCw size={14} /> RETRY</button>} />
  } else if (audio.detail) {
    const detail = audio.detail
    const title = detail.kind === 'artist' ? detail.value.artist.name : detail.kind === 'release' ? detail.value.release.title : detail.value.playlist.title
    const artwork = detail.kind === 'artist' ? detail.value.artist.avatarRef : detail.kind === 'release' ? detail.value.release.coverRef : detail.value.playlist.coverRef
    const tracks = detail.value.tracks
    const description = detail.kind === 'artist'
      ? detail.value.artist.bio
      : detail.kind === 'release'
        ? detail.value.release.description
        : detail.value.playlist.description
    content = (
      <section className="vox-audio-detail">
        <button type="button" className="vox-audio-back" onClick={closeDetail}><ArrowLeft size={14} /> BACK</button>
        <header>
          <Artwork source={artwork} label={title} kind={detail.kind === 'artist' ? 'artist' : 'hero'} />
          <div>
            <span>{detail.kind.toUpperCase()}</span>
            <h1>{title}</h1>
            {detail.kind === 'release' ? (
              <p>
                <button type="button" className="vox-audio-metadata-link" onClick={() => openArtist(detail.value.release.artistId)}>
                  {detail.value.release.artistName}
                </button>
                {' · '}
                {detail.value.release.releaseType.toUpperCase()}{detail.value.release.releaseDate ? ` · ${detail.value.release.releaseDate}` : ''}
              </p>
            ) : description ? <p>{description}</p> : null}
            <small>{tracks.length} {tracks.length === 1 ? 'TRACK' : 'TRACKS'}</small>
            {tracks.length ? <button type="button" onClick={() => { void player.playQueue(tracks) }}><Play size={14} fill="currentColor" /> PLAY ALL</button> : null}
          </div>
        </header>
        {detail.kind === 'artist' && detail.value.releases.length ? (
          <CollectionRail title="RELEASES">
            <div className="vox-audio-cover-grid vox-audio-cover-grid--releases">
              {detail.value.releases.map((release) => <button type="button" key={release.id} className="vox-audio-cover-card" onClick={() => openRelease(release.id)}><Artwork source={release.coverRef} label={release.title} /><strong>{release.title}</strong><small>{release.releaseType.toUpperCase()}{release.releaseDate ? ` · ${release.releaseDate}` : ''}</small></button>)}
            </div>
          </CollectionRail>
        ) : null}
        <TrackList
          tracks={tracks}
          player={player}
          playlists={library?.playlists ?? []}
          onLike={like}
          onAddToPlaylist={addToPlaylist}
          onOpenArtist={openArtist}
          onOpenRelease={openRelease}
          activePersonalPlaylistId={detail.kind === 'playlist' && detail.value.playlist.playlistKind === 'personal'
            ? detail.value.playlist.id
            : undefined}
          onRemoveFromPlaylist={removeFromPlaylist}
        />
      </section>
    )
  } else if (nav === 'home') {
    const featuredReleases = home.releases.filter((release) => release.featured)
    const featuredTracks = home.tracks.filter((track) => track.featured)
    const featuredArtists = home.artists.filter((artist) => artist.featured)
    const leadRelease = featuredReleases[0] ?? home.releases[0]
    const leadArtist = leadRelease ? undefined : featuredArtists[0] ?? home.artists[0]
    const leadTitle = leadRelease?.title ?? leadArtist?.name
    const leadArtwork = leadRelease?.coverRef ?? leadArtist?.bannerRef ?? leadArtist?.avatarRef
    const leadTracks = leadRelease
      ? home.tracks.filter((track) => track.releaseId === leadRelease.id)
      : leadArtist
        ? home.tracks.filter((track) => track.artistId === leadArtist.id)
        : []
    const playNowTracks = leadTracks.length ? leadTracks : featuredTracks.length ? featuredTracks : home.tracks
    const leadMeta = leadRelease
      ? [
          leadRelease.releaseType.toUpperCase(),
          leadRelease.releaseDate,
          leadTracks.length ? `${leadTracks.length} ${leadTracks.length === 1 ? 'TRACK' : 'TRACKS'}` : undefined,
        ].filter(Boolean).join(' · ')
      : leadArtist
        ? 'FEATURED ARTIST · VOX AUDIO CATALOGUE'
        : 'NEW VEGA AUDIO'
    const leadCopy = leadRelease?.description?.trim()
      || leadArtist?.bio?.trim()
      || (leadRelease
        ? 'A focused transmission from the New Vega catalogue, curated with VOX precision.'
        : 'The native catalogue is ready. GM System can publish the first canonical artist, release, or track from AUDIO STUDIO.')
    const featuredReleaseIds = new Set(featuredReleases.map((release) => release.id))
    const secondaryFeaturedReleases = featuredReleases.filter((release) => release.id !== leadRelease?.id)
    const newReleases = home.releases.filter((release) => release.id !== leadRelease?.id && !featuredReleaseIds.has(release.id))
    const releaseShelf = [...secondaryFeaturedReleases, ...newReleases]
    const recentTracks = home.recentlyPlayed.slice(0, 6)
    const likedCount = library?.likedTracks.length
    const personalPlaylistCount = library?.playlists.length
    content = (
      <div className="vox-audio-home">
        <section className="vox-audio-home__hero">
          {leadArtwork ? <div className="vox-audio-home__hero-backdrop" aria-hidden="true"><Artwork source={leadArtwork} label="" kind="hero" /></div> : null}
          <div className="vox-audio-home__hero-copy">
            <span>FEATURED {leadRelease ? 'RELEASE' : leadArtist ? 'ARTIST' : 'CATALOGUE'}</span>
            <h1>{leadTitle ?? 'Signal starts here.'}</h1>
            <p className="vox-audio-home__hero-artist">{leadRelease?.artistName ?? leadArtist?.name ?? 'VOX NET // NEW VEGA AUDIO'}</p>
            <p className="vox-audio-home__hero-meta">{leadMeta}</p>
            <p className="vox-audio-home__hero-description">{leadCopy}</p>
            <div className="vox-audio-home__hero-actions">
              {playNowTracks.length ? <button type="button" className="vox-audio-home__primary-action" onClick={() => { void player.playQueue(playNowTracks) }}><Play size={15} fill="currentColor" /> PLAY NOW</button> : null}
              {leadRelease ? <button type="button" className="vox-audio-home__secondary-action" onClick={() => openRelease(leadRelease.id)}>OPEN RELEASE <ChevronRight size={14} /></button> : leadArtist ? <button type="button" className="vox-audio-home__secondary-action" onClick={() => openArtist(leadArtist.id)}>OPEN ARTIST <ChevronRight size={14} /></button> : null}
            </div>
          </div>
          <button
            type="button"
            className="vox-audio-home__hero-art"
            onClick={() => {
              if (leadRelease) openRelease(leadRelease.id)
              else if (leadArtist) openArtist(leadArtist.id)
            }}
            aria-label={leadRelease ? `Open ${leadRelease.title}` : leadArtist ? `Open ${leadArtist.name}` : 'Featured VOX AUDIO artwork'}
          >
            <Artwork source={leadArtwork} label={leadTitle ?? ''} kind="hero" />
            <span>VOX AUDIO // NEW VEGA CATALOGUE</span>
          </button>
        </section>
        {recentTracks.length ? <CollectionRail title="CONTINUE LISTENING" action={<button type="button" className="vox-audio-rail-action" onClick={() => { void player.playQueue(recentTracks) }}><Play size={12} fill="currentColor" /> PLAY RECENT</button>}><div className="vox-audio-home__recent"><TrackList tracks={recentTracks} player={player} playlists={library?.playlists ?? []} onLike={like} onAddToPlaylist={addToPlaylist} onOpenArtist={openArtist} onOpenRelease={openRelease} /></div></CollectionRail> : null}
        {releaseShelf.length ? <CollectionRail title="FEATURED / NEW RELEASES"><div className="vox-audio-home-release-grid">{releaseShelf.map((release) => <button type="button" key={release.id} className="vox-audio-cover-card" onClick={() => openRelease(release.id)}><Artwork source={release.coverRef} label={release.title} /><strong>{release.title}</strong><small>{release.artistName} · {release.releaseType.toUpperCase()}</small></button>)}</div></CollectionRail> : featuredTracks.length ? <CollectionRail title="FEATURED TRACKS" action={<button type="button" className="vox-audio-rail-action" onClick={() => { void player.playQueue(featuredTracks) }}><Play size={12} fill="currentColor" /> PLAY ALL</button>}><div className="vox-audio-home__recent"><TrackList tracks={featuredTracks.slice(0, 6)} player={player} playlists={library?.playlists ?? []} onLike={like} onAddToPlaylist={addToPlaylist} onOpenArtist={openArtist} onOpenRelease={openRelease} /></div></CollectionRail> : null}
        <CollectionRail title="QUICK ACCESS">
          <div className="vox-audio-home__quick-grid">
            <button type="button" onClick={() => { audio.closeDetail(); setNav('liked') }}>
              <Heart size={17} />
              <span><strong>Liked Songs</strong><small>{likedCount === undefined ? 'Saved tracks' : `${likedCount} ${likedCount === 1 ? 'track' : 'tracks'}`}</small></span>
            </button>
            <button type="button" onClick={() => { audio.closeDetail(); setNav('library') }}>
              <Library size={17} />
              <span><strong>Your Library</strong><small>{home.recentlyPlayed.length ? `${home.recentlyPlayed.length} recent plays` : 'Saved music'}</small></span>
            </button>
            <button type="button" onClick={() => { audio.closeDetail(); setNav('playlists') }}>
              <ListMusic size={17} />
              <span><strong>Playlists</strong><small>{personalPlaylistCount === undefined ? 'Private collections' : `${personalPlaylistCount} ${personalPlaylistCount === 1 ? 'playlist' : 'playlists'}`}</small></span>
            </button>
          </div>
        </CollectionRail>
      </div>
    )
  } else if (nav === 'search') {
    const results = audio.search
    content = (
      <section className="vox-audio-search-page">
        <header><h1>Search the catalogue</h1><p>Artists, releases, native tracks, and curated collections.</p></header>
        <form onSubmit={(event) => { event.preventDefault(); if (query.trim()) void audio.runSearch(query) }}>
          <Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={120} placeholder="What do you want to hear?" autoFocus /><button type="submit">SEARCH</button>
        </form>
        {!results ? <Feedback title="START WITH A NAME" copy="Search the bounded native catalogue by artist, release, track, or playlist name." /> : (
          <div className="vox-audio-search-results">
            {results.artists.length ? <CollectionRail title="ARTISTS"><div className="vox-audio-cover-grid">{results.artists.map((artist) => <button type="button" key={artist.id} className="vox-audio-cover-card" onClick={() => openArtist(artist.id)}><Artwork source={artist.avatarRef} label={artist.name} kind="artist" /><strong>{artist.name}</strong></button>)}</div></CollectionRail> : null}
            {results.releases.length ? <CollectionRail title="RELEASES"><div className="vox-audio-cover-grid">{results.releases.map((release) => <button type="button" key={release.id} className="vox-audio-cover-card" onClick={() => openRelease(release.id)}><Artwork source={release.coverRef} label={release.title} /><strong>{release.title}</strong><small>{release.artistName}</small></button>)}</div></CollectionRail> : null}
            {results.tracks.length ? <CollectionRail title="TRACKS"><TrackList tracks={results.tracks} player={player} playlists={library?.playlists ?? []} onLike={like} onAddToPlaylist={addToPlaylist} onOpenArtist={openArtist} onOpenRelease={openRelease} /></CollectionRail> : null}
            {results.playlists.length ? <CollectionRail title="CURATED PLAYLISTS"><div className="vox-audio-cover-grid">{results.playlists.map((playlist) => <button type="button" key={playlist.id} className="vox-audio-cover-card" onClick={() => openPlaylist(playlist.id)}><Artwork source={playlist.coverRef} label={playlist.title} /><strong>{playlist.title}</strong><small>{playlist.trackCount} TRACKS</small></button>)}</div></CollectionRail> : null}
            {!results.tracks.length && !results.artists.length && !results.releases.length && !results.playlists.length ? <Feedback title="NO MATCHES" copy="Try a shorter artist, release, track, or playlist name." /> : null}
          </div>
        )}
      </section>
    )
  } else if (nav === 'playlists') {
    content = (
      <section className="vox-audio-library-page">
        <header><h1>Your playlists</h1><p>Private collections owned by {identityName}.</p></header>
        <form className="vox-audio-new-playlist" onSubmit={(event) => {
          event.preventDefault()
          if (!newPlaylistTitle.trim()) return
          void audio.savePlaylist({ title: newPlaylistTitle, description: newPlaylistDescription }).then((id) => { setNewPlaylistTitle(''); setNewPlaylistDescription(''); onNotice('VOX AUDIO // PLAYLIST CREATED'); openPlaylist(id) }).catch(() => undefined)
        }}><input value={newPlaylistTitle} maxLength={120} required onChange={(event) => setNewPlaylistTitle(event.target.value)} placeholder="Playlist title" aria-label="Playlist title" /><input value={newPlaylistDescription} maxLength={1000} onChange={(event) => setNewPlaylistDescription(event.target.value)} placeholder="Description (optional)" aria-label="Playlist description" /><button type="submit" disabled={audio.mutating}><Plus size={14} /> {audio.mutating ? 'CREATING…' : 'CREATE PLAYLIST'}</button></form>
        {library?.playlists.length ? <div className="vox-audio-playlist-directory">{library.playlists.map((playlist) => <article key={playlist.id}><button type="button" onClick={() => openPlaylist(playlist.id)}><Artwork source={playlist.coverRef} label={playlist.title} /><span><strong>{playlist.title}</strong><small>{playlist.trackCount} TRACKS</small></span></button><button type="button" aria-label={`Delete ${playlist.title}`} onClick={() => { if (window.confirm(`Delete ${playlist.title}? The tracks remain in VOX AUDIO.`)) void audio.deletePlaylist(playlist.id) }}><Trash2 size={14} /></button></article>)}</div> : <Feedback title="NO PLAYLISTS YET" copy="Create a private playlist, then add published native tracks from any track row." />}
      </section>
    )
  } else if (nav === 'liked') {
    const likedTracks = library?.likedTracks ?? []
    content = (
      <section className="vox-audio-library-page">
        <header className="vox-audio-library-heading"><div><h1>Liked songs</h1><p>Tracks saved by this exact VEIL identity.</p></div>{likedTracks.length ? <button type="button" onClick={() => { void player.playQueue(likedTracks) }}><Play size={14} fill="currentColor" /> PLAY ALL</button> : null}</header>
        {likedTracks.length ? <TrackList tracks={likedTracks} player={player} playlists={library?.playlists ?? []} onLike={like} onAddToPlaylist={addToPlaylist} onOpenArtist={openArtist} onOpenRelease={openRelease} /> : <Feedback title="NO LIKED SONGS" copy="Use the heart on a published native track to keep it here." />}
      </section>
    )
  } else {
    const recentTracks = library?.recentlyPlayed ?? []
    const likedTracks = library?.likedTracks ?? []
    const personalPlaylists = library?.playlists ?? []
    const emptyLibrary = !recentTracks.length && !likedTracks.length && !personalPlaylists.length
    content = (
      <section className="vox-audio-library-page vox-audio-library-page--overview">
        <header><h1>Your library</h1><p>Recent listening, saved tracks, and private collections for {identityName}.</p></header>
        {recentTracks.length ? <CollectionRail title="RECENTLY PLAYED" action={<button type="button" className="vox-audio-rail-action" onClick={() => { void player.playQueue(recentTracks) }}><Play size={12} fill="currentColor" /> PLAY</button>}><TrackList tracks={recentTracks.slice(0, 12)} player={player} playlists={personalPlaylists} onLike={like} onAddToPlaylist={addToPlaylist} onOpenArtist={openArtist} onOpenRelease={openRelease} /></CollectionRail> : null}
        {likedTracks.length ? <CollectionRail title="LIKED SONGS" action={<button type="button" className="vox-audio-rail-action" onClick={() => setNav('liked')}>VIEW ALL <ChevronRight size={12} /></button>}><TrackList tracks={likedTracks.slice(0, 8)} player={player} playlists={personalPlaylists} onLike={like} onAddToPlaylist={addToPlaylist} onOpenArtist={openArtist} onOpenRelease={openRelease} /></CollectionRail> : null}
        {personalPlaylists.length ? <CollectionRail title="YOUR PLAYLISTS" action={<button type="button" className="vox-audio-rail-action" onClick={() => setNav('playlists')}>MANAGE <ChevronRight size={12} /></button>}><div className="vox-audio-cover-grid">{personalPlaylists.slice(0, 12).map((playlist) => <button type="button" key={playlist.id} className="vox-audio-cover-card" onClick={() => openPlaylist(playlist.id)}><Artwork source={playlist.coverRef} label={playlist.title} /><strong>{playlist.title}</strong><small>{playlist.trackCount} TRACKS</small></button>)}</div></CollectionRail> : null}
        {emptyLibrary ? <Feedback title="YOUR LIBRARY IS READY" copy="Play a native track, like a song, or create a private playlist to begin." action={<button type="button" onClick={() => setNav('home')}>EXPLORE AUDIO</button>} /> : null}
      </section>
    )
  }

  return (
    <section className="vox-audio" aria-label="VOX AUDIO">
      <aside className="vox-audio-sidebar">
        <header><span><AudioLines size={20} /></span><div><strong>VOX AUDIO</strong><small>NEW VEGA CATALOGUE</small></div></header>
        <nav>
          {([
            ['home', 'HOME', Sparkles], ['search', 'SEARCH', Search], ['library', 'YOUR LIBRARY', Library],
            ['liked', 'LIKED SONGS', Heart], ['playlists', 'PLAYLISTS', ListMusic],
          ] as const).map(([id, label, Icon]) => <button key={id} type="button" data-active={nav === id ? 'true' : 'false'} onClick={() => { audio.closeDetail(); setNav(id) }} title={label} aria-label={label}><Icon size={15} /> {label}</button>)}
        </nav>
        <div className="vox-audio-sidebar__library"><span>YOUR PLAYLISTS</span>{library?.playlists.slice(0, 12).map((playlist) => <button type="button" key={playlist.id} onClick={() => openPlaylist(playlist.id)} title={playlist.title}><Disc3 size={12} /> {playlist.title}</button>)}{!library?.playlists.length ? <small>No personal playlists</small> : null}</div>
        <footer>
          <MusicAppProfileEntry
            appId="vox-audio"
            appLabel="VOX AUDIO"
            classPrefix="vox-audio"
            identityLinkId={expectedIdentityLinkId}
            fallbackDisplayName={identityName}
          />
        </footer>
      </aside>
      <div className="vox-audio-workspace">
        {audio.refreshing ? <div className="vox-audio-sync"><LoaderCircle className="vox-audio-spin" size={12} /> SYNCHRONIZING</div> : null}
        {audio.error && home ? <div className="vox-audio-error" role="alert">{audio.error}<button type="button" onClick={audio.reload}>RETRY</button></div> : null}
        <main ref={mainRef}>{content}</main>
        <PlayerBar player={player} onOpenArtist={openArtist} onOpenRelease={openRelease} />
      </div>
    </section>
  )
}

type StudioSection = 'catalog' | 'playlists'
type CatalogView =
  | { readonly kind: 'artist'; readonly id?: string; readonly key: string }
  | { readonly kind: 'release'; readonly id?: string; readonly artistId: string; readonly key: string }
  | { readonly kind: 'track'; readonly id?: string; readonly artistId?: string; readonly releaseId?: string; readonly key: string }
  | { readonly kind: 'all-tracks'; readonly key: string }
type TrackPanel = { readonly key: string; readonly id?: string; readonly artistId: string; readonly releaseId: string }
type AudioInspection = Awaited<ReturnType<typeof inspectNetVoxAudioAudioFile>>
type StudioRun = (
  operation: () => Promise<NetVoxAudioStudioPayload>,
  notice: string | ((payload: NetVoxAudioStudioPayload) => string),
  onSuccess?: (payload: NetVoxAudioStudioPayload) => void,
) => Promise<void>

const statusOptions = netVoxAudioStatuses.map((status) => <option key={status} value={status}>{status.toUpperCase()}</option>)

function audioSlug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function titleFromAudioFilename(filename: string): string {
  const title = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return title ? title.charAt(0).toUpperCase() + title.slice(1) : ''
}

function studioErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'The Studio operation failed.'
  const knownErrors: readonly [string, string][] = [
    ['net_vox_audio_releases_slug_key', 'A release with this slug already exists. Open the existing release or adjust its advanced slug.'],
    ['net_vox_audio_artists_slug_key', 'An artist with this slug already exists. Open the existing artist or adjust its advanced slug.'],
    ['VOX_AUDIO_RELEASE_ARTIST_CHANGE_REQUIRES_TRACK_REASSIGNMENT', "Move or remove this release's tracks before changing its artist."],
    ['VOX_AUDIO_STORAGE_BUDGET_REACHED', 'VOX AUDIO has reached its audio storage budget. Archive and safely remove unused audio before adding more.'],
    ['VOX_AUDIO_TRACK_LIMIT_REACHED', 'VOX AUDIO has reached its reviewed native-track limit.'],
    ['VOX_AUDIO_PLAYLIST_TRACK_LIMIT_REACHED', 'This playlist already contains the maximum of 500 tracks.'],
    ['VOX_AUDIO_RELEASE_ARTIST_MISMATCH', 'The selected release belongs to a different artist. Return to the release and add the track there.'],
  ]
  return knownErrors.find(([code]) => message.includes(code))?.[1] ?? message
}

async function cleanupReplacedSharedMedia(
  previousReference: string | undefined,
  nextReference: string | undefined,
  onNotice: (message: string) => void,
  label: string,
): Promise<void> {
  const previous = previousReference?.trim() ?? ''
  const next = nextReference?.trim() ?? ''
  if (!previous || previous === next) return
  try {
    await removeSharedMediaReference(previous)
  } catch (cleanupError) {
    onNotice(
      `VOX AUDIO // ${label.toUpperCase()} CLEANUP BLOCKED: `
      + `${cleanupError instanceof Error ? cleanupError.message : 'Storage cleanup failed.'}`
      + ` Please remove this old ${label.toLowerCase()} reference in a follow-up studio action.`,
    )
  }
}

async function commitSharedMediaReplacement(
  previousReference: string | undefined,
  nextReference: string | undefined,
): Promise<string | undefined> {
  const previous = previousReference?.trim() ?? ''
  const next = nextReference?.trim() ?? ''
  if (!next || next === previous) return previous || undefined
  return next
}

async function finalizeSharedMediaReplacement(
  previousReference: string | undefined,
  nextReference: string | undefined,
  onNotice: (message: string) => void,
  label: string,
): Promise<void> {
  const previous = previousReference?.trim() ?? ''
  const next = nextReference?.trim() ?? ''
  if (!previous || previous === next) return
  await cleanupReplacedSharedMedia(previous, next, onNotice, label)
}

async function rollbackSharedMediaUpload(
  stagedReference: string | undefined,
  baselineReference: string | undefined,
  onNotice: (message: string) => void,
  label: string,
): Promise<void> {
  const staged = stagedReference?.trim() ?? ''
  const baseline = baselineReference?.trim() ?? ''
  if (!staged || staged === baseline) return
  try {
    await removeSharedMediaReference(staged)
  } catch (cleanupError) {
    onNotice(
      `VOX AUDIO // ${label.toUpperCase()} ROLLBACK FAILED: `
      + `${cleanupError instanceof Error ? cleanupError.message : 'Storage rollback blocked.'}`,
    )
  }
}

function confirmedStudioRecordId(records: readonly { readonly id: string }[], requestedId: string, label: string): string {
  const confirmed = records.find((record) => record.id === requestedId)
  if (!confirmed) throw new Error(`VOX AUDIO did not return the saved ${label}. Refresh AUDIO STUDIO before retrying.`)
  return confirmed.id
}

function StudioArtworkUpload({ subjectId, slot, label, source, previewLabel, kind = 'square', embeddedPreviewUrl, onUploaded }: {
  readonly subjectId?: string
  readonly slot: string
  readonly label: string
  readonly source?: string
  readonly previewLabel: string
  readonly kind?: 'square' | 'artist' | 'banner'
  /** Local object URL for artwork detected in the audio file's own metadata, shown only before the record has been saved. */
  readonly embeddedPreviewUrl?: string
  readonly onUploaded: (reference: string) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const showEmbeddedPreview = !subjectId && !source && Boolean(embeddedPreviewUrl)
  return (
    <div className="vox-audio-studio-artwork" data-kind={kind}>
      {showEmbeddedPreview
        ? <span className="vox-audio-artwork" data-kind={kind}><img src={embeddedPreviewUrl} alt={previewLabel} /></span>
        : <Artwork source={source} label={previewLabel} kind={kind} />}
      <div>
        <strong>{label}</strong>
        <small>
          {showEmbeddedPreview
            ? 'EMBEDDED ARTWORK — detected from audio metadata. Save the track to keep it, or replace it below afterward.'
            : source
              ? 'Private artwork attached. Replace it without changing the record.'
              : subjectId
                ? 'No artwork attached yet.'
                : 'Save this record once to enable private artwork.'}
        </small>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" hidden onChange={(event) => {
          const file = event.target.files?.[0]
          if (!file || !subjectId) return
          setBusy(true); setError(undefined)
          void uploadSharedImage({ subjectKind: 'vox-audio-artwork', subjectId, mediaKind: 'general', slot }, file, 'general')
            .then(async ({ reference }) => {
              onUploaded(reference)
            })
            .catch((uploadError) => setError(uploadError instanceof Error ? uploadError.message : 'Artwork upload failed.'))
            .finally(() => { setBusy(false); if (inputRef.current) inputRef.current.value = '' })
        }} />
        <button type="button" disabled={!subjectId || busy} onClick={() => inputRef.current?.click()}>
          <Upload size={13} /> {busy ? 'UPLOADING…' : subjectId ? `${source ? 'REPLACE' : 'UPLOAD'} ${label}` : 'SAVE RECORD BEFORE ARTWORK'}
        </button>
        {error ? <small role="alert">{error}</small> : null}
      </div>
    </div>
  )
}

function Studio({ enabled, onNotice }: Pick<VoxAudioAppProps, 'enabled' | 'onNotice'>) {
  const [payload, setPayload] = useState<NetVoxAudioStudioPayload>()
  const [section, setSection] = useState<StudioSection>('catalog')
  const [catalogView, setCatalogView] = useState<CatalogView>()
  const [playlistSelection, setPlaylistSelection] = useState<{ readonly id?: string; readonly key: string }>()
  const [trackPanel, setTrackPanel] = useState<TrackPanel>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const busyRef = useRef(false)

  const load = () => {
    if (!enabled) return
    setLoading(true); setError(undefined)
    void fetchNetVoxAudioStudio()
      .then(setPayload)
      .catch((loadError) => setError(studioErrorMessage(loadError)))
      .finally(() => setLoading(false))
  }
  useEffect(load, [enabled])

  const run: StudioRun = async (operation, notice, onSuccess) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true); setError(undefined)
    try {
      const nextPayload = await operation()
      setPayload(nextPayload)
      onSuccess?.(nextPayload)
      onNotice(typeof notice === 'function' ? notice(nextPayload) : notice)
    } catch (operationError) {
      setError(studioErrorMessage(operationError))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  if (!enabled) return <section className="vox-audio"><Feedback title="AUDIO STUDIO UNAVAILABLE" copy="Open Studio from an authoritative GM System workspace." /></section>
  if (loading && !payload) return <section className="vox-audio"><Feedback icon={<LoaderCircle className="vox-audio-spin" />} title="OPENING AUDIO STUDIO" copy="Loading the world catalogue and private audio budget." /></section>
  if (!payload) return <section className="vox-audio"><Feedback title="AUDIO STUDIO COULD NOT OPEN" copy={error ?? 'The administrative catalogue is unavailable.'} action={<button type="button" onClick={load}>RETRY</button>} /></section>

  const openSection = (nextSection: StudioSection) => {
    setSection(nextSection)
    setTrackPanel(undefined)
    setError(undefined)
  }
  const currentArtist = catalogView?.kind === 'artist' ? payload.artists.find((artist) => artist.id === catalogView.id) : undefined
  const currentRelease = catalogView?.kind === 'release' ? payload.releases.find((release) => release.id === catalogView.id) : undefined
  const currentTrack = catalogView?.kind === 'track' ? payload.tracks.find((track) => track.id === catalogView.id) : undefined

  let directory: ReactNode
  let workspace: ReactNode
  if (section === 'catalog') {
    directory = (
      <>
        <header><div><strong>ARTISTS</strong><small>{payload.artists.length} IN CATALOG</small></div><button type="button" disabled={busy} onClick={() => setCatalogView({ kind: 'artist', key: crypto.randomUUID() })}><Plus size={14} /> NEW ARTIST</button></header>
        {payload.artists.map((artist) => {
          const releaseCount = payload.releases.filter((release) => release.artistId === artist.id).length
          return <button type="button" key={artist.id} className="vox-audio-studio-directory-row" data-active={catalogView?.kind === 'artist' && catalogView.id === artist.id ? 'true' : 'false'} onClick={() => { setTrackPanel(undefined); setCatalogView({ kind: 'artist', id: artist.id, key: artist.id }) }}><Artwork source={artist.avatarRef} label="" kind="artist" /><span><strong>{artist.name}</strong><small>{artist.status.toUpperCase()} · {releaseCount} {releaseCount === 1 ? 'RELEASE' : 'RELEASES'}</small></span><ChevronRight size={14} /></button>
        })}
        {!payload.artists.length ? <p>NO ARTISTS YET. CREATE THE FIRST CATALOG IDENTITY.</p> : null}
        <button type="button" className="vox-audio-studio-directory-utility" data-active={catalogView?.kind === 'all-tracks' || catalogView?.kind === 'track' ? 'true' : 'false'} onClick={() => { setTrackPanel(undefined); setCatalogView({ kind: 'all-tracks', key: crypto.randomUUID() }) }}><ListMusic size={14} /><span><strong>ALL TRACKS</strong><small>{payload.tracks.length} NATIVE RECORDINGS</small></span></button>
      </>
    )

    if (catalogView?.kind === 'artist') {
      const releases = currentArtist ? payload.releases.filter((release) => release.artistId === currentArtist.id) : []
      workspace = (
        <ArtistWorkspace
          key={catalogView.key}
          value={currentArtist}
          releases={releases}
          busy={busy}
          run={run}
          onNotice={onNotice}
          onSaved={(id) => setCatalogView({ kind: 'artist', id, key: id })}
          onOpenRelease={(releaseId) => setCatalogView({ kind: 'release', id: releaseId, artistId: currentArtist?.id ?? '', key: releaseId })}
          onNewRelease={() => currentArtist && setCatalogView({ kind: 'release', artistId: currentArtist.id, key: crypto.randomUUID() })}
        />
      )
    } else if (catalogView?.kind === 'release') {
      const releaseArtistId = currentRelease?.artistId ?? catalogView.artistId
      const tracks = currentRelease ? payload.tracks.filter((track) => track.releaseId === currentRelease.id) : []
      workspace = (
        <ReleaseWorkspace
          key={catalogView.key}
          value={currentRelease}
          defaultArtistId={releaseArtistId}
          artists={payload.artists}
          tracks={tracks}
          allTracks={payload.tracks}
          releases={payload.releases}
          busy={busy}
          run={run}
          trackPanel={trackPanel}
          onBack={() => setCatalogView({ kind: 'artist', id: releaseArtistId, key: releaseArtistId })}
          onSaved={(id, artistId) => setCatalogView({ kind: 'release', id, artistId, key: id })}
          onOpenTrack={(trackId) => currentRelease && setTrackPanel({ id: trackId, artistId: releaseArtistId, releaseId: currentRelease.id, key: trackId })}
          onAddTrack={() => currentRelease && setTrackPanel({ artistId: releaseArtistId, releaseId: currentRelease.id, key: crypto.randomUUID() })}
          onTrackSaved={(id) => currentRelease && setTrackPanel({ id, artistId: releaseArtistId, releaseId: currentRelease.id, key: id })}
          onCloseTrack={() => setTrackPanel(undefined)}
          onNotice={onNotice}
          onImportPayload={setPayload}
        />
      )
    } else if (catalogView?.kind === 'track') {
      workspace = (
        <div className="vox-audio-studio-page">
          <button type="button" className="vox-audio-studio-back" onClick={() => setCatalogView({ kind: 'all-tracks', key: crypto.randomUUID() })}><ArrowLeft size={14} /> ALL TRACKS</button>
          <TrackEditor
            key={catalogView.key}
            value={currentTrack}
            defaultArtistId={catalogView.artistId}
            defaultReleaseId={catalogView.releaseId}
          artists={payload.artists}
          releases={payload.releases}
          busy={busy}
          run={run}
          onNotice={onNotice}
          onSaved={(id) => setCatalogView({ kind: 'track', id, key: id })}
          onDeleted={() => setCatalogView({ kind: 'all-tracks', key: crypto.randomUUID() })}
          />
        </div>
      )
    } else if (catalogView?.kind === 'all-tracks') {
      workspace = <AllTracksWorkspace tracks={payload.tracks} artists={payload.artists} releases={payload.releases} onNew={() => setCatalogView({ kind: 'track', key: crypto.randomUUID() })} onOpen={(track) => setCatalogView({ kind: 'track', id: track.id, artistId: track.primaryArtistId, releaseId: track.releaseId, key: track.id })} />
    } else {
      workspace = <CatalogOverview payload={payload} onNewArtist={() => setCatalogView({ kind: 'artist', key: crypto.randomUUID() })} onOpenArtist={(id) => setCatalogView({ kind: 'artist', id, key: id })} />
    }
  } else if (section === 'playlists') {
    directory = (
      <>
        <header><div><strong>PLAYLISTS</strong><small>{payload.playlists.length} CURATED</small></div><button type="button" disabled={busy} onClick={() => setPlaylistSelection({ key: crypto.randomUUID() })}><Plus size={14} /> NEW</button></header>
        {payload.playlists.map((playlist) => <button type="button" key={playlist.id} className="vox-audio-studio-directory-row" data-active={playlistSelection?.id === playlist.id ? 'true' : 'false'} onClick={() => setPlaylistSelection({ id: playlist.id, key: playlist.id })}><Artwork source={playlist.coverRef} label="" /><span><strong>{playlist.title}</strong><small>{playlist.status.toUpperCase()} · {playlist.trackIds.length} TRACKS</small></span><ChevronRight size={14} /></button>)}
        {!payload.playlists.length ? <p>NO CURATED PLAYLISTS YET.</p> : null}
      </>
    )
    const playlist = payload.playlists.find((entry) => entry.id === playlistSelection?.id)
    workspace = playlistSelection ? <div className="vox-audio-studio-page"><PlaylistEditor key={playlistSelection.key} value={playlist} tracks={payload.tracks} busy={busy} run={run} onNotice={onNotice} onSaved={(id) => setPlaylistSelection({ id, key: id })} /></div> : <Feedback title="CURATED PLAYLISTS" copy="Build editorial collections from existing native tracks. Personal listener playlists remain private and separate." action={<button type="button" onClick={() => setPlaylistSelection({ key: crypto.randomUUID() })}><Plus size={14} /> NEW CURATED PLAYLIST</button>} />
  }

  return (
    <section className="vox-audio vox-audio--studio">
      <header className="vox-audio-studio-header">
        <div><span><AudioLines size={18} /></span><strong>AUDIO STUDIO</strong><small>VOX NET // NEW VEGA PUBLISHING</small></div>
        <nav>{(['catalog', 'playlists'] as const).map((id) => <button key={id} type="button" data-active={section === id ? 'true' : 'false'} onClick={() => openSection(id)}>{id.toUpperCase()}</button>)}</nav>
        <button type="button" disabled={loading || busy} onClick={load}><RefreshCw className={loading ? 'vox-audio-spin' : undefined} size={13} /> REFRESH</button>
      </header>
      <div className="vox-audio-studio-grid">
        <aside className="vox-audio-studio-directory">{directory}</aside>
        <main className="vox-audio-studio-editor">{workspace}</main>
      </div>
      <footer className="vox-audio-studio-budget"><span>PRIVATE AUDIO LIBRARY</span><strong>{(payload.audioBytes / 1024 / 1024).toFixed(1)} MB</strong><progress value={payload.audioBytes} max={payload.audioBudgetBytes || NET_VOX_AUDIO_AUDIO_BYTE_BUDGET} /><small>{(payload.audioBudgetBytes / 1024 / 1024).toFixed(0)} MB REVIEWED LIMIT</small></footer>
      {error ? <div className="vox-audio-error" role="alert">{error}<button type="button" aria-label="Dismiss error" onClick={() => setError(undefined)}><X size={13} /></button></div> : null}
    </section>
  )
}

function CatalogOverview({ payload, onNewArtist, onOpenArtist }: {
  readonly payload: NetVoxAudioStudioPayload
  readonly onNewArtist: () => void
  readonly onOpenArtist: (id: string) => void
}) {
  return (
    <section className="vox-audio-studio-overview">
      <header><div><h1>Catalog</h1><p>Build VOX AUDIO in its natural order: artist, release, then recording.</p></div><button type="button" onClick={onNewArtist}><Plus size={14} /> CREATE ARTIST</button></header>
      <div className="vox-audio-studio-overview-stats"><span><strong>{payload.artists.length}</strong> ARTISTS</span><span><strong>{payload.releases.length}</strong> RELEASES</span><span><strong>{payload.tracks.length}</strong> TRACKS</span></div>
      {payload.artists.length ? <div className="vox-audio-studio-artist-grid">{payload.artists.slice(0, 12).map((artist) => <button type="button" key={artist.id} onClick={() => onOpenArtist(artist.id)}><Artwork source={artist.avatarRef} label={artist.name} kind="artist" /><span><strong>{artist.name}</strong><small>{artist.status.toUpperCase()}</small></span><ChevronRight size={14} /></button>)}</div> : <Feedback title="THE CATALOG IS EMPTY" copy="Create an artist first. Releases and recordings will stay grouped under that identity." action={<button type="button" onClick={onNewArtist}><Plus size={14} /> CREATE FIRST ARTIST</button>} />}
    </section>
  )
}

function ArtistWorkspace({ value, releases, busy, run, onNotice, onSaved, onOpenRelease, onNewRelease }: {
  readonly value?: NetVoxAudioGmArtist
  readonly releases: readonly NetVoxAudioGmRelease[]
  readonly busy: boolean
  readonly run: StudioRun
  readonly onNotice: (message: string) => void
  readonly onSaved: (id: string) => void
  readonly onOpenRelease: (id: string) => void
  readonly onNewRelease: () => void
}) {
  return (
    <div className="vox-audio-studio-page">
      <ArtistEditor value={value} busy={busy} run={run} onNotice={onNotice} onSaved={onSaved} />
      {value ? <section className="vox-audio-studio-related"><header><div><h3>Releases</h3><p>Albums, EPs, and singles published under {value.name}.</p></div><button type="button" disabled={busy} onClick={onNewRelease}><Plus size={14} /> NEW RELEASE</button></header>{releases.length ? <div className="vox-audio-studio-release-grid">{releases.map((release) => <button type="button" key={release.id} onClick={() => onOpenRelease(release.id)}><Artwork source={release.coverRef} label={release.title} /><span><strong>{release.title}</strong><small>{release.releaseType.toUpperCase()} · {release.status.toUpperCase()}</small></span><ChevronRight size={14} /></button>)}</div> : <Feedback title="NO RELEASES YET" copy="Create the first release without leaving this artist." action={<button type="button" onClick={onNewRelease}><Plus size={14} /> NEW RELEASE</button>} />}</section> : null}
    </div>
  )
}

function ReleaseWorkspace({ value, defaultArtistId, artists, tracks, allTracks, releases, busy, run, trackPanel, onBack, onSaved, onOpenTrack, onAddTrack, onTrackSaved, onCloseTrack, onNotice, onImportPayload }: {
  readonly value?: NetVoxAudioGmRelease
  readonly defaultArtistId: string
  readonly artists: readonly NetVoxAudioGmArtist[]
  readonly tracks: readonly NetVoxAudioGmTrack[]
  readonly allTracks: readonly NetVoxAudioGmTrack[]
  readonly releases: readonly NetVoxAudioGmRelease[]
  readonly busy: boolean
  readonly run: StudioRun
  readonly trackPanel?: TrackPanel
  readonly onBack: () => void
  readonly onSaved: (id: string, artistId: string) => void
  readonly onOpenTrack: (id: string) => void
  readonly onAddTrack: () => void
  readonly onTrackSaved: (id: string) => void
  readonly onCloseTrack: () => void
  readonly onNotice: (message: string) => void
  readonly onImportPayload: (payload: NetVoxAudioStudioPayload) => void
}) {
  const [bulkImportOpen, setBulkImportOpen] = useState(false)
  const nextTrackNumber = Math.max(0, ...tracks.map((track) => track.trackNumber ?? 0)) + 1
  const panelTrack = allTracks.find((track) => track.id === trackPanel?.id)
  return (
    <div className="vox-audio-studio-page">
      <button type="button" className="vox-audio-studio-back" onClick={onBack}><ArrowLeft size={14} /> ARTIST</button>
      <ReleaseEditor value={value} defaultArtistId={defaultArtistId} artists={artists} busy={busy} run={run} onNotice={onNotice} onSaved={onSaved} />
      {value ? <section className="vox-audio-studio-related"><header><div><h3>Tracklist</h3><p>{value.releaseType === 'single' && !tracks.length ? 'This single is ready for its canonical recording.' : `${tracks.length} ${tracks.length === 1 ? 'recording' : 'recordings'} attached to this release.`}</p></div><div className="vox-audio-studio-related-actions"><button type="button" disabled={busy} onClick={() => { setBulkImportOpen(false); onAddTrack() }}><Plus size={14} /> {value.releaseType === 'single' && !tracks.length ? 'ADD SINGLE AUDIO' : 'ADD TRACK'}</button><button type="button" disabled={busy} onClick={() => { onCloseTrack(); setBulkImportOpen((open) => !open) }}><Upload size={14} /> {bulkImportOpen ? 'CLOSE BULK IMPORT' : 'IMPORT MULTIPLE TRACKS'}</button></div></header>{tracks.length ? <div className="vox-audio-studio-tracklist">{tracks.slice().sort((a, b) => (a.discNumber - b.discNumber) || ((a.trackNumber ?? 999) - (b.trackNumber ?? 999)) || a.id.localeCompare(b.id)).map((track, index) => <button type="button" key={track.id} onClick={() => { setBulkImportOpen(false); onOpenTrack(track.id) }}><small>{String(track.trackNumber ?? index + 1).padStart(2, '0')}</small><span><strong>{track.title}</strong><small>{track.status.toUpperCase()}{track.explicit ? ' · EXPLICIT' : ''}</small></span><time>{formatVoxAudioDuration(track.durationMs)}</time><ChevronRight size={14} /></button>)}</div> : <Feedback title={value.releaseType === 'single' ? 'ADD THE SINGLE AUDIO' : 'NO TRACKS YET'} copy="Choose an audio file; artist and release are already locked to this context." action={<button type="button" onClick={onAddTrack}><Plus size={14} /> {value.releaseType === 'single' ? 'ADD SINGLE AUDIO' : 'ADD FIRST TRACK'}</button>} />}</section> : null}
      {value && bulkImportOpen ? <BulkTrackImportPanel key={value.id} artistId={value.artistId} releaseId={value.id} releaseCoverRef={value.coverRef} nextTrackNumber={nextTrackNumber} disabled={busy} onImportPayload={onImportPayload} onNotice={onNotice} onClose={() => setBulkImportOpen(false)} /> : null}
        {trackPanel ? <aside className="vox-audio-studio-track-panel"><header><div><strong>{panelTrack ? 'EDIT RECORDING' : 'ADD TO RELEASE'}</strong><small>{value?.title}</small></div><button type="button" aria-label="Close track editor" onClick={onCloseTrack}><X size={15} /></button></header><TrackEditor key={trackPanel.key} value={panelTrack} defaultArtistId={trackPanel.artistId} defaultReleaseId={trackPanel.releaseId} defaultTrackNumber={nextTrackNumber} artists={artists} releases={releases} busy={busy} run={run} onNotice={onNotice} lockedContext onSaved={onTrackSaved} onDeleted={onCloseTrack} /></aside> : null}
    </div>
  )
}

function AllTracksWorkspace({ tracks, artists, releases, onNew, onOpen }: {
  readonly tracks: readonly NetVoxAudioGmTrack[]
  readonly artists: readonly NetVoxAudioGmArtist[]
  readonly releases: readonly NetVoxAudioGmRelease[]
  readonly onNew: () => void
  readonly onOpen: (track: NetVoxAudioGmTrack) => void
}) {
  return (
    <section className="vox-audio-studio-overview">
      <header><div><h1>All tracks</h1><p>Advanced management for standalone recordings and cross-catalog review.</p></div><button type="button" disabled={!artists.length} onClick={onNew}><Plus size={14} /> NEW STANDALONE TRACK</button></header>
      {tracks.length ? <div className="vox-audio-studio-tracklist">{tracks.map((track, index) => <button type="button" key={track.id} onClick={() => onOpen(track)}><small>{String(track.trackNumber ?? index + 1).padStart(2, '0')}</small><span><strong>{track.title}</strong><small>{artists.find((artist) => artist.id === track.primaryArtistId)?.name ?? 'UNKNOWN ARTIST'} · {releases.find((release) => release.id === track.releaseId)?.title ?? 'STANDALONE'}</small></span><time>{formatVoxAudioDuration(track.durationMs)}</time><ChevronRight size={14} /></button>)}</div> : <Feedback title="NO NATIVE TRACKS" copy="The preferred workflow is Artist → Release → Add Track. Standalone tracks can also be registered here." action={<button type="button" disabled={!artists.length} onClick={onNew}><Plus size={14} /> NEW STANDALONE TRACK</button>} />}
    </section>
  )
}

function ArtistEditor({ value, busy, run, onNotice, onSaved }: {
  readonly value?: NetVoxAudioGmArtist
  readonly busy: boolean
  readonly run: StudioRun
  readonly onNotice: (message: string) => void
  readonly onSaved: (id: string) => void
}) {
  const [recordId] = useState(() => value?.id ?? crypto.randomUUID())
  const [name, setName] = useState(value?.name ?? '')
  const [slug, setSlug] = useState(value?.slug ?? '')
  const [bio, setBio] = useState(value?.bio ?? '')
  const [avatarRef, setAvatarRef] = useState(value?.avatarRef ?? '')
  const [bannerRef, setBannerRef] = useState(value?.bannerRef ?? '')
  const [avatarRefDraft, setAvatarRefDraft] = useState<string>()
  const [bannerRefDraft, setBannerRefDraft] = useState<string>()
  const [status, setStatus] = useState<NetVoxAudioStatus>(value?.status ?? 'draft')
  const [featured, setFeatured] = useState(value?.featured ?? false)
  const [advanced, setAdvanced] = useState(false)
  const save = (event?: FormEvent) => {
    event?.preventDefault()
    void run(async () => {
      const nextAvatarRef = avatarRefDraft?.trim() || avatarRef
      const nextBannerRef = bannerRefDraft?.trim() || bannerRef
      try {
        const payload = await saveNetVoxAudioGmArtist({
          id: recordId,
          name,
          slug,
          bio,
          avatarRef: nextAvatarRef,
          bannerRef: nextBannerRef,
          status,
          featured,
        })
        const committedAvatarRef = await commitSharedMediaReplacement(
          avatarRef,
          nextAvatarRef,
        )
        await finalizeSharedMediaReplacement(avatarRef, committedAvatarRef, onNotice, 'artist avatar')
        const committedBannerRef = await commitSharedMediaReplacement(
          bannerRef,
          nextBannerRef,
        )
        await finalizeSharedMediaReplacement(bannerRef, committedBannerRef, onNotice, 'artist banner')
        setAvatarRef(committedAvatarRef ?? '')
        setBannerRef(committedBannerRef ?? '')
        setAvatarRefDraft(undefined)
        setBannerRefDraft(undefined)
        return payload
      } catch (error) {
        await rollbackSharedMediaUpload(nextAvatarRef, avatarRef, onNotice, 'artist avatar')
        await rollbackSharedMediaUpload(nextBannerRef, bannerRef, onNotice, 'artist banner')
        throw error
      }
    }, 'VOX AUDIO // ARTIST SAVED', (nextPayload) => onSaved(confirmedStudioRecordId(nextPayload.artists, recordId, 'artist')))
  }
  return <form className="vox-audio-studio-form" onSubmit={save}><header><div><small>{value ? 'EDIT ARTIST' : 'NEW ARTIST'}</small><h2>{name || 'Create artist'}</h2><p>{value ? 'Identity, presentation, and publishing state.' : 'Create the catalog identity first; releases and artwork follow immediately.'}</p></div><button type="submit" disabled={busy}><Check size={14} /> {busy ? 'SAVING…' : 'SAVE ARTIST'}</button></header><fieldset><legend>ARTIST IDENTITY</legend><label>ARTIST NAME<input value={name} maxLength={120} required onChange={(event) => { setName(event.target.value); if (!value) setSlug(audioSlug(event.target.value)) }} /></label><label>BIOGRAPHY<textarea value={bio} maxLength={4000} rows={7} onChange={(event) => setBio(event.target.value)} /></label><button type="button" className="vox-audio-studio-advanced-toggle" onClick={() => setAdvanced((shown) => !shown)}>{advanced ? 'HIDE' : 'SHOW'} ADVANCED METADATA</button>{advanced ? <label>STABLE SLUG<input value={slug} maxLength={120} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required onChange={(event) => setSlug(event.target.value)} /><small>Used in stable references. It will not change automatically after creation.</small></label> : null}</fieldset><fieldset><legend>PRESENTATION & PUBLICATION</legend><StudioArtworkUpload subjectId={value?.id} slot="avatar" label="ARTIST AVATAR" source={avatarRefDraft ?? avatarRef} previewLabel={`${name || 'Artist'} avatar`} kind="artist" onUploaded={setAvatarRefDraft} /><StudioArtworkUpload subjectId={value?.id} slot="banner" label="ARTIST BANNER" source={bannerRefDraft ?? bannerRef} previewLabel={`${name || 'Artist'} banner`} kind="banner" onUploaded={setBannerRefDraft} /><div className="vox-audio-form-pair"><label>STATUS<select value={status} onChange={(event) => setStatus(event.target.value as NetVoxAudioStatus)}>{statusOptions}</select></label><label className="vox-audio-check"><input type="checkbox" checked={featured} onChange={(event) => setFeatured(event.target.checked)} /> FEATURED</label></div></fieldset></form>
}

function ReleaseEditor({ value, defaultArtistId, artists, busy, run, onNotice, onSaved }: {
  readonly value?: NetVoxAudioGmRelease
  readonly defaultArtistId: string
  readonly artists: readonly NetVoxAudioGmArtist[]
  readonly busy: boolean
  readonly run: StudioRun
  readonly onNotice: (message: string) => void
  readonly onSaved: (id: string, artistId: string) => void
}) {
  const [recordId] = useState(() => value?.id ?? crypto.randomUUID())
  const [artistId, setArtistId] = useState(value?.artistId ?? defaultArtistId ?? artists[0]?.id ?? '')
  const [title, setTitle] = useState(value?.title ?? '')
  const [slug, setSlug] = useState(value?.slug ?? '')
  const [releaseType, setReleaseType] = useState(value?.releaseType ?? 'album')
  const [coverRef, setCoverRef] = useState(value?.coverRef ?? '')
  const [coverRefDraft, setCoverRefDraft] = useState<string>()
  const [releaseDate, setReleaseDate] = useState(value?.releaseDate ?? '')
  const [description, setDescription] = useState(value?.description ?? '')
  const [status, setStatus] = useState<NetVoxAudioStatus>(value?.status ?? 'draft')
  const [featured, setFeatured] = useState(value?.featured ?? false)
  const [advanced, setAdvanced] = useState(false)
  return <form className="vox-audio-studio-form vox-audio-studio-form--release" onSubmit={(event) => {
    event.preventDefault()
    void run(async () => {
      const nextCoverRef = coverRefDraft?.trim() || coverRef
      try {
          const payload = await saveNetVoxAudioGmRelease({
            id: recordId,
            artistId,
            title,
          slug,
          releaseType,
          coverRef: nextCoverRef,
          releaseDate,
          description,
          status,
          featured,
          })
        const committedCoverRef = await commitSharedMediaReplacement(
          coverRef,
          nextCoverRef,
        )
        await finalizeSharedMediaReplacement(coverRef, committedCoverRef, onNotice, 'release cover')
        setCoverRef(committedCoverRef ?? '')
        setCoverRefDraft(undefined)
        return payload
      } catch (error) {
        await rollbackSharedMediaUpload(nextCoverRef, coverRef, onNotice, 'release cover')
        throw error
      }
    }, 'VOX AUDIO // RELEASE SAVED', (nextPayload) => onSaved(confirmedStudioRecordId(nextPayload.releases, recordId, 'release'), artistId))
  }}><header><div><small>{value ? 'EDIT RELEASE' : 'NEW RELEASE'}</small><h2>{title || 'Create release'}</h2><p>{artists.find((artist) => artist.id === artistId)?.name ?? 'Select a catalog artist'}</p></div><button type="submit" disabled={busy || !artists.length}><Check size={14} /> {busy ? 'SAVING…' : 'SAVE RELEASE'}</button></header>{!artists.length ? <Feedback title="CREATE AN ARTIST FIRST" copy="Every release belongs to one canonical VOX AUDIO artist." /> : <><fieldset className="vox-audio-studio-cover-field"><legend>RELEASE COVER</legend><StudioArtworkUpload subjectId={value?.id} slot="cover" label="COVER" source={coverRefDraft ?? coverRef} previewLabel={`${title || 'Release'} cover`} onUploaded={setCoverRefDraft} /></fieldset><fieldset><legend>RELEASE METADATA</legend><label>ARTIST<select value={artistId} onChange={(event) => setArtistId(event.target.value)}>{artists.map((artist) => <option key={artist.id} value={artist.id}>{artist.name}</option>)}</select></label><label>TITLE<input value={title} maxLength={160} required onChange={(event) => { setTitle(event.target.value); if (!value) setSlug(audioSlug(event.target.value)) }} /></label><div className="vox-audio-form-pair"><label>FORMAT<select value={releaseType} onChange={(event) => setReleaseType(event.target.value as typeof releaseType)}>{netVoxAudioReleaseTypes.map((type) => <option key={type} value={type}>{type.toUpperCase()}</option>)}</select></label><label>RELEASE DATE<input type="date" value={releaseDate} onChange={(event) => setReleaseDate(event.target.value)} /></label></div><label>DESCRIPTION<textarea rows={5} value={description} maxLength={4000} onChange={(event) => setDescription(event.target.value)} /></label><div className="vox-audio-form-pair"><label>STATUS<select value={status} onChange={(event) => setStatus(event.target.value as NetVoxAudioStatus)}>{statusOptions}</select></label><label className="vox-audio-check"><input type="checkbox" checked={featured} onChange={(event) => setFeatured(event.target.checked)} /> FEATURED</label></div><button type="button" className="vox-audio-studio-advanced-toggle" onClick={() => setAdvanced((shown) => !shown)}>{advanced ? 'HIDE' : 'SHOW'} ADVANCED METADATA</button>{advanced ? <label>STABLE SLUG<input value={slug} required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" onChange={(event) => setSlug(event.target.value)} /><small>Changing a published reference should be intentional.</small></label> : null}</fieldset></>}</form>
}

function TrackEditor({ value, defaultArtistId, defaultReleaseId, defaultTrackNumber, artists, releases, busy, run, lockedContext = false, onNotice, onSaved, onDeleted }: {
  readonly value?: NetVoxAudioGmTrack
  readonly defaultArtistId?: string
  readonly defaultReleaseId?: string
  readonly defaultTrackNumber?: number
  readonly artists: readonly NetVoxAudioGmArtist[]
  readonly releases: readonly NetVoxAudioGmRelease[]
  readonly busy: boolean
  readonly run: StudioRun
  readonly lockedContext?: boolean
  readonly onNotice: (message: string) => void
  readonly onSaved: (id: string) => void
  readonly onDeleted: () => void
}) {
  const [recordId] = useState(() => value?.id ?? crypto.randomUUID())
  const [artistId, setArtistId] = useState(value?.primaryArtistId ?? defaultArtistId ?? artists[0]?.id ?? '')
  const [releaseId, setReleaseId] = useState(value?.releaseId ?? defaultReleaseId ?? '')
  const [title, setTitle] = useState(value?.title ?? '')
  const [trackNumber, setTrackNumber] = useState(value?.trackNumber?.toString() ?? defaultTrackNumber?.toString() ?? '')
  const [discNumber, setDiscNumber] = useState(value?.discNumber.toString() ?? '1')
  const [artworkRef, setArtworkRef] = useState(value?.artworkRef ?? '')
  const [artworkRefDraft, setArtworkRefDraft] = useState<string>()
  const [status, setStatus] = useState<NetVoxAudioStatus>(value?.status ?? 'draft')
  const [featured, setFeatured] = useState(value?.featured ?? false)
  const [explicit, setExplicit] = useState(value?.explicit ?? false)
  const [file, setFile] = useState<File>()
  const [fileMetadata, setFileMetadata] = useState<AudioInspection>()
  const [fileError, setFileError] = useState<string>()
  // Embedded cover art detected from the selected audio file's own metadata.
  // Only offered for brand-new tracks: Storage RLS requires the track row to
  // exist before any artwork object can be written, and replacing audio on an
  // already-published track must never silently overwrite curated artwork.
  const [embeddedArtwork, setEmbeddedArtwork] = useState<{ readonly blob: Blob; readonly mimeType: string; readonly previewUrl: string }>()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const fileGenerationRef = useRef(0)
  const compatibleReleases = releases.filter((release) => release.artistId === artistId)
  const artistName = artists.find((artist) => artist.id === artistId)?.name
  const releaseName = releases.find((release) => release.id === releaseId)?.title
  useEffect(() => () => { if (embeddedArtwork) URL.revokeObjectURL(embeddedArtwork.previewUrl) }, [embeddedArtwork])
  const selectFile = (nextFile?: File) => {
    if (!nextFile) return
    const generation = ++fileGenerationRef.current
    setFile(nextFile); setFileMetadata(undefined); setFileError(undefined)
    setEmbeddedArtwork(undefined)
    if (!value && !title.trim()) setTitle(titleFromAudioFilename(nextFile.name))
    void inspectNetVoxAudioAudioFile(nextFile)
      .then((metadata) => { if (generation === fileGenerationRef.current) setFileMetadata(metadata) })
      .catch((metadataError) => {
        if (generation !== fileGenerationRef.current) return
        setFile(undefined)
        setFileMetadata(undefined)
        setFileError(metadataError instanceof Error ? metadataError.message : 'Audio validation failed.')
      })
    if (!value) {
      void extractEmbeddedAudioArtwork(nextFile)
        .then((artwork) => {
          if (generation !== fileGenerationRef.current || !artwork) return
          setEmbeddedArtwork({ blob: artwork.blob, mimeType: artwork.mimeType, previewUrl: URL.createObjectURL(artwork.blob) })
        })
        .catch(() => undefined)
    }
  }
  const nextArtworkRef = artworkRefDraft?.trim() || artworkRef
  const input = {
    id: recordId,
    artistId,
    releaseId: releaseId || undefined,
    title,
    trackNumber: trackNumber ? Number(trackNumber) : undefined,
    discNumber: Number(discNumber),
    artworkRef: nextArtworkRef,
    explicit,
    status,
    featured,
  }
  return <form className="vox-audio-studio-form vox-audio-studio-form--track" onSubmit={(event) => {
    event.preventDefault()
    if (!value && (!file || !fileMetadata)) return
    let artworkWarning: string | undefined
    void run(async () => {
      try {
          const payload = value
            ? await updateNetVoxAudioGmTrack({ ...input, id: value.id })
            : await createNetVoxAudioGmTrack(input, file!)
        const committedArtworkRef = await commitSharedMediaReplacement(
          artworkRef,
          nextArtworkRef,
        )
        await finalizeSharedMediaReplacement(artworkRef, committedArtworkRef, onNotice, 'track artwork')
        let finalArtworkRef = committedArtworkRef
        let finalPayload = payload
        // Embedded artwork only ever fills in for a brand-new track with no
        // manual artwork already committed; manual selection always wins.
        if (!value && embeddedArtwork && !finalArtworkRef) {
          const createdId = confirmedStudioRecordId(payload.tracks, recordId, 'track')
          try {
            const { reference } = await uploadSharedImage(
              { subjectKind: 'vox-audio-artwork', subjectId: createdId, mediaKind: 'general', slot: 'track' },
              embeddedArtwork.blob,
              'general',
            )
            try {
              finalPayload = await updateNetVoxAudioGmTrack({ ...input, id: createdId, artworkRef: reference })
              finalArtworkRef = reference
            } catch {
              await removeSharedMediaReference(reference).catch(() => undefined)
              artworkWarning = 'embedded artwork could not be saved'
            }
          } catch {
            artworkWarning = 'embedded artwork could not be read'
          }
        }
        setArtworkRef(finalArtworkRef ?? '')
        setArtworkRefDraft(undefined)
        return finalPayload
      } catch (error) {
        await rollbackSharedMediaUpload(nextArtworkRef, artworkRef, onNotice, 'track artwork')
        throw error
      }
    }, () => artworkWarning
      ? `VOX AUDIO // TRACK ${value ? 'SAVED' : 'REGISTERED'} — ${artworkWarning.toUpperCase()}`
      : `VOX AUDIO // TRACK ${value ? 'SAVED' : 'REGISTERED'}`,
    (nextPayload) => onSaved(confirmedStudioRecordId(nextPayload.tracks, recordId, 'track')))
  }}><header><div><small>{value ? 'EDIT TRACK' : 'NEW NATIVE TRACK'}</small><h2>{title || 'Add a recording'}</h2><p>{lockedContext ? `${artistName ?? 'Artist'} · ${releaseName ?? 'Release'}` : 'Canonical VOX AUDIO audio and editorial metadata.'}</p></div><button type="submit" disabled={busy || !artists.length || (!value && (!file || !fileMetadata))}><Check size={14} /> {busy ? 'WORKING…' : value ? 'SAVE TRACK' : 'UPLOAD & ADD TRACK'}</button></header><fieldset><legend>{value ? 'AUDIO MASTER' : '1 · SELECT AUDIO FILE'}</legend><input ref={fileRef} type="file" hidden accept="audio/mpeg,audio/mp4,audio/m4a,audio/x-m4a,audio/ogg,audio/webm,.mp3,.m4a,.mp4,.ogg,.webm" onChange={(event) => selectFile(event.target.files?.[0])} /><button type="button" className="vox-audio-file-button" onClick={() => fileRef.current?.click()}><Upload size={14} /> {file ? 'REPLACE SELECTION' : value ? 'CHOOSE REPLACEMENT AUDIO' : 'SELECT AUDIO FILE'}</button>{file ? <div className="vox-audio-audio-summary" data-valid={fileMetadata ? 'true' : 'false'}><span><small>FILE</small><strong>{file.name}</strong></span><span><small>SIZE</small><strong>{fileMetadata ? `${(fileMetadata.byteSize / 1024 / 1024).toFixed(2)} MB` : 'READING…'}</strong></span><span><small>DURATION</small><strong>{fileMetadata ? formatVoxAudioDuration(fileMetadata.durationMs) : '—'}</strong></span><span><small>FORMAT</small><strong>{fileMetadata?.mimeType ?? 'VALIDATING'}</strong></span></div> : <p className="vox-audio-file-status">{value ? `${value.audioMimeType} · ${(value.audioByteSize / 1024 / 1024).toFixed(2)} MB · ${formatVoxAudioDuration(value.durationMs)}` : 'MP3, M4A/MP4, OGG or WebM · max 15 MB / 15 min'}</p>}{fileError ? <p className="vox-audio-file-error" role="alert">{fileError}</p> : null}{value && file && fileMetadata ? <button type="button" disabled={busy} onClick={() => { void run(() => replaceNetVoxAudioGmTrackAudio(value.id, file), 'VOX AUDIO // TRACK AUDIO REPLACED') }}>REPLACE AUDIO ONLY</button> : null}</fieldset><fieldset><legend>2 · TRACK DETAILS</legend>{lockedContext ? <div className="vox-audio-studio-context"><span><small>ARTIST</small><strong>{artistName}</strong></span><ChevronRight size={13} /><span><small>RELEASE</small><strong>{releaseName}</strong></span></div> : <><label>ARTIST<select value={artistId} onChange={(event) => { setArtistId(event.target.value); setReleaseId('') }}>{artists.map((artist) => <option key={artist.id} value={artist.id}>{artist.name}</option>)}</select></label><label>RELEASE<select value={releaseId} onChange={(event) => setReleaseId(event.target.value)}><option value="">STANDALONE</option>{compatibleReleases.map((release) => <option key={release.id} value={release.id}>{release.title}</option>)}</select></label></>}<label>TRACK TITLE<input required maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} /></label><div className="vox-audio-form-pair"><label>TRACK NUMBER<input type="number" min={1} max={999} value={trackNumber} onChange={(event) => setTrackNumber(event.target.value)} /></label><label>DISC<input type="number" min={1} max={99} value={discNumber} onChange={(event) => setDiscNumber(event.target.value)} /></label></div><StudioArtworkUpload subjectId={value?.id} slot="track" label="TRACK ARTWORK" source={artworkRefDraft ?? artworkRef} previewLabel={`${title || 'Track'} artwork`} embeddedPreviewUrl={!value ? embeddedArtwork?.previewUrl : undefined} onUploaded={setArtworkRefDraft} /></fieldset><fieldset><legend>3 · PUBLICATION</legend><label>STATUS<select value={status} onChange={(event) => setStatus(event.target.value as NetVoxAudioStatus)}>{statusOptions}</select></label><label className="vox-audio-check"><input type="checkbox" checked={explicit} onChange={(event) => setExplicit(event.target.checked)} /> EXPLICIT</label><label className="vox-audio-check"><input type="checkbox" checked={featured} onChange={(event) => setFeatured(event.target.checked)} /> FEATURED</label>{value?.status === 'archived' ? <button type="button" className="vox-audio-danger" onClick={() => { if (window.confirm(`Permanently delete ${value.title}? This requires no playlist/like dependencies and removes its exact audio object.`)) void run(() => deleteNetVoxAudioGmTrack(value.id), 'VOX AUDIO // TRACK PERMANENTLY DELETED', onDeleted) }}><Trash2 size={14} /> PERMANENT DELETE</button> : null}</fieldset></form>
}

type BulkTrackStatus = 'waiting' | 'uploading' | 'done' | 'failed'

interface StagedBulkTrack {
  readonly key: string
  readonly id: string
  readonly file: File
  readonly title: string
  readonly fallbackTitle: string
  readonly trackNumber: string
  readonly explicit: boolean
  readonly inspecting: boolean
  readonly durationMs?: number
  readonly inspectError?: string
  readonly embeddedArtwork?: { readonly blob: Blob; readonly mimeType: string; readonly previewUrl: string }
  readonly sortHint: number
  readonly selectionOrder: number
  readonly status: BulkTrackStatus
  readonly error?: string
  readonly trackId?: string
}

function leadingFilenameTrackNumber(filename: string): number | undefined {
  const base = filename.replace(/\.[^.]+$/, '')
  const match = base.match(/^\s*(\d{1,3})(?=[\s._-]|$)/)
  if (!match) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function bulkStatusLabel(status: BulkTrackStatus): string {
  if (status === 'waiting') return 'WAITING'
  if (status === 'uploading') return 'UPLOADING…'
  if (status === 'done') return 'DONE'
  return 'FAILED'
}

// New batches sort by (embedded track number, filename number, selection order); existing rows
// keep whatever position the GM already arranged, so a second import never reshuffles the queue.
function resortBulkBatch(all: readonly StagedBulkTrack[], batchKeys: ReadonlySet<string>): readonly StagedBulkTrack[] {
  const indices: number[] = []
  all.forEach((item, index) => { if (batchKeys.has(item.key)) indices.push(index) })
  if (indices.length < 2) return all
  const sortedBatch = indices.map((index) => all[index]).sort((a, b) => (a.sortHint - b.sortHint) || (a.selectionOrder - b.selectionOrder))
  const next = all.slice()
  indices.forEach((index, position) => { next[index] = sortedBatch[position] })
  return next
}

function BulkTrackImportPanel({ artistId, releaseId, releaseCoverRef, nextTrackNumber, disabled, onImportPayload, onNotice, onClose }: {
  readonly artistId: string
  readonly releaseId: string
  readonly releaseCoverRef?: string
  readonly nextTrackNumber: number
  readonly disabled: boolean
  readonly onImportPayload: (payload: NetVoxAudioStudioPayload) => void
  readonly onNotice: (message: string) => void
  readonly onClose: () => void
}) {
  const [staged, setStaged] = useState<readonly StagedBulkTrack[]>([])
  const [useReleaseCoverForAll, setUseReleaseCoverForAll] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [queueProgress, setQueueProgress] = useState<{ readonly done: number; readonly total: number }>()
  const stagedRef = useRef<readonly StagedBulkTrack[]>(staged)
  stagedRef.current = staged
  const coverForAllRef = useRef(useReleaseCoverForAll)
  coverForAllRef.current = useReleaseCoverForAll
  const uploadingRef = useRef(false)
  const selectionCounterRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const dragKeyRef = useRef<string | undefined>(undefined)

  useEffect(() => () => { stagedRef.current.forEach((item) => { if (item.embeddedArtwork) URL.revokeObjectURL(item.embeddedArtwork.previewUrl) }) }, [])

  const addFiles = (files: FileList | null) => {
    if (!files || !files.length) return
    const incoming = Array.from(files)
    const batch: StagedBulkTrack[] = incoming.map((file, index) => {
      const fallbackTitle = titleFromAudioFilename(file.name)
      return {
        key: crypto.randomUUID(), id: crypto.randomUUID(), file, title: fallbackTitle, fallbackTitle,
        trackNumber: '', explicit: false, inspecting: true, sortHint: Number.POSITIVE_INFINITY,
        selectionOrder: selectionCounterRef.current + index, status: 'waiting',
      }
    })
    selectionCounterRef.current += incoming.length
    const batchKeys = new Set(batch.map((entry) => entry.key))
    setStaged((prev) => [...prev, ...batch])
    void Promise.all(batch.map(async (entry) => {
      const [metadataResult, tagsResult, artworkResult] = await Promise.allSettled([
        inspectNetVoxAudioAudioFile(entry.file),
        extractEmbeddedAudioTags(entry.file),
        extractEmbeddedAudioArtwork(entry.file),
      ])
      const durationMs = metadataResult.status === 'fulfilled' ? metadataResult.value.durationMs : undefined
      const inspectError = metadataResult.status === 'fulfilled' ? undefined : studioErrorMessage(metadataResult.reason)
      const tags: ExtractedAudioTags = tagsResult.status === 'fulfilled' ? tagsResult.value : {}
      const artwork = artworkResult.status === 'fulfilled' ? artworkResult.value : undefined
      const detectedNumber = tags.trackNumber ?? leadingFilenameTrackNumber(entry.file.name)
      setStaged((prev) => prev.map((item) => item.key === entry.key ? {
        ...item,
        inspecting: false,
        durationMs,
        inspectError,
        status: inspectError ? 'failed' : item.status,
        title: item.title === item.fallbackTitle && tags.title ? tags.title : item.title,
        trackNumber: item.trackNumber === '' && detectedNumber ? String(detectedNumber) : item.trackNumber,
        embeddedArtwork: artwork ? { blob: artwork.blob, mimeType: artwork.mimeType, previewUrl: URL.createObjectURL(artwork.blob) } : item.embeddedArtwork,
        sortHint: detectedNumber ?? Number.POSITIVE_INFINITY,
      } : item))
    })).then(() => setStaged((prev) => resortBulkBatch(prev, batchKeys)))
  }

  const updateItem = (key: string, patch: Partial<Pick<StagedBulkTrack, 'title' | 'trackNumber' | 'explicit'>>) => {
    setStaged((prev) => prev.map((item) => item.key === key ? { ...item, ...patch } : item))
  }

  const removeItem = (key: string) => {
    setStaged((prev) => {
      const target = prev.find((item) => item.key === key)
      if (target?.embeddedArtwork) URL.revokeObjectURL(target.embeddedArtwork.previewUrl)
      return prev.filter((item) => item.key !== key)
    })
  }

  const clearBatch = () => {
    if (uploadingRef.current) return
    stagedRef.current.forEach((item) => { if (item.embeddedArtwork) URL.revokeObjectURL(item.embeddedArtwork.previewUrl) })
    setStaged([])
    setQueueProgress(undefined)
  }

  const moveItem = (key: string, direction: -1 | 1) => {
    setStaged((prev) => {
      const index = prev.findIndex((item) => item.key === key)
      const targetIndex = index + direction
      if (index < 0 || targetIndex < 0 || targetIndex >= prev.length) return prev
      const next = prev.slice()
      const [moved] = next.splice(index, 1)
      next.splice(targetIndex, 0, moved)
      return next
    })
  }

  const reorderByDrag = (sourceKey: string, targetKey: string) => {
    if (sourceKey === targetKey) return
    setStaged((prev) => {
      const sourceIndex = prev.findIndex((item) => item.key === sourceKey)
      const targetIndex = prev.findIndex((item) => item.key === targetKey)
      if (sourceIndex < 0 || targetIndex < 0) return prev
      const next = prev.slice()
      const [moved] = next.splice(sourceIndex, 1)
      next.splice(targetIndex, 0, moved)
      return next
    })
  }

  // Sequential, bounded queue: one track at a time so a single failure never
  // races ahead of or clobbers already-successful uploads, and RETRY can pass
  // just the one failed key without touching anything already 'done'.
  const runQueue = async (keys: readonly string[]) => {
    if (uploadingRef.current || !keys.length) return
    uploadingRef.current = true
    setBulkBusy(true)
    setQueueProgress({ done: 0, total: keys.length })
    for (const key of keys) {
      const current = stagedRef.current.find((item) => item.key === key)
      if (!current || current.status === 'done' || current.status === 'uploading' || current.inspecting) {
        setQueueProgress((prev) => prev ? { ...prev, done: prev.done + 1 } : prev)
        continue
      }
      setStaged((prev) => prev.map((item) => item.key === key ? { ...item, status: 'uploading', error: undefined } : item))
      try {
        const trimmedNumber = current.trackNumber.trim()
        const parsedNumber = trimmedNumber ? Number(trimmedNumber) : undefined
        const input = {
          id: current.id, artistId, releaseId, title: current.title.trim() || current.fallbackTitle,
          trackNumber: parsedNumber !== undefined && Number.isFinite(parsedNumber) ? parsedNumber : undefined,
          discNumber: 1, explicit: current.explicit, status: 'draft' as NetVoxAudioStatus, featured: false,
        }
        let createdPayload = await createNetVoxAudioGmTrack(input, current.file)
        const createdId = confirmedStudioRecordId(createdPayload.tracks, current.id, 'track')
        if (!coverForAllRef.current && current.embeddedArtwork) {
          let reference: string | undefined
          try {
            reference = (await uploadSharedImage(
              { subjectKind: 'vox-audio-artwork', subjectId: createdId, mediaKind: 'general', slot: 'track' },
              current.embeddedArtwork.blob,
              'general',
            )).reference
            createdPayload = await updateNetVoxAudioGmTrack({ ...input, id: createdId, artworkRef: reference })
          } catch {
            // Best-effort embedded artwork only — the track itself already registered successfully,
            // and it still resolves a cover via the existing track → release → artist fallback.
            if (reference) await rollbackSharedMediaUpload(reference, undefined, onNotice, 'track artwork')
          }
        }
        onImportPayload(createdPayload)
        setStaged((prev) => prev.map((item) => item.key === key ? { ...item, status: 'done', trackId: createdId, error: undefined } : item))
      } catch (uploadError) {
        setStaged((prev) => prev.map((item) => item.key === key ? { ...item, status: 'failed', error: studioErrorMessage(uploadError) } : item))
      }
      setQueueProgress((prev) => prev ? { ...prev, done: prev.done + 1 } : prev)
    }
    uploadingRef.current = false
    setBulkBusy(false)
    const failedCount = stagedRef.current.filter((item) => keys.includes(item.key) && item.status === 'failed').length
    onNotice(failedCount
      ? `VOX AUDIO // BULK IMPORT FINISHED — ${failedCount} TRACK${failedCount === 1 ? '' : 'S'} FAILED`
      : 'VOX AUDIO // BULK IMPORT COMPLETE')
  }

  const uploadAll = () => {
    if (uploadingRef.current) return
    let keys: string[] = []
    setStaged((prev) => {
      let nextAuto = nextTrackNumber
      const assigned = prev.map((item) => {
        if (item.trackNumber.trim()) {
          const parsed = Number(item.trackNumber)
          if (Number.isFinite(parsed)) nextAuto = Math.max(nextAuto, parsed + 1)
          return item
        }
        const value = nextAuto
        nextAuto += 1
        return { ...item, trackNumber: String(value) }
      })
      stagedRef.current = assigned
      keys = assigned.filter((item) => item.status !== 'done' && !item.inspecting).map((item) => item.key)
      return assigned
    })
    void runQueue(keys)
  }

  const doneCount = staged.filter((item) => item.status === 'done').length
  const failedCount = staged.filter((item) => item.status === 'failed').length
  const uploadableCount = staged.filter((item) => item.status !== 'done' && !item.inspecting).length

  return (
    <section className="vox-audio-studio-related vox-audio-bulk-import">
      <header><div><h3>Bulk Import</h3><p>Select several audio files, arrange them, then upload together into this release.</p></div><button type="button" onClick={onClose}><X size={14} /> CLOSE</button></header>
      <input ref={fileInputRef} type="file" multiple hidden accept="audio/mpeg,audio/mp4,audio/m4a,audio/x-m4a,audio/ogg,audio/webm,.mp3,.m4a,.mp4,.ogg,.webm" onChange={(event) => { addFiles(event.target.files); event.target.value = '' }} />
      <div className="vox-audio-bulk-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files) }}><Upload size={18} /><p>Drag audio files here, or</p><button type="button" disabled={disabled} onClick={() => fileInputRef.current?.click()}>SELECT FILES</button></div>
      {staged.length ? <>
        <div className="vox-audio-bulk-toolbar">
          <span>{staged.length} QUEUED · {doneCount} DONE{failedCount ? ` · ${failedCount} FAILED` : ''}</span>
          <div><button type="button" disabled={bulkBusy || disabled || !releaseCoverRef} data-active={useReleaseCoverForAll ? 'true' : 'false'} onClick={() => setUseReleaseCoverForAll((value) => !value)}>USE RELEASE COVER FOR ALL</button><button type="button" disabled={bulkBusy || disabled} onClick={clearBatch}><Trash2 size={13} /> CLEAR BATCH</button></div>
        </div>
        <ol className="vox-audio-bulk-list">
          {staged.map((item, index) => <li key={item.key} className="vox-audio-bulk-row" data-status={item.status} draggable={!bulkBusy && !disabled} onDragStart={() => { dragKeyRef.current = item.key }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const sourceKey = dragKeyRef.current; dragKeyRef.current = undefined; if (sourceKey) reorderByDrag(sourceKey, item.key) }}>
            <span className="vox-audio-bulk-row__handle"><GripVertical size={14} /></span>
            <span className="vox-audio-bulk-row__artwork">{item.embeddedArtwork && !useReleaseCoverForAll ? <img src={item.embeddedArtwork.previewUrl} alt="" /> : <Disc3 size={16} />}</span>
            <div className="vox-audio-bulk-row__fields">
              <div className="vox-audio-bulk-row__filename">{item.file.name}</div>
              <div className="vox-audio-bulk-row__inputs">
                <input aria-label="Track number" inputMode="numeric" value={item.trackNumber} placeholder="#" disabled={bulkBusy || disabled} onChange={(event) => updateItem(item.key, { trackNumber: event.target.value.replace(/\D+/g, '').slice(0, 4) })} />
                <input aria-label="Track title" value={item.title} maxLength={180} disabled={bulkBusy || disabled} onChange={(event) => updateItem(item.key, { title: event.target.value })} />
                <label className="vox-audio-check"><input type="checkbox" checked={item.explicit} disabled={bulkBusy || disabled} onChange={(event) => updateItem(item.key, { explicit: event.target.checked })} /> EXPLICIT</label>
              </div>
              <div className="vox-audio-bulk-row__meta"><small>{item.inspecting ? 'READING…' : item.durationMs ? formatVoxAudioDuration(item.durationMs) : '—'}</small>{item.inspectError ? <small className="vox-audio-bulk-row__error">{item.inspectError}</small> : null}</div>
            </div>
            <div className="vox-audio-bulk-row__status"><small>{bulkStatusLabel(item.status)}</small>{item.status === 'failed' && item.error ? <span className="vox-audio-bulk-row__error">{item.error}</span> : null}</div>
            <div className="vox-audio-bulk-row__actions">
              <button type="button" aria-label="Move up" disabled={bulkBusy || disabled || index === 0} onClick={() => moveItem(item.key, -1)}><ChevronUp size={13} /></button>
              <button type="button" aria-label="Move down" disabled={bulkBusy || disabled || index === staged.length - 1} onClick={() => moveItem(item.key, 1)}><ChevronDown size={13} /></button>
              {item.status === 'failed' ? <button type="button" disabled={bulkBusy || disabled} onClick={() => void runQueue([item.key])}>RETRY</button> : null}
              <button type="button" aria-label="Remove track" disabled={item.status === 'uploading'} onClick={() => removeItem(item.key)}><X size={13} /></button>
            </div>
          </li>)}
        </ol>
        <footer className="vox-audio-bulk-footer">
          <span>{bulkBusy && queueProgress ? `UPLOADING ${queueProgress.done} / ${queueProgress.total}` : `${staged.length} TRACK${staged.length === 1 ? '' : 'S'} STAGED`}</span>
          <button type="button" className="vox-audio-bulk-upload-all" disabled={bulkBusy || disabled || !uploadableCount} onClick={uploadAll}>{bulkBusy ? 'UPLOADING…' : 'UPLOAD ALL'}</button>
        </footer>
      </> : null}
    </section>
  )
}

function PlaylistEditor({ value, tracks, busy, run, onNotice, onSaved }: {
  readonly value?: NetVoxAudioGmPlaylist
  readonly tracks: readonly NetVoxAudioGmTrack[]
  readonly busy: boolean
  readonly run: StudioRun
  readonly onNotice: (message: string) => void
  readonly onSaved: (id: string) => void
}) {
  const [recordId] = useState(() => value?.id ?? crypto.randomUUID())
  const [title, setTitle] = useState(value?.title ?? '')
  const [description, setDescription] = useState(value?.description ?? '')
  const [coverRef, setCoverRef] = useState(value?.coverRef ?? '')
  const [coverRefDraft, setCoverRefDraft] = useState<string>()
  const [status, setStatus] = useState<NetVoxAudioStatus>(value?.status ?? 'draft')
  const [featured, setFeatured] = useState(value?.featured ?? false)
  const [trackId, setTrackId] = useState('')
  const memberTracks = value
    ? value.trackIds.map((id) => tracks.find((track) => track.id === id)).filter((track): track is NetVoxAudioGmTrack => Boolean(track))
    : []
  const availableTracks = value ? tracks.filter((track) => !value.trackIds.includes(track.id)) : []
  return (
    <form className="vox-audio-studio-form" onSubmit={(event) => {
      event.preventDefault()
      void run(async () => {
        const nextCoverRef = coverRefDraft?.trim() || coverRef
        try {
          const payload = await saveNetVoxAudioGmPlaylist({ id: recordId, title, description, coverRef: nextCoverRef, status, featured })
          const committedCoverRef = await commitSharedMediaReplacement(
            coverRef,
            nextCoverRef,
          )
        await finalizeSharedMediaReplacement(coverRef, committedCoverRef, onNotice, 'playlist cover')
        setCoverRef(committedCoverRef ?? '')
        setCoverRefDraft(undefined)
        return payload
        } catch (error) {
          await rollbackSharedMediaUpload(nextCoverRef, coverRef, onNotice, 'playlist cover')
          throw error
        }
      },
        'VOX AUDIO // CURATED PLAYLIST SAVED',
        (nextPayload) => onSaved(confirmedStudioRecordId(nextPayload.playlists, recordId, 'curated playlist')),
      )
    }}>
      <header><div><small>{value ? 'EDIT CURATED PLAYLIST' : 'NEW CURATED PLAYLIST'}</small><h2>{title || 'Build a collection'}</h2><p>Editorial VOX AUDIO collection, separate from private listener playlists.</p></div><button type="submit" disabled={busy}><Check size={14} /> {busy ? 'SAVING…' : 'SAVE PLAYLIST'}</button></header>
      <fieldset><legend>COLLECTION</legend><label>TITLE<input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>DESCRIPTION<textarea rows={6} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} /></label><StudioArtworkUpload subjectId={value?.id} slot="cover" label="PLAYLIST COVER" source={coverRefDraft ?? coverRef} previewLabel={`${title || 'Playlist'} cover`} onUploaded={setCoverRefDraft} /></fieldset>
      <fieldset><legend>PUBLICATION</legend><label>STATUS<select value={status} onChange={(event) => setStatus(event.target.value as NetVoxAudioStatus)}>{statusOptions}</select></label><label className="vox-audio-check"><input type="checkbox" checked={featured} onChange={(event) => setFeatured(event.target.checked)} /> FEATURED</label><p>Track membership is stored as ordered rows. V1 appends tracks without rewriting an array.</p></fieldset>
      <fieldset className="vox-audio-studio-membership">
        <legend>ORDERED TRACKS</legend>
        {!value ? <p>Save this collection first, then select it from the directory to add tracks.</p> : (
          <>
            <div className="vox-audio-studio-membership__add">
              <select value={trackId} onChange={(event) => setTrackId(event.target.value)} aria-label="Track to add">
                <option value="">SELECT A TRACK</option>
                {availableTracks.map((track) => <option key={track.id} value={track.id}>{track.title}</option>)}
              </select>
              <button type="button" disabled={busy || !trackId} onClick={() => {
                if (!trackId) return
                void run(
                  () => setNetVoxAudioGmPlaylistTrack(value.id, trackId, true),
                  'VOX AUDIO // TRACK ADDED TO CURATED PLAYLIST',
                ).then(() => setTrackId(''))
              }}><Plus size={13} /> ADD</button>
            </div>
            <div className="vox-audio-studio-membership__list">
              {memberTracks.map((track, index) => (
                <div key={track.id}>
                  <span><small>{String(index + 1).padStart(2, '0')}</small><strong>{track.title}</strong></span>
                  <button type="button" disabled={busy} aria-label={`Remove ${track.title}`} onClick={() => {
                    void run(
                      () => setNetVoxAudioGmPlaylistTrack(value.id, track.id, false),
                      'VOX AUDIO // TRACK REMOVED FROM CURATED PLAYLIST',
                    )
                  }}><X size={13} /></button>
                </div>
              ))}
              {!memberTracks.length ? <p>NO TRACKS IN THIS COLLECTION</p> : null}
            </div>
          </>
        )}
      </fieldset>
    </form>
  )
}

export function VoxAudioApp(props: VoxAudioAppProps) {
  return props.mode === 'studio'
    ? <Studio enabled={props.enabled} onNotice={props.onNotice} />
    : <AudioReader {...props} />
}
