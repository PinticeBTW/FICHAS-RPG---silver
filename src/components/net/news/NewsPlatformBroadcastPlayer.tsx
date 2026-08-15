import { Radio, RefreshCcw, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { NewsPlatformBroadcastView } from '../../../lib/newsPlatformTypes'

function classes(prefix: string, token: string) {
  return `${prefix}-${token}`
}

export function NewsPlatformBroadcastPlayer({
  classNamePrefix,
  broadcast,
}: {
  readonly classNamePrefix: string
  readonly broadcast: NewsPlatformBroadcastView
}) {
  const [clock, setClock] = useState(() => Date.now())
  const isBreaking = broadcast.status === 'breaking'
  const isOnAir = broadcast.status === 'on-air' || isBreaking
  const start = broadcast.startedAt ? Date.parse(broadcast.startedAt) : Number.NaN
  const end = broadcast.endsAt ? Date.parse(broadcast.endsAt) : Number.NaN
  const hasWindow = Number.isFinite(start) && Number.isFinite(end) && end > start
  const progress = hasWindow ? Math.min(1, Math.max(0, (clock - start) / (end - start))) : 0
  const elapsed = hasWindow ? Math.floor(Math.max(0, clock - start) / 1000) : 0
  const duration = hasWindow ? Math.round((end - start) / 1000) : 0
  const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  useEffect(() => {
    if (!isOnAir || !hasWindow) return undefined
    const timer = window.setInterval(() => setClock(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [broadcast.endsAt, broadcast.startedAt, hasWindow, isOnAir])
  return (
    <section className={classes(classNamePrefix, 'radio-desk')} data-mode={isBreaking ? 'breaking' : broadcast.modeKey ?? 'rotation'} aria-live="polite">
      <header className={classes(classNamePrefix, 'radio-desk__masthead')}>
        <div><span className={classes(classNamePrefix, 'radio-desk__eyebrow')}><Radio size={13} aria-hidden="true" />{broadcast.productLabel}</span><h2>{isBreaking ? 'Breaking News' : broadcast.programmeLabel}</h2></div>
        <span className={classes(classNamePrefix, 'radio-desk__status')} data-live={isOnAir ? 'true' : undefined}><i />{isOnAir ? 'On air' : 'Off air'}</span>
      </header>
      {isOnAir ? (
        <div className={classes(classNamePrefix, 'radio-desk__transmission')}><span>{isBreaking ? 'Regular programming interrupted' : broadcast.transmissionLabel ?? broadcast.currentKindLabel ?? 'Live bulletin'}</span><strong>{isBreaking ? 'Breaking News' : broadcast.currentLabel ?? broadcast.programmeLabel}</strong><p>{broadcast.tuned ? broadcast.tunedCopy ?? 'Live carrier locked to the authoritative station clock.' : broadcast.untunedCopy ?? 'Tune in to join the transmission at its current live position.'}</p>{hasWindow ? <div className={classes(classNamePrefix, 'radio-desk__progress')} aria-label={`${time(elapsed)} of ${time(duration)}`}><span style={{ transform: `scaleX(${progress})` }} /><small>{time(elapsed)} / {time(duration)}</small></div> : null}</div>
      ) : broadcast.status === 'synchronizing' ? <p className={classes(classNamePrefix, 'radio-desk__message')}>{broadcast.synchronizingCopy ?? 'Synchronizing the live carrier…'}</p> : <p className={classes(classNamePrefix, 'radio-desk__message')}>{broadcast.offAirCopy ?? 'The live broadcast is currently off air.'}</p>}
      {broadcast.error ? <div className={classes(classNamePrefix, 'radio-desk__error')} role="alert"><span>{broadcast.error}</span><button type="button" onClick={broadcast.onRetry}><RefreshCcw size={13} aria-hidden="true" />Retry tune</button></div> : null}
      <div className={classes(classNamePrefix, 'radio-desk__controls')}>
        <button type="button" className={classes(classNamePrefix, 'radio-desk__primary')} onClick={broadcast.tuned ? broadcast.onTuneOut : broadcast.onTuneIn} disabled={!broadcast.tuned && (!isOnAir || broadcast.joining)}>
          {broadcast.tuned ? 'Tune out' : broadcast.joining || broadcast.status === 'synchronizing' ? 'Joining live carrier…' : 'Tune in'}
        </button>
        <button type="button" className={classes(classNamePrefix, 'radio-desk__mute')} onClick={() => broadcast.onMutedChange(!broadcast.muted)} aria-pressed={broadcast.muted} disabled={!broadcast.tuned}>
          {broadcast.muted ? <VolumeX size={15} aria-hidden="true" /> : <Volume2 size={15} aria-hidden="true" />}{broadcast.muted ? 'Muted' : 'Mute'}
        </button>
        <label className={classes(classNamePrefix, 'radio-desk__volume')}><span>Volume</span><input type="range" min="0" max="1" step="0.05" value={broadcast.volume} onChange={(event) => broadcast.onVolumeChange(Number(event.target.value))} disabled={!broadcast.tuned} /></label>
      </div>
      <footer>{broadcast.syncing ? 'Resynchronizing live carrier…' : 'Live transmission · No rewind · No replay'}</footer>
    </section>
  )
}
