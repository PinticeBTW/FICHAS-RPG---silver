import { Radio, RefreshCcw, Volume2, VolumeX } from 'lucide-react'

import type { NetNvnRadioClipKind } from '../../lib/netNvnRadioTypes'
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
  const isBreaking = radio.tuneState?.mode === 'breaking'
  const isOnAir = radio.tuneState?.stationStatus === 'on-air' && Boolean(current)

  return (
    <section
      className="nvn-radio-desk"
      data-mode={isBreaking ? 'breaking' : radio.tuneState?.mode ?? 'rotation'}
      aria-labelledby="nvn-radio-title"
      aria-live="polite"
    >
      <header className="nvn-radio-desk__masthead">
        <div>
          <span className="nvn-radio-desk__eyebrow"><Radio size={13} aria-hidden="true" /> NVN Live Broadcast</span>
          <h2 id="nvn-radio-title">{isBreaking ? 'Breaking News' : 'City News Network'}</h2>
        </div>
        <span className="nvn-radio-desk__status" data-live={isOnAir ? 'true' : undefined}>
          <i /> {isOnAir ? 'On air' : 'Off air'}
        </span>
      </header>

      {isOnAir && current ? (
        <div className="nvn-radio-desk__transmission">
          <span>{isBreaking ? 'Regular programming interrupted' : radio.tuneState?.mode === 'play-now' ? 'Special bulletin' : CLIP_KIND_LABELS[current.clipKind]}</span>
          <strong>{isBreaking ? 'Breaking News' : current.publicLabel ?? CLIP_KIND_LABELS[current.clipKind]}</strong>
          <p>
            {radio.tuned
              ? 'Live carrier locked. This transmission follows the citywide station clock.'
              : 'Tune in to join the transmission at its current live position.'}
          </p>
        </div>
      ) : radio.phase === 'synchronizing' ? (
        <p className="nvn-radio-desk__message">Synchronizing the citywide carrier…</p>
      ) : (
        <p className="nvn-radio-desk__message">NVN Live Broadcast is not transmitting on the public grid.</p>
      )}

      {radio.error ? (
        <div className="nvn-radio-desk__error" role="alert">
          <span>{radio.error}</span>
          <button type="button" onClick={radio.retry}>
            <RefreshCcw size={13} aria-hidden="true" /> Retry tune
          </button>
        </div>
      ) : null}

      <div className="nvn-radio-desk__controls">
        {radio.tuned ? (
          <button type="button" className="nvn-radio-desk__primary" onClick={radio.tuneOut}>
            Tune out
          </button>
        ) : (
          <button
            type="button"
            className="nvn-radio-desk__primary"
            onClick={radio.tuneIn}
            disabled={!isOnAir || radio.phase === 'loading'}
          >
            {radio.phase === 'loading' ? 'Joining live carrier…' : 'Tune in'}
          </button>
        )}

        <button
          type="button"
          className="nvn-radio-desk__mute"
          onClick={() => radio.setMuted(!radio.muted)}
          aria-pressed={radio.muted}
          aria-label={radio.muted ? 'Unmute NVN Live Broadcast' : 'Mute NVN Live Broadcast'}
          disabled={!radio.tuned}
        >
          {radio.muted ? <VolumeX size={15} aria-hidden="true" /> : <Volume2 size={15} aria-hidden="true" />}
          {radio.muted ? 'Muted' : 'Mute'}
        </button>

        <label className="nvn-radio-desk__volume">
          <span>Volume</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={radio.volume}
            onChange={(event) => radio.setVolume(Number(event.target.value))}
            disabled={!radio.tuned}
            aria-label="NVN Live Broadcast volume"
          />
        </label>
      </div>

      <footer>
        {radio.syncing ? 'Resynchronizing live carrier…' : 'Live transmission · No rewind · No replay'}
      </footer>
    </section>
  )
}
