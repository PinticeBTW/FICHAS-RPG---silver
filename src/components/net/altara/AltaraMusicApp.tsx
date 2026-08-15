import {
  ArrowLeft,
  Check,
  ChevronRight,
  Disc3,
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

import { SharedMediaImage } from '../../shared/SharedMediaImage'
import { uploadSharedImage } from '../../../lib/media/mediaStorage'
import {
  createNetAltaraMusicGmTrack,
  deleteNetAltaraMusicGmTrack,
  fetchNetAltaraMusicStudio,
  inspectNetAltaraMusicAudioFile,
  replaceNetAltaraMusicGmTrackAudio,
  saveNetAltaraMusicGmArtist,
  saveNetAltaraMusicGmPlaylist,
  saveNetAltaraMusicGmRelease,
  setNetAltaraMusicGmPlaylistTrack,
  updateNetAltaraMusicGmTrack,
} from '../../../lib/netAltaraMusicService'
import {
  NET_ALTARA_MUSIC_AUDIO_BYTE_BUDGET,
  formatAltaraMusicDuration,
  netAltaraMusicReleaseTypes,
  netAltaraMusicStatuses,
  type NetAltaraMusicGmArtist,
  type NetAltaraMusicGmPlaylist,
  type NetAltaraMusicGmRelease,
  type NetAltaraMusicGmTrack,
  type NetAltaraMusicPlaylist,
  type NetAltaraMusicStatus,
  type NetAltaraMusicStudioPayload,
  type NetAltaraMusicTrack,
} from '../../../lib/netAltaraMusicTypes'
import { useNetAltaraMusic } from './useNetAltaraMusic'
import type { AltaraMusicPlayerController } from './useAltaraMusicPlayer'

import '../../../styles/altaraMusic.css'

export type AltaraMusicMode = 'reader' | 'studio'
type ReaderNav = 'home' | 'search' | 'library' | 'liked' | 'playlists'

interface AltaraMusicAppProps {
  readonly mode: AltaraMusicMode
  readonly enabled: boolean
  readonly expectedIdentityLinkId?: string
  readonly identityName: string
  readonly player: AltaraMusicPlayerController
  readonly onNotice: (message: string) => void
}

function Artwork({ source, label, kind = 'square' }: {
  readonly source?: string
  readonly label: string
  readonly kind?: 'square' | 'artist' | 'hero' | 'banner'
}) {
  const fallback = <span className="altara-music-artwork__fallback"><Music2 aria-hidden="true" /></span>
  return (
    <span className="altara-music-artwork" data-kind={kind}>
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
    <section className="altara-music-feedback">
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
}: {
  readonly tracks: readonly NetAltaraMusicTrack[]
  readonly player: AltaraMusicPlayerController
  readonly playlists: readonly NetAltaraMusicPlaylist[]
  readonly onLike: (track: NetAltaraMusicTrack) => void
  readonly onAddToPlaylist: (playlistId: string, trackId: string) => void
  readonly activePersonalPlaylistId?: string
  readonly onRemoveFromPlaylist?: (playlistId: string, trackId: string) => void
}) {
  if (!tracks.length) return null
  return (
    <div className="altara-music-track-list" role="list">
      {tracks.map((track, index) => {
        const isCurrent = player.current?.id === track.id
        return (
          <article key={track.id} role="listitem" data-current={isCurrent ? 'true' : 'false'}>
            <button
              type="button"
              className="altara-music-track-play"
              aria-label={`${isCurrent && player.playing ? 'Pause' : 'Play'} ${track.title}`}
              onClick={() => {
                if (isCurrent) void player.toggle()
                else void player.playQueue(tracks, index)
              }}
            >
              {isCurrent && player.playing ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <Artwork source={track.artworkRef} label="" />
            <span className="altara-music-track-copy">
              <strong>{track.title}</strong>
              <small>{track.artistName}{track.explicit ? ' · EXPLICIT' : ''}</small>
            </span>
            <span className="altara-music-track-release">{track.releaseTitle ?? 'ALTARA ORIGINAL'}</span>
            <button
              type="button"
              className="altara-music-icon-action"
              data-active={track.liked ? 'true' : 'false'}
              onClick={() => onLike(track)}
              aria-label={`${track.liked ? 'Remove' : 'Add'} ${track.title} ${track.liked ? 'from' : 'to'} liked songs`}
            >
              <Heart size={14} fill={track.liked ? 'currentColor' : 'none'} />
            </button>
            {activePersonalPlaylistId && onRemoveFromPlaylist ? (
              <button
                type="button"
                className="altara-music-icon-action"
                onClick={() => onRemoveFromPlaylist(activePersonalPlaylistId, track.id)}
                aria-label={`Remove ${track.title} from this playlist`}
              >
                <X size={14} />
              </button>
            ) : playlists.length ? (
              <label className="altara-music-track-add">
                <span className="sr-only">Add {track.title} to playlist</span>
                <select defaultValue="" onChange={(event) => {
                  if (event.target.value) onAddToPlaylist(event.target.value, track.id)
                  event.target.value = ''
                }}>
                  <option value="">＋ PLAYLIST</option>
                  {playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.title}</option>)}
                </select>
              </label>
            ) : null}
            <time>{formatAltaraMusicDuration(track.durationMs)}</time>
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
  return <section className="altara-music-rail"><header><h2>{title}</h2>{action}</header><div>{children}</div></section>
}

function PlayerBar({ player }: { readonly player: AltaraMusicPlayerController }) {
  const track = player.current
  const [queueOpen, setQueueOpen] = useState(false)
  return (
    <footer className="altara-music-player" data-empty={track ? 'false' : 'true'}>
      <div className="altara-music-player__identity">
        <Artwork source={track?.artworkRef} label="" />
        <span><strong>{track?.title ?? 'READY WHEN YOU ARE'}</strong><small>{track ? `${track.artistName}${track.releaseTitle ? ` · ${track.releaseTitle}` : ''}` : 'Choose a native track to begin'}</small></span>
      </div>
      <div className="altara-music-player__transport">
        <div>
          <button type="button" disabled={!player.queue.length} data-active={queueOpen ? 'true' : 'false'} onClick={() => setQueueOpen((open) => !open)} aria-expanded={queueOpen} aria-controls="altara-music-player-queue" aria-label="Show playback queue" title="Playback queue"><ListMusic size={14} /></button>
          <button type="button" disabled={!track} data-active={player.shuffle ? 'true' : 'false'} onClick={player.toggleShuffle} aria-label={player.shuffle ? 'Disable shuffle' : 'Enable shuffle'} title={player.shuffle ? 'Shuffle on' : 'Shuffle off'}><Shuffle size={14} /></button>
          <button type="button" disabled={!track} onClick={() => { void player.previous() }} aria-label="Previous track"><SkipBack size={16} fill="currentColor" /></button>
          <button type="button" className="altara-music-player__primary" disabled={!track || player.loading} onClick={() => { void player.toggle() }} aria-label={player.playing ? 'Pause' : 'Play'}>
            {player.loading ? <LoaderCircle className="altara-music-spin" size={17} /> : player.playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
          </button>
          <button type="button" disabled={!track} onClick={() => { void player.next() }} aria-label="Next track"><SkipForward size={16} fill="currentColor" /></button>
          <button type="button" disabled={!track} data-active={player.repeat !== 'off' ? 'true' : 'false'} onClick={player.cycleRepeat} aria-label={`Repeat mode: ${player.repeat}`} title={`Repeat: ${player.repeat}`}>
            {player.repeat === 'track' ? <Repeat1 size={14} /> : <Repeat size={14} />}
          </button>
        </div>
        <label>
          <span>{formatAltaraMusicDuration(player.currentTime * 1000)}</span>
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
          <span>{formatAltaraMusicDuration(player.duration > 0 ? player.duration * 1000 : track?.durationMs ?? 0)}</span>
        </label>
      </div>
      <div className="altara-music-player__volume">
        <button type="button" onClick={player.toggleMuted} aria-label={player.muted ? 'Unmute' : 'Mute'}>{player.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
        <input type="range" min={0} max={1} step={0.02} value={player.volume} onChange={(event) => player.setVolume(Number(event.target.value))} aria-label="Volume" />
      </div>
      {queueOpen && player.queue.length ? <aside id="altara-music-player-queue" className="altara-music-player__queue"><header><div><strong>PLAYBACK QUEUE</strong><small>{player.queue.length} {player.queue.length === 1 ? 'TRACK' : 'TRACKS'}</small></div><button type="button" onClick={() => setQueueOpen(false)} aria-label="Close playback queue"><X size={14} /></button></header><div>{player.queue.map((queuedTrack, index) => <button type="button" key={queuedTrack.id} data-current={queuedTrack.id === track?.id ? 'true' : 'false'} onClick={() => { void player.playQueue(player.queue, index) }}><small>{String(index + 1).padStart(2, '0')}</small><Artwork source={queuedTrack.artworkRef} label="" /><span><strong>{queuedTrack.title}</strong><small>{queuedTrack.artistName}{queuedTrack.releaseTitle ? ` · ${queuedTrack.releaseTitle}` : ''}</small></span><time>{formatAltaraMusicDuration(queuedTrack.durationMs)}</time></button>)}</div></aside> : null}
      {player.error ? <p role="alert">{player.error}</p> : null}
    </footer>
  )
}

function MusicReader({
  enabled,
  identityName,
  expectedIdentityLinkId,
  player,
  onNotice,
}: Omit<AltaraMusicAppProps, 'mode'>) {
  const music = useNetAltaraMusic(enabled, expectedIdentityLinkId)
  const [nav, setNav] = useState<ReaderNav>('home')
  const [query, setQuery] = useState('')
  const [newPlaylistTitle, setNewPlaylistTitle] = useState('')
  const [newPlaylistDescription, setNewPlaylistDescription] = useState('')
  const home = music.home
  const library = music.library

  const like = (track: NetAltaraMusicTrack) => {
    void music.setLiked(track.id, !track.liked)
      .then(() => onNotice(`ALTARA MUSIC // ${track.liked ? 'REMOVED FROM' : 'ADDED TO'} LIKED SONGS`))
      .catch(() => undefined)
  }
  const addToPlaylist = (playlistId: string, trackId: string) => {
    void music.setPlaylistTrack(playlistId, trackId, true)
      .then(() => onNotice('ALTARA MUSIC // TRACK ADDED TO PLAYLIST'))
      .catch(() => undefined)
  }
  const removeFromPlaylist = (playlistId: string, trackId: string) => {
    void music.setPlaylistTrack(playlistId, trackId, false)
      .then(() => onNotice('ALTARA MUSIC // TRACK REMOVED FROM PLAYLIST'))
      .catch(() => undefined)
  }
  let content: ReactNode
  if (!enabled || !expectedIdentityLinkId) {
    content = <Feedback title="LISTENING IDENTITY UNAVAILABLE" copy="Open ALTARA MUSIC from an installed, authoritative ALTARA runtime identity. GM System does not inherit a fictional library." />
  } else if (music.loading && !home) {
    content = <Feedback icon={<LoaderCircle className="altara-music-spin" size={28} />} title="OPENING YOUR LIBRARY" copy="Loading the published catalogue and your private listening state." />
  } else if (!home) {
    content = <Feedback title="ALTARA MUSIC UNAVAILABLE" copy={music.error ?? 'The catalogue could not be opened.'} action={<button type="button" onClick={music.reload}><RefreshCw size={14} /> RETRY</button>} />
  } else if (music.detail) {
    const detail = music.detail
    const title = detail.kind === 'artist' ? detail.value.artist.name : detail.kind === 'release' ? detail.value.release.title : detail.value.playlist.title
    const artwork = detail.kind === 'artist' ? detail.value.artist.avatarRef : detail.kind === 'release' ? detail.value.release.coverRef : detail.value.playlist.coverRef
    const tracks = detail.value.tracks
    const description = detail.kind === 'artist'
      ? detail.value.artist.bio
      : detail.kind === 'release'
        ? detail.value.release.description
        : detail.value.playlist.description
    content = (
      <section className="altara-music-detail">
        <button type="button" className="altara-music-back" onClick={music.closeDetail}><ArrowLeft size={14} /> BACK</button>
        <header>
          <Artwork source={artwork} label={title} kind={detail.kind === 'artist' ? 'artist' : 'hero'} />
          <div>
            <span>{detail.kind.toUpperCase()}</span>
            <h1>{title}</h1>
            {detail.kind === 'release' ? <p>{detail.value.release.artistName} · {detail.value.release.releaseType.toUpperCase()}{detail.value.release.releaseDate ? ` · ${detail.value.release.releaseDate}` : ''}</p> : description ? <p>{description}</p> : null}
            <small>{tracks.length} {tracks.length === 1 ? 'TRACK' : 'TRACKS'}</small>
            {tracks.length ? <button type="button" onClick={() => { void player.playQueue(tracks) }}><Play size={14} fill="currentColor" /> PLAY ALL</button> : null}
          </div>
        </header>
        {detail.kind === 'artist' && detail.value.releases.length ? (
          <CollectionRail title="RELEASES">
            {detail.value.releases.map((release) => <button type="button" key={release.id} className="altara-music-cover-card" onClick={() => { void music.openRelease(release.id) }}><Artwork source={release.coverRef} label={release.title} /><strong>{release.title}</strong><small>{release.releaseType.toUpperCase()}</small></button>)}
          </CollectionRail>
        ) : null}
        <TrackList
          tracks={tracks}
          player={player}
          playlists={library?.playlists ?? []}
          onLike={like}
          onAddToPlaylist={addToPlaylist}
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
    const featuredReleaseIds = new Set(featuredReleases.map((release) => release.id))
    const secondaryFeaturedReleases = featuredReleases.filter((release) => release.id !== leadRelease?.id)
    const newReleases = home.releases.filter((release) => release.id !== leadRelease?.id && !featuredReleaseIds.has(release.id))
    content = (
      <div className="altara-music-home">
        <section className="altara-music-home__lead">
          <div>
            <span>ALTARA MUSIC // GLOBAL CATALOGUE</span>
            <h1>{leadTitle ?? 'A quieter kind of signal.'}</h1>
            <p>{leadRelease ? `${leadRelease.artistName} · ${leadRelease.releaseType.toUpperCase()}` : leadArtist ? leadArtist.bio ?? 'Featured on the ALTARA native music network.' : 'The native catalogue is ready. Silver can publish the first canonical artist, release, or track from MUSIC STUDIO.'}</p>
            {leadRelease ? <button type="button" onClick={() => { void music.openRelease(leadRelease.id) }}><Play size={15} fill="currentColor" /> OPEN RELEASE</button> : leadArtist ? <button type="button" onClick={() => { void music.openArtist(leadArtist.id) }}><Music2 size={15} /> OPEN ARTIST</button> : null}
          </div>
          <Artwork source={leadArtwork} label={leadTitle ?? ''} kind="hero" />
        </section>
        {home.recentlyPlayed.length ? <CollectionRail title="RECENTLY PLAYED"><TrackList tracks={home.recentlyPlayed} player={player} playlists={library?.playlists ?? []} onLike={like} onAddToPlaylist={addToPlaylist} /></CollectionRail> : null}
        {secondaryFeaturedReleases.length ? <CollectionRail title="FEATURED RELEASES"><div className="altara-music-cover-grid">{secondaryFeaturedReleases.map((release) => <button type="button" key={release.id} className="altara-music-cover-card" onClick={() => { void music.openRelease(release.id) }}><Artwork source={release.coverRef} label={release.title} /><strong>{release.title}</strong><small>{release.artistName} · {release.releaseType.toUpperCase()}</small></button>)}</div></CollectionRail> : null}
        {newReleases.length ? <CollectionRail title="NEW RELEASES"><div className="altara-music-cover-grid">{newReleases.map((release) => <button type="button" key={release.id} className="altara-music-cover-card" onClick={() => { void music.openRelease(release.id) }}><Artwork source={release.coverRef} label={release.title} /><strong>{release.title}</strong><small>{release.artistName}</small></button>)}</div></CollectionRail> : null}
        {featuredTracks.length ? <CollectionRail title="FEATURED TRACKS" action={<button type="button" className="altara-music-rail-action" onClick={() => { void player.playQueue(featuredTracks) }}><Play size={12} fill="currentColor" /> PLAY ALL</button>}><TrackList tracks={featuredTracks} player={player} playlists={library?.playlists ?? []} onLike={like} onAddToPlaylist={addToPlaylist} /></CollectionRail> : null}
        {home.artists.length ? <CollectionRail title="ARTISTS"><div className="altara-music-cover-grid altara-music-cover-grid--artists">{home.artists.map((artist) => <button type="button" key={artist.id} className="altara-music-cover-card" onClick={() => { void music.openArtist(artist.id) }}><Artwork source={artist.avatarRef} label={artist.name} kind="artist" /><strong>{artist.name}</strong><small>ARTIST</small></button>)}</div></CollectionRail> : null}
        {home.playlists.length ? <CollectionRail title="CURATED PLAYLISTS"><div className="altara-music-cover-grid">{home.playlists.map((playlist) => <button type="button" key={playlist.id} className="altara-music-cover-card" onClick={() => { void music.openPlaylist(playlist.id) }}><Artwork source={playlist.coverRef} label={playlist.title} /><strong>{playlist.title}</strong><small>{playlist.trackCount} TRACKS</small></button>)}</div></CollectionRail> : null}
      </div>
    )
  } else if (nav === 'search') {
    const results = music.search
    content = (
      <section className="altara-music-search-page">
        <header><h1>Search the catalogue</h1><p>Artists, releases, native tracks, and curated collections.</p></header>
        <form onSubmit={(event) => { event.preventDefault(); if (query.trim()) void music.runSearch(query) }}>
          <Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={120} placeholder="What do you want to hear?" autoFocus /><button type="submit">SEARCH</button>
        </form>
        {!results ? <Feedback title="START WITH A NAME" copy="Search the bounded native catalogue by artist, release, track, or playlist name." /> : (
          <div className="altara-music-search-results">
            {results.artists.length ? <CollectionRail title="ARTISTS"><div className="altara-music-cover-grid">{results.artists.map((artist) => <button type="button" key={artist.id} className="altara-music-cover-card" onClick={() => { void music.openArtist(artist.id) }}><Artwork source={artist.avatarRef} label={artist.name} kind="artist" /><strong>{artist.name}</strong></button>)}</div></CollectionRail> : null}
            {results.releases.length ? <CollectionRail title="RELEASES"><div className="altara-music-cover-grid">{results.releases.map((release) => <button type="button" key={release.id} className="altara-music-cover-card" onClick={() => { void music.openRelease(release.id) }}><Artwork source={release.coverRef} label={release.title} /><strong>{release.title}</strong><small>{release.artistName}</small></button>)}</div></CollectionRail> : null}
            {results.tracks.length ? <CollectionRail title="TRACKS"><TrackList tracks={results.tracks} player={player} playlists={library?.playlists ?? []} onLike={like} onAddToPlaylist={addToPlaylist} /></CollectionRail> : null}
            {results.playlists.length ? <CollectionRail title="CURATED PLAYLISTS"><div className="altara-music-cover-grid">{results.playlists.map((playlist) => <button type="button" key={playlist.id} className="altara-music-cover-card" onClick={() => { void music.openPlaylist(playlist.id) }}><Artwork source={playlist.coverRef} label={playlist.title} /><strong>{playlist.title}</strong><small>{playlist.trackCount} TRACKS</small></button>)}</div></CollectionRail> : null}
            {!results.tracks.length && !results.artists.length && !results.releases.length && !results.playlists.length ? <Feedback title="NO MATCHES" copy="Try a shorter artist, release, track, or playlist name." /> : null}
          </div>
        )}
      </section>
    )
  } else if (nav === 'playlists') {
    content = (
      <section className="altara-music-library-page">
        <header><h1>Your playlists</h1><p>Private collections owned by {identityName}.</p></header>
        <form className="altara-music-new-playlist" onSubmit={(event) => {
          event.preventDefault()
          if (!newPlaylistTitle.trim()) return
          void music.savePlaylist({ title: newPlaylistTitle, description: newPlaylistDescription }).then((id) => { setNewPlaylistTitle(''); setNewPlaylistDescription(''); onNotice('ALTARA MUSIC // PLAYLIST CREATED'); void music.openPlaylist(id) }).catch(() => undefined)
        }}><input value={newPlaylistTitle} maxLength={120} required onChange={(event) => setNewPlaylistTitle(event.target.value)} placeholder="Playlist title" aria-label="Playlist title" /><input value={newPlaylistDescription} maxLength={1000} onChange={(event) => setNewPlaylistDescription(event.target.value)} placeholder="Description (optional)" aria-label="Playlist description" /><button type="submit" disabled={music.mutating}><Plus size={14} /> {music.mutating ? 'CREATING…' : 'CREATE PLAYLIST'}</button></form>
        {library?.playlists.length ? <div className="altara-music-playlist-directory">{library.playlists.map((playlist) => <article key={playlist.id}><button type="button" onClick={() => { void music.openPlaylist(playlist.id) }}><Artwork source={playlist.coverRef} label={playlist.title} /><span><strong>{playlist.title}</strong><small>{playlist.trackCount} TRACKS</small></span></button><button type="button" aria-label={`Delete ${playlist.title}`} onClick={() => { if (window.confirm(`Delete ${playlist.title}? The tracks remain in ALTARA MUSIC.`)) void music.deletePlaylist(playlist.id) }}><Trash2 size={14} /></button></article>)}</div> : <Feedback title="NO PLAYLISTS YET" copy="Create a private playlist, then add published native tracks from any track row." />}
      </section>
    )
  } else if (nav === 'liked') {
    const likedTracks = library?.likedTracks ?? []
    content = (
      <section className="altara-music-library-page">
        <header className="altara-music-library-heading"><div><h1>Liked songs</h1><p>Tracks saved by this exact ALTARA identity.</p></div>{likedTracks.length ? <button type="button" onClick={() => { void player.playQueue(likedTracks) }}><Play size={14} fill="currentColor" /> PLAY ALL</button> : null}</header>
        {likedTracks.length ? <TrackList tracks={likedTracks} player={player} playlists={library?.playlists ?? []} onLike={like} onAddToPlaylist={addToPlaylist} /> : <Feedback title="NO LIKED SONGS" copy="Use the heart on a published native track to keep it here." />}
      </section>
    )
  } else {
    const recentTracks = library?.recentlyPlayed ?? []
    const likedTracks = library?.likedTracks ?? []
    const personalPlaylists = library?.playlists ?? []
    const emptyLibrary = !recentTracks.length && !likedTracks.length && !personalPlaylists.length
    content = (
      <section className="altara-music-library-page altara-music-library-page--overview">
        <header><h1>Your library</h1><p>Recent listening, saved tracks, and private collections for {identityName}.</p></header>
        {recentTracks.length ? <CollectionRail title="RECENTLY PLAYED" action={<button type="button" className="altara-music-rail-action" onClick={() => { void player.playQueue(recentTracks) }}><Play size={12} fill="currentColor" /> PLAY</button>}><TrackList tracks={recentTracks.slice(0, 12)} player={player} playlists={personalPlaylists} onLike={like} onAddToPlaylist={addToPlaylist} /></CollectionRail> : null}
        {likedTracks.length ? <CollectionRail title="LIKED SONGS" action={<button type="button" className="altara-music-rail-action" onClick={() => setNav('liked')}>VIEW ALL <ChevronRight size={12} /></button>}><TrackList tracks={likedTracks.slice(0, 8)} player={player} playlists={personalPlaylists} onLike={like} onAddToPlaylist={addToPlaylist} /></CollectionRail> : null}
        {personalPlaylists.length ? <CollectionRail title="YOUR PLAYLISTS" action={<button type="button" className="altara-music-rail-action" onClick={() => setNav('playlists')}>MANAGE <ChevronRight size={12} /></button>}><div className="altara-music-cover-grid">{personalPlaylists.slice(0, 12).map((playlist) => <button type="button" key={playlist.id} className="altara-music-cover-card" onClick={() => { void music.openPlaylist(playlist.id) }}><Artwork source={playlist.coverRef} label={playlist.title} /><strong>{playlist.title}</strong><small>{playlist.trackCount} TRACKS</small></button>)}</div></CollectionRail> : null}
        {emptyLibrary ? <Feedback title="YOUR LIBRARY IS READY" copy="Play a native track, like a song, or create a private playlist to begin." action={<button type="button" onClick={() => setNav('home')}>EXPLORE MUSIC</button>} /> : null}
      </section>
    )
  }

  return (
    <section className="altara-music" aria-label="ALTARA MUSIC">
      <aside className="altara-music-sidebar">
        <header><span><Music2 size={20} /></span><div><strong>ALTARA MUSIC</strong><small>GLOBAL AUDIO NETWORK</small></div></header>
        <nav>
          {([
            ['home', 'HOME', Sparkles], ['search', 'SEARCH', Search], ['library', 'YOUR LIBRARY', Library],
            ['liked', 'LIKED SONGS', Heart], ['playlists', 'PLAYLISTS', ListMusic],
          ] as const).map(([id, label, Icon]) => <button key={id} type="button" data-active={nav === id ? 'true' : 'false'} onClick={() => { music.closeDetail(); setNav(id) }}><Icon size={15} /> {label}</button>)}
        </nav>
        <div className="altara-music-sidebar__library"><span>YOUR PLAYLISTS</span>{library?.playlists.slice(0, 12).map((playlist) => <button type="button" key={playlist.id} onClick={() => { void music.openPlaylist(playlist.id) }}><Disc3 size={12} /> {playlist.title}</button>)}{!library?.playlists.length ? <small>No personal playlists</small> : null}</div>
        <footer><strong>{identityName}</strong><small>PRIVATE LISTENING CONTEXT</small></footer>
      </aside>
      <div className="altara-music-workspace">
        {music.refreshing ? <div className="altara-music-sync"><LoaderCircle className="altara-music-spin" size={12} /> SYNCHRONIZING</div> : null}
        {music.error && home ? <div className="altara-music-error" role="alert">{music.error}<button type="button" onClick={music.reload}>RETRY</button></div> : null}
        <main>{content}</main>
        <PlayerBar player={player} />
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
type AudioInspection = Awaited<ReturnType<typeof inspectNetAltaraMusicAudioFile>>
type StudioRun = (
  operation: () => Promise<NetAltaraMusicStudioPayload>,
  notice: string,
  onSuccess?: (payload: NetAltaraMusicStudioPayload) => void,
) => Promise<void>

const statusOptions = netAltaraMusicStatuses.map((status) => <option key={status} value={status}>{status.toUpperCase()}</option>)

function musicSlug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
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
    ['net_altara_music_releases_slug_key', 'A release with this slug already exists. Open the existing release or adjust its advanced slug.'],
    ['net_altara_music_artists_slug_key', 'An artist with this slug already exists. Open the existing artist or adjust its advanced slug.'],
    ['ALTARA_MUSIC_RELEASE_ARTIST_CHANGE_REQUIRES_TRACK_REASSIGNMENT', "Move or remove this release's tracks before changing its artist."],
    ['ALTARA_MUSIC_STORAGE_BUDGET_REACHED', 'ALTARA MUSIC has reached its audio storage budget. Archive and safely remove unused audio before adding more.'],
    ['ALTARA_MUSIC_TRACK_LIMIT_REACHED', 'ALTARA MUSIC has reached its reviewed native-track limit.'],
    ['ALTARA_MUSIC_PLAYLIST_TRACK_LIMIT_REACHED', 'This playlist already contains the maximum of 500 tracks.'],
    ['ALTARA_MUSIC_RELEASE_ARTIST_MISMATCH', 'The selected release belongs to a different artist. Return to the release and add the track there.'],
  ]
  return knownErrors.find(([code]) => message.includes(code))?.[1] ?? message
}

function confirmedStudioRecordId(records: readonly { readonly id: string }[], requestedId: string, label: string): string {
  const confirmed = records.find((record) => record.id === requestedId)
  if (!confirmed) throw new Error(`ALTARA MUSIC did not return the saved ${label}. Refresh MUSIC STUDIO before retrying.`)
  return confirmed.id
}

function StudioArtworkUpload({ subjectId, slot, label, source, previewLabel, kind = 'square', onUploaded }: {
  readonly subjectId?: string
  readonly slot: string
  readonly label: string
  readonly source?: string
  readonly previewLabel: string
  readonly kind?: 'square' | 'artist' | 'banner'
  readonly onUploaded: (reference: string) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  return (
    <div className="altara-music-studio-artwork" data-kind={kind}>
      <Artwork source={source} label={previewLabel} kind={kind} />
      <div>
        <strong>{label}</strong>
        <small>{source ? 'Private artwork attached. Replace it without changing the record.' : subjectId ? 'No artwork attached yet.' : 'Save this record once to enable private artwork.'}</small>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" hidden onChange={(event) => {
          const file = event.target.files?.[0]
          if (!file || !subjectId) return
          setBusy(true); setError(undefined)
          void uploadSharedImage({ subjectKind: 'altara-music-artwork', subjectId, mediaKind: 'general', slot }, file, 'general')
            .then(({ reference }) => onUploaded(reference))
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

function Studio({ enabled, onNotice }: Pick<AltaraMusicAppProps, 'enabled' | 'onNotice'>) {
  const [payload, setPayload] = useState<NetAltaraMusicStudioPayload>()
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
    void fetchNetAltaraMusicStudio()
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
      onNotice(notice)
    } catch (operationError) {
      setError(studioErrorMessage(operationError))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  if (!enabled) return <section className="altara-music"><Feedback title="MUSIC STUDIO UNAVAILABLE" copy="Open Studio from an authoritative GM System workspace." /></section>
  if (loading && !payload) return <section className="altara-music"><Feedback icon={<LoaderCircle className="altara-music-spin" />} title="OPENING MUSIC STUDIO" copy="Loading the world catalogue and private audio budget." /></section>
  if (!payload) return <section className="altara-music"><Feedback title="MUSIC STUDIO COULD NOT OPEN" copy={error ?? 'The administrative catalogue is unavailable.'} action={<button type="button" onClick={load}>RETRY</button>} /></section>

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
          return <button type="button" key={artist.id} className="altara-music-studio-directory-row" data-active={catalogView?.kind === 'artist' && catalogView.id === artist.id ? 'true' : 'false'} onClick={() => { setTrackPanel(undefined); setCatalogView({ kind: 'artist', id: artist.id, key: artist.id }) }}><Artwork source={artist.avatarRef} label="" kind="artist" /><span><strong>{artist.name}</strong><small>{artist.status.toUpperCase()} · {releaseCount} {releaseCount === 1 ? 'RELEASE' : 'RELEASES'}</small></span><ChevronRight size={14} /></button>
        })}
        {!payload.artists.length ? <p>NO ARTISTS YET. CREATE THE FIRST CATALOG IDENTITY.</p> : null}
        <button type="button" className="altara-music-studio-directory-utility" data-active={catalogView?.kind === 'all-tracks' || catalogView?.kind === 'track' ? 'true' : 'false'} onClick={() => { setTrackPanel(undefined); setCatalogView({ kind: 'all-tracks', key: crypto.randomUUID() }) }}><ListMusic size={14} /><span><strong>ALL TRACKS</strong><small>{payload.tracks.length} NATIVE RECORDINGS</small></span></button>
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
        />
      )
    } else if (catalogView?.kind === 'track') {
      workspace = (
        <div className="altara-music-studio-page">
          <button type="button" className="altara-music-studio-back" onClick={() => setCatalogView({ kind: 'all-tracks', key: crypto.randomUUID() })}><ArrowLeft size={14} /> ALL TRACKS</button>
          <TrackEditor
            key={catalogView.key}
            value={currentTrack}
            defaultArtistId={catalogView.artistId}
            defaultReleaseId={catalogView.releaseId}
            artists={payload.artists}
            releases={payload.releases}
            busy={busy}
            run={run}
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
        {payload.playlists.map((playlist) => <button type="button" key={playlist.id} className="altara-music-studio-directory-row" data-active={playlistSelection?.id === playlist.id ? 'true' : 'false'} onClick={() => setPlaylistSelection({ id: playlist.id, key: playlist.id })}><Artwork source={playlist.coverRef} label="" /><span><strong>{playlist.title}</strong><small>{playlist.status.toUpperCase()} · {playlist.trackIds.length} TRACKS</small></span><ChevronRight size={14} /></button>)}
        {!payload.playlists.length ? <p>NO CURATED PLAYLISTS YET.</p> : null}
      </>
    )
    const playlist = payload.playlists.find((entry) => entry.id === playlistSelection?.id)
    workspace = playlistSelection ? <div className="altara-music-studio-page"><PlaylistEditor key={playlistSelection.key} value={playlist} tracks={payload.tracks} busy={busy} run={run} onSaved={(id) => setPlaylistSelection({ id, key: id })} /></div> : <Feedback title="CURATED PLAYLISTS" copy="Build editorial collections from existing native tracks. Personal listener playlists remain private and separate." action={<button type="button" onClick={() => setPlaylistSelection({ key: crypto.randomUUID() })}><Plus size={14} /> NEW CURATED PLAYLIST</button>} />
  }

  return (
    <section className="altara-music altara-music--studio">
      <header className="altara-music-studio-header">
        <div><span><Music2 size={18} /></span><strong>MUSIC STUDIO</strong><small>ALTARA PUBLISHING DESK</small></div>
        <nav>{(['catalog', 'playlists'] as const).map((id) => <button key={id} type="button" data-active={section === id ? 'true' : 'false'} onClick={() => openSection(id)}>{id.toUpperCase()}</button>)}</nav>
        <button type="button" disabled={loading || busy} onClick={load}><RefreshCw className={loading ? 'altara-music-spin' : undefined} size={13} /> REFRESH</button>
      </header>
      <div className="altara-music-studio-grid">
        <aside className="altara-music-studio-directory">{directory}</aside>
        <main className="altara-music-studio-editor">{workspace}</main>
      </div>
      <footer className="altara-music-studio-budget"><span>PRIVATE AUDIO LIBRARY</span><strong>{(payload.audioBytes / 1024 / 1024).toFixed(1)} MB</strong><progress value={payload.audioBytes} max={payload.audioBudgetBytes || NET_ALTARA_MUSIC_AUDIO_BYTE_BUDGET} /><small>{(payload.audioBudgetBytes / 1024 / 1024).toFixed(0)} MB REVIEWED LIMIT</small></footer>
      {error ? <div className="altara-music-error" role="alert">{error}<button type="button" aria-label="Dismiss error" onClick={() => setError(undefined)}><X size={13} /></button></div> : null}
    </section>
  )
}

function CatalogOverview({ payload, onNewArtist, onOpenArtist }: {
  readonly payload: NetAltaraMusicStudioPayload
  readonly onNewArtist: () => void
  readonly onOpenArtist: (id: string) => void
}) {
  return (
    <section className="altara-music-studio-overview">
      <header><div><h1>Catalog</h1><p>Build ALTARA music in its natural order: artist, release, then recording.</p></div><button type="button" onClick={onNewArtist}><Plus size={14} /> CREATE ARTIST</button></header>
      <div className="altara-music-studio-overview-stats"><span><strong>{payload.artists.length}</strong> ARTISTS</span><span><strong>{payload.releases.length}</strong> RELEASES</span><span><strong>{payload.tracks.length}</strong> TRACKS</span></div>
      {payload.artists.length ? <div className="altara-music-studio-artist-grid">{payload.artists.slice(0, 12).map((artist) => <button type="button" key={artist.id} onClick={() => onOpenArtist(artist.id)}><Artwork source={artist.avatarRef} label={artist.name} kind="artist" /><span><strong>{artist.name}</strong><small>{artist.status.toUpperCase()}</small></span><ChevronRight size={14} /></button>)}</div> : <Feedback title="THE CATALOG IS EMPTY" copy="Create an artist first. Releases and recordings will stay grouped under that identity." action={<button type="button" onClick={onNewArtist}><Plus size={14} /> CREATE FIRST ARTIST</button>} />}
    </section>
  )
}

function ArtistWorkspace({ value, releases, busy, run, onSaved, onOpenRelease, onNewRelease }: {
  readonly value?: NetAltaraMusicGmArtist
  readonly releases: readonly NetAltaraMusicGmRelease[]
  readonly busy: boolean
  readonly run: StudioRun
  readonly onSaved: (id: string) => void
  readonly onOpenRelease: (id: string) => void
  readonly onNewRelease: () => void
}) {
  return (
    <div className="altara-music-studio-page">
      <ArtistEditor value={value} busy={busy} run={run} onSaved={onSaved} />
      {value ? <section className="altara-music-studio-related"><header><div><h3>Releases</h3><p>Albums, EPs, and singles published under {value.name}.</p></div><button type="button" disabled={busy} onClick={onNewRelease}><Plus size={14} /> NEW RELEASE</button></header>{releases.length ? <div className="altara-music-studio-release-grid">{releases.map((release) => <button type="button" key={release.id} onClick={() => onOpenRelease(release.id)}><Artwork source={release.coverRef} label={release.title} /><span><strong>{release.title}</strong><small>{release.releaseType.toUpperCase()} · {release.status.toUpperCase()}</small></span><ChevronRight size={14} /></button>)}</div> : <Feedback title="NO RELEASES YET" copy="Create the first release without leaving this artist." action={<button type="button" onClick={onNewRelease}><Plus size={14} /> NEW RELEASE</button>} />}</section> : null}
    </div>
  )
}

function ReleaseWorkspace({ value, defaultArtistId, artists, tracks, allTracks, releases, busy, run, trackPanel, onBack, onSaved, onOpenTrack, onAddTrack, onTrackSaved, onCloseTrack }: {
  readonly value?: NetAltaraMusicGmRelease
  readonly defaultArtistId: string
  readonly artists: readonly NetAltaraMusicGmArtist[]
  readonly tracks: readonly NetAltaraMusicGmTrack[]
  readonly allTracks: readonly NetAltaraMusicGmTrack[]
  readonly releases: readonly NetAltaraMusicGmRelease[]
  readonly busy: boolean
  readonly run: StudioRun
  readonly trackPanel?: TrackPanel
  readonly onBack: () => void
  readonly onSaved: (id: string, artistId: string) => void
  readonly onOpenTrack: (id: string) => void
  readonly onAddTrack: () => void
  readonly onTrackSaved: (id: string) => void
  readonly onCloseTrack: () => void
}) {
  const nextTrackNumber = Math.max(0, ...tracks.map((track) => track.trackNumber ?? 0)) + 1
  const panelTrack = allTracks.find((track) => track.id === trackPanel?.id)
  return (
    <div className="altara-music-studio-page">
      <button type="button" className="altara-music-studio-back" onClick={onBack}><ArrowLeft size={14} /> ARTIST</button>
      <ReleaseEditor value={value} defaultArtistId={defaultArtistId} artists={artists} busy={busy} run={run} onSaved={onSaved} />
      {value ? <section className="altara-music-studio-related"><header><div><h3>Tracklist</h3><p>{value.releaseType === 'single' && !tracks.length ? 'This single is ready for its canonical recording.' : `${tracks.length} ${tracks.length === 1 ? 'recording' : 'recordings'} attached to this release.`}</p></div><button type="button" disabled={busy} onClick={onAddTrack}><Plus size={14} /> {value.releaseType === 'single' && !tracks.length ? 'ADD SINGLE AUDIO' : 'ADD TRACK'}</button></header>{tracks.length ? <div className="altara-music-studio-tracklist">{tracks.slice().sort((a, b) => (a.discNumber - b.discNumber) || ((a.trackNumber ?? 999) - (b.trackNumber ?? 999)) || a.id.localeCompare(b.id)).map((track, index) => <button type="button" key={track.id} onClick={() => onOpenTrack(track.id)}><small>{String(track.trackNumber ?? index + 1).padStart(2, '0')}</small><span><strong>{track.title}</strong><small>{track.status.toUpperCase()}{track.explicit ? ' · EXPLICIT' : ''}</small></span><time>{formatAltaraMusicDuration(track.durationMs)}</time><ChevronRight size={14} /></button>)}</div> : <Feedback title={value.releaseType === 'single' ? 'ADD THE SINGLE AUDIO' : 'NO TRACKS YET'} copy="Choose an audio file; artist and release are already locked to this context." action={<button type="button" onClick={onAddTrack}><Plus size={14} /> {value.releaseType === 'single' ? 'ADD SINGLE AUDIO' : 'ADD FIRST TRACK'}</button>} />}</section> : null}
      {trackPanel ? <aside className="altara-music-studio-track-panel"><header><div><strong>{panelTrack ? 'EDIT RECORDING' : 'ADD TO RELEASE'}</strong><small>{value?.title}</small></div><button type="button" aria-label="Close track editor" onClick={onCloseTrack}><X size={15} /></button></header><TrackEditor key={trackPanel.key} value={panelTrack} defaultArtistId={trackPanel.artistId} defaultReleaseId={trackPanel.releaseId} defaultTrackNumber={nextTrackNumber} artists={artists} releases={releases} busy={busy} run={run} lockedContext onSaved={onTrackSaved} onDeleted={onCloseTrack} /></aside> : null}
    </div>
  )
}

function AllTracksWorkspace({ tracks, artists, releases, onNew, onOpen }: {
  readonly tracks: readonly NetAltaraMusicGmTrack[]
  readonly artists: readonly NetAltaraMusicGmArtist[]
  readonly releases: readonly NetAltaraMusicGmRelease[]
  readonly onNew: () => void
  readonly onOpen: (track: NetAltaraMusicGmTrack) => void
}) {
  return (
    <section className="altara-music-studio-overview">
      <header><div><h1>All tracks</h1><p>Advanced management for standalone recordings and cross-catalog review.</p></div><button type="button" disabled={!artists.length} onClick={onNew}><Plus size={14} /> NEW STANDALONE TRACK</button></header>
      {tracks.length ? <div className="altara-music-studio-tracklist">{tracks.map((track, index) => <button type="button" key={track.id} onClick={() => onOpen(track)}><small>{String(track.trackNumber ?? index + 1).padStart(2, '0')}</small><span><strong>{track.title}</strong><small>{artists.find((artist) => artist.id === track.primaryArtistId)?.name ?? 'UNKNOWN ARTIST'} · {releases.find((release) => release.id === track.releaseId)?.title ?? 'STANDALONE'}</small></span><time>{formatAltaraMusicDuration(track.durationMs)}</time><ChevronRight size={14} /></button>)}</div> : <Feedback title="NO NATIVE TRACKS" copy="The preferred workflow is Artist → Release → Add Track. Standalone tracks can also be registered here." action={<button type="button" disabled={!artists.length} onClick={onNew}><Plus size={14} /> NEW STANDALONE TRACK</button>} />}
    </section>
  )
}

function ArtistEditor({ value, busy, run, onSaved }: { readonly value?: NetAltaraMusicGmArtist; readonly busy: boolean; readonly run: StudioRun; readonly onSaved: (id: string) => void }) {
  const [recordId] = useState(() => value?.id ?? crypto.randomUUID())
  const [name, setName] = useState(value?.name ?? '')
  const [slug, setSlug] = useState(value?.slug ?? '')
  const [bio, setBio] = useState(value?.bio ?? '')
  const [avatarRef, setAvatarRef] = useState(value?.avatarRef ?? '')
  const [bannerRef, setBannerRef] = useState(value?.bannerRef ?? '')
  const [status, setStatus] = useState<NetAltaraMusicStatus>(value?.status ?? 'draft')
  const [featured, setFeatured] = useState(value?.featured ?? false)
  const [advanced, setAdvanced] = useState(false)
  const save = (event?: FormEvent) => {
    event?.preventDefault()
    void run(() => saveNetAltaraMusicGmArtist({ id: recordId, name, slug, bio, avatarRef, bannerRef, status, featured }), 'ALTARA MUSIC // ARTIST SAVED', (nextPayload) => onSaved(confirmedStudioRecordId(nextPayload.artists, recordId, 'artist')))
  }
  return <form className="altara-music-studio-form" onSubmit={save}><header><div><small>{value ? 'EDIT ARTIST' : 'NEW ARTIST'}</small><h2>{name || 'Create artist'}</h2><p>{value ? 'Identity, presentation, and publishing state.' : 'Create the catalog identity first; releases and artwork follow immediately.'}</p></div><button type="submit" disabled={busy}><Check size={14} /> {busy ? 'SAVING…' : 'SAVE ARTIST'}</button></header><fieldset><legend>ARTIST IDENTITY</legend><label>ARTIST NAME<input value={name} maxLength={120} required onChange={(event) => { setName(event.target.value); if (!value) setSlug(musicSlug(event.target.value)) }} /></label><label>BIOGRAPHY<textarea value={bio} maxLength={4000} rows={7} onChange={(event) => setBio(event.target.value)} /></label><button type="button" className="altara-music-studio-advanced-toggle" onClick={() => setAdvanced((shown) => !shown)}>{advanced ? 'HIDE' : 'SHOW'} ADVANCED METADATA</button>{advanced ? <label>STABLE SLUG<input value={slug} maxLength={120} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required onChange={(event) => setSlug(event.target.value)} /><small>Used in stable references. It will not change automatically after creation.</small></label> : null}</fieldset><fieldset><legend>PRESENTATION & PUBLICATION</legend><StudioArtworkUpload subjectId={value?.id} slot="avatar" label="ARTIST AVATAR" source={avatarRef} previewLabel={`${name || 'Artist'} avatar`} kind="artist" onUploaded={setAvatarRef} /><StudioArtworkUpload subjectId={value?.id} slot="banner" label="ARTIST BANNER" source={bannerRef} previewLabel={`${name || 'Artist'} banner`} kind="banner" onUploaded={setBannerRef} /><div className="altara-music-form-pair"><label>STATUS<select value={status} onChange={(event) => setStatus(event.target.value as NetAltaraMusicStatus)}>{statusOptions}</select></label><label className="altara-music-check"><input type="checkbox" checked={featured} onChange={(event) => setFeatured(event.target.checked)} /> FEATURED</label></div></fieldset></form>
}

function ReleaseEditor({ value, defaultArtistId, artists, busy, run, onSaved }: { readonly value?: NetAltaraMusicGmRelease; readonly defaultArtistId: string; readonly artists: readonly NetAltaraMusicGmArtist[]; readonly busy: boolean; readonly run: StudioRun; readonly onSaved: (id: string, artistId: string) => void }) {
  const [recordId] = useState(() => value?.id ?? crypto.randomUUID())
  const [artistId, setArtistId] = useState(value?.artistId ?? defaultArtistId ?? artists[0]?.id ?? '')
  const [title, setTitle] = useState(value?.title ?? '')
  const [slug, setSlug] = useState(value?.slug ?? '')
  const [releaseType, setReleaseType] = useState(value?.releaseType ?? 'album')
  const [coverRef, setCoverRef] = useState(value?.coverRef ?? '')
  const [releaseDate, setReleaseDate] = useState(value?.releaseDate ?? '')
  const [description, setDescription] = useState(value?.description ?? '')
  const [status, setStatus] = useState<NetAltaraMusicStatus>(value?.status ?? 'draft')
  const [featured, setFeatured] = useState(value?.featured ?? false)
  const [advanced, setAdvanced] = useState(false)
  return <form className="altara-music-studio-form altara-music-studio-form--release" onSubmit={(event) => { event.preventDefault(); void run(() => saveNetAltaraMusicGmRelease({ id: recordId, artistId, title, slug, releaseType, coverRef, releaseDate, description, status, featured }), 'ALTARA MUSIC // RELEASE SAVED', (nextPayload) => onSaved(confirmedStudioRecordId(nextPayload.releases, recordId, 'release'), artistId)) }}><header><div><small>{value ? 'EDIT RELEASE' : 'NEW RELEASE'}</small><h2>{title || 'Create release'}</h2><p>{artists.find((artist) => artist.id === artistId)?.name ?? 'Select a catalog artist'}</p></div><button type="submit" disabled={busy || !artists.length}><Check size={14} /> {busy ? 'SAVING…' : 'SAVE RELEASE'}</button></header>{!artists.length ? <Feedback title="CREATE AN ARTIST FIRST" copy="Every release belongs to one canonical ALTARA artist." /> : <><fieldset className="altara-music-studio-cover-field"><legend>RELEASE COVER</legend><StudioArtworkUpload subjectId={value?.id} slot="cover" label="COVER" source={coverRef} previewLabel={`${title || 'Release'} cover`} onUploaded={setCoverRef} /></fieldset><fieldset><legend>RELEASE METADATA</legend><label>ARTIST<select value={artistId} onChange={(event) => setArtistId(event.target.value)}>{artists.map((artist) => <option key={artist.id} value={artist.id}>{artist.name}</option>)}</select></label><label>TITLE<input value={title} maxLength={160} required onChange={(event) => { setTitle(event.target.value); if (!value) setSlug(musicSlug(event.target.value)) }} /></label><div className="altara-music-form-pair"><label>FORMAT<select value={releaseType} onChange={(event) => setReleaseType(event.target.value as typeof releaseType)}>{netAltaraMusicReleaseTypes.map((type) => <option key={type} value={type}>{type.toUpperCase()}</option>)}</select></label><label>RELEASE DATE<input type="date" value={releaseDate} onChange={(event) => setReleaseDate(event.target.value)} /></label></div><label>DESCRIPTION<textarea rows={5} value={description} maxLength={4000} onChange={(event) => setDescription(event.target.value)} /></label><div className="altara-music-form-pair"><label>STATUS<select value={status} onChange={(event) => setStatus(event.target.value as NetAltaraMusicStatus)}>{statusOptions}</select></label><label className="altara-music-check"><input type="checkbox" checked={featured} onChange={(event) => setFeatured(event.target.checked)} /> FEATURED</label></div><button type="button" className="altara-music-studio-advanced-toggle" onClick={() => setAdvanced((shown) => !shown)}>{advanced ? 'HIDE' : 'SHOW'} ADVANCED METADATA</button>{advanced ? <label>STABLE SLUG<input value={slug} required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" onChange={(event) => setSlug(event.target.value)} /><small>Changing a published reference should be intentional.</small></label> : null}</fieldset></>}</form>
}

function TrackEditor({ value, defaultArtistId, defaultReleaseId, defaultTrackNumber, artists, releases, busy, run, lockedContext = false, onSaved, onDeleted }: { readonly value?: NetAltaraMusicGmTrack; readonly defaultArtistId?: string; readonly defaultReleaseId?: string; readonly defaultTrackNumber?: number; readonly artists: readonly NetAltaraMusicGmArtist[]; readonly releases: readonly NetAltaraMusicGmRelease[]; readonly busy: boolean; readonly run: StudioRun; readonly lockedContext?: boolean; readonly onSaved: (id: string) => void; readonly onDeleted: () => void }) {
  const [recordId] = useState(() => value?.id ?? crypto.randomUUID())
  const [artistId, setArtistId] = useState(value?.primaryArtistId ?? defaultArtistId ?? artists[0]?.id ?? '')
  const [releaseId, setReleaseId] = useState(value?.releaseId ?? defaultReleaseId ?? '')
  const [title, setTitle] = useState(value?.title ?? '')
  const [trackNumber, setTrackNumber] = useState(value?.trackNumber?.toString() ?? defaultTrackNumber?.toString() ?? '')
  const [discNumber, setDiscNumber] = useState(value?.discNumber.toString() ?? '1')
  const [artworkRef, setArtworkRef] = useState(value?.artworkRef ?? '')
  const [status, setStatus] = useState<NetAltaraMusicStatus>(value?.status ?? 'draft')
  const [featured, setFeatured] = useState(value?.featured ?? false)
  const [explicit, setExplicit] = useState(value?.explicit ?? false)
  const [file, setFile] = useState<File>()
  const [fileMetadata, setFileMetadata] = useState<AudioInspection>()
  const [fileError, setFileError] = useState<string>()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const fileGenerationRef = useRef(0)
  const compatibleReleases = releases.filter((release) => release.artistId === artistId)
  const artistName = artists.find((artist) => artist.id === artistId)?.name
  const releaseName = releases.find((release) => release.id === releaseId)?.title
  const selectFile = (nextFile?: File) => {
    if (!nextFile) return
    const generation = ++fileGenerationRef.current
    setFile(nextFile); setFileMetadata(undefined); setFileError(undefined)
    if (!value && !title.trim()) setTitle(titleFromAudioFilename(nextFile.name))
    void inspectNetAltaraMusicAudioFile(nextFile)
      .then((metadata) => { if (generation === fileGenerationRef.current) setFileMetadata(metadata) })
      .catch((metadataError) => {
        if (generation !== fileGenerationRef.current) return
        setFile(undefined)
        setFileMetadata(undefined)
        setFileError(metadataError instanceof Error ? metadataError.message : 'Audio validation failed.')
      })
  }
  const input = { id: recordId, artistId, releaseId: releaseId || undefined, title, trackNumber: trackNumber ? Number(trackNumber) : undefined, discNumber: Number(discNumber), artworkRef, explicit, status, featured }
  return <form className="altara-music-studio-form altara-music-studio-form--track" onSubmit={(event) => { event.preventDefault(); if (!value && (!file || !fileMetadata)) return; void run(() => value ? updateNetAltaraMusicGmTrack({ ...input, id: value.id }) : createNetAltaraMusicGmTrack(input, file!), `ALTARA MUSIC // TRACK ${value ? 'SAVED' : 'REGISTERED'}`, (nextPayload) => onSaved(confirmedStudioRecordId(nextPayload.tracks, recordId, 'track'))) }}><header><div><small>{value ? 'EDIT TRACK' : 'NEW NATIVE TRACK'}</small><h2>{title || 'Add a recording'}</h2><p>{lockedContext ? `${artistName ?? 'Artist'} · ${releaseName ?? 'Release'}` : 'Canonical ALTARA audio and editorial metadata.'}</p></div><button type="submit" disabled={busy || !artists.length || (!value && (!file || !fileMetadata))}><Check size={14} /> {busy ? 'WORKING…' : value ? 'SAVE TRACK' : 'UPLOAD & ADD TRACK'}</button></header><fieldset><legend>{value ? 'AUDIO MASTER' : '1 · SELECT AUDIO FILE'}</legend><input ref={fileRef} type="file" hidden accept="audio/mpeg,audio/mp4,audio/m4a,audio/x-m4a,audio/ogg,audio/webm,.mp3,.m4a,.mp4,.ogg,.webm" onChange={(event) => selectFile(event.target.files?.[0])} /><button type="button" className="altara-music-file-button" onClick={() => fileRef.current?.click()}><Upload size={14} /> {file ? 'REPLACE SELECTION' : value ? 'CHOOSE REPLACEMENT AUDIO' : 'SELECT AUDIO FILE'}</button>{file ? <div className="altara-music-audio-summary" data-valid={fileMetadata ? 'true' : 'false'}><span><small>FILE</small><strong>{file.name}</strong></span><span><small>SIZE</small><strong>{fileMetadata ? `${(fileMetadata.byteSize / 1024 / 1024).toFixed(2)} MB` : 'READING…'}</strong></span><span><small>DURATION</small><strong>{fileMetadata ? formatAltaraMusicDuration(fileMetadata.durationMs) : '—'}</strong></span><span><small>FORMAT</small><strong>{fileMetadata?.mimeType ?? 'VALIDATING'}</strong></span></div> : <p className="altara-music-file-status">{value ? `${value.audioMimeType} · ${(value.audioByteSize / 1024 / 1024).toFixed(2)} MB · ${formatAltaraMusicDuration(value.durationMs)}` : 'MP3, M4A/MP4, OGG or WebM · max 15 MB / 15 min'}</p>}{fileError ? <p className="altara-music-file-error" role="alert">{fileError}</p> : null}{value && file && fileMetadata ? <button type="button" disabled={busy} onClick={() => { void run(() => replaceNetAltaraMusicGmTrackAudio(value.id, file), 'ALTARA MUSIC // TRACK AUDIO REPLACED') }}>REPLACE AUDIO ONLY</button> : null}</fieldset><fieldset><legend>2 · TRACK DETAILS</legend>{lockedContext ? <div className="altara-music-studio-context"><span><small>ARTIST</small><strong>{artistName}</strong></span><ChevronRight size={13} /><span><small>RELEASE</small><strong>{releaseName}</strong></span></div> : <><label>ARTIST<select value={artistId} onChange={(event) => { setArtistId(event.target.value); setReleaseId('') }}>{artists.map((artist) => <option key={artist.id} value={artist.id}>{artist.name}</option>)}</select></label><label>RELEASE<select value={releaseId} onChange={(event) => setReleaseId(event.target.value)}><option value="">STANDALONE</option>{compatibleReleases.map((release) => <option key={release.id} value={release.id}>{release.title}</option>)}</select></label></>}<label>TRACK TITLE<input required maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} /></label><div className="altara-music-form-pair"><label>TRACK NUMBER<input type="number" min={1} max={999} value={trackNumber} onChange={(event) => setTrackNumber(event.target.value)} /></label><label>DISC<input type="number" min={1} max={99} value={discNumber} onChange={(event) => setDiscNumber(event.target.value)} /></label></div><StudioArtworkUpload subjectId={value?.id} slot="track" label="TRACK ARTWORK" source={artworkRef} previewLabel={`${title || 'Track'} artwork`} onUploaded={setArtworkRef} /></fieldset><fieldset><legend>3 · PUBLICATION</legend><label>STATUS<select value={status} onChange={(event) => setStatus(event.target.value as NetAltaraMusicStatus)}>{statusOptions}</select></label><label className="altara-music-check"><input type="checkbox" checked={explicit} onChange={(event) => setExplicit(event.target.checked)} /> EXPLICIT</label><label className="altara-music-check"><input type="checkbox" checked={featured} onChange={(event) => setFeatured(event.target.checked)} /> FEATURED</label>{value?.status === 'archived' ? <button type="button" className="altara-music-danger" onClick={() => { if (window.confirm(`Permanently delete ${value.title}? This requires no playlist/like dependencies and removes its exact audio object.`)) void run(() => deleteNetAltaraMusicGmTrack(value.id), 'ALTARA MUSIC // TRACK PERMANENTLY DELETED', onDeleted) }}><Trash2 size={14} /> PERMANENT DELETE</button> : null}</fieldset></form>
}

function PlaylistEditor({ value, tracks, busy, run, onSaved }: {
  readonly value?: NetAltaraMusicGmPlaylist
  readonly tracks: readonly NetAltaraMusicGmTrack[]
  readonly busy: boolean
  readonly run: StudioRun
  readonly onSaved: (id: string) => void
}) {
  const [recordId] = useState(() => value?.id ?? crypto.randomUUID())
  const [title, setTitle] = useState(value?.title ?? '')
  const [description, setDescription] = useState(value?.description ?? '')
  const [coverRef, setCoverRef] = useState(value?.coverRef ?? '')
  const [status, setStatus] = useState<NetAltaraMusicStatus>(value?.status ?? 'draft')
  const [featured, setFeatured] = useState(value?.featured ?? false)
  const [trackId, setTrackId] = useState('')
  const memberTracks = value
    ? value.trackIds.map((id) => tracks.find((track) => track.id === id)).filter((track): track is NetAltaraMusicGmTrack => Boolean(track))
    : []
  const availableTracks = value ? tracks.filter((track) => !value.trackIds.includes(track.id)) : []
  return (
    <form className="altara-music-studio-form" onSubmit={(event) => {
      event.preventDefault()
      void run(
        () => saveNetAltaraMusicGmPlaylist({ id: recordId, title, description, coverRef, status, featured }),
        'ALTARA MUSIC // CURATED PLAYLIST SAVED',
        (nextPayload) => onSaved(confirmedStudioRecordId(nextPayload.playlists, recordId, 'curated playlist')),
      )
    }}>
      <header><div><small>{value ? 'EDIT CURATED PLAYLIST' : 'NEW CURATED PLAYLIST'}</small><h2>{title || 'Build a collection'}</h2><p>Editorial ALTARA collection, separate from private listener playlists.</p></div><button type="submit" disabled={busy}><Check size={14} /> {busy ? 'SAVING…' : 'SAVE PLAYLIST'}</button></header>
      <fieldset><legend>COLLECTION</legend><label>TITLE<input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>DESCRIPTION<textarea rows={6} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} /></label><StudioArtworkUpload subjectId={value?.id} slot="cover" label="PLAYLIST COVER" source={coverRef} previewLabel={`${title || 'Playlist'} cover`} onUploaded={setCoverRef} /></fieldset>
      <fieldset><legend>PUBLICATION</legend><label>STATUS<select value={status} onChange={(event) => setStatus(event.target.value as NetAltaraMusicStatus)}>{statusOptions}</select></label><label className="altara-music-check"><input type="checkbox" checked={featured} onChange={(event) => setFeatured(event.target.checked)} /> FEATURED</label><p>Track membership is stored as ordered rows. V1 appends tracks without rewriting an array.</p></fieldset>
      <fieldset className="altara-music-studio-membership">
        <legend>ORDERED TRACKS</legend>
        {!value ? <p>Save this collection first, then select it from the directory to add tracks.</p> : (
          <>
            <div className="altara-music-studio-membership__add">
              <select value={trackId} onChange={(event) => setTrackId(event.target.value)} aria-label="Track to add">
                <option value="">SELECT A TRACK</option>
                {availableTracks.map((track) => <option key={track.id} value={track.id}>{track.title}</option>)}
              </select>
              <button type="button" disabled={busy || !trackId} onClick={() => {
                if (!trackId) return
                void run(
                  () => setNetAltaraMusicGmPlaylistTrack(value.id, trackId, true),
                  'ALTARA MUSIC // TRACK ADDED TO CURATED PLAYLIST',
                ).then(() => setTrackId(''))
              }}><Plus size={13} /> ADD</button>
            </div>
            <div className="altara-music-studio-membership__list">
              {memberTracks.map((track, index) => (
                <div key={track.id}>
                  <span><small>{String(index + 1).padStart(2, '0')}</small><strong>{track.title}</strong></span>
                  <button type="button" disabled={busy} aria-label={`Remove ${track.title}`} onClick={() => {
                    void run(
                      () => setNetAltaraMusicGmPlaylistTrack(value.id, track.id, false),
                      'ALTARA MUSIC // TRACK REMOVED FROM CURATED PLAYLIST',
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

export function AltaraMusicApp(props: AltaraMusicAppProps) {
  return props.mode === 'studio'
    ? <Studio enabled={props.enabled} onNotice={props.onNotice} />
    : <MusicReader {...props} />
}
