import type { AltaraMusicPlayerController } from './useAltaraMusicPlayer'

export function AltaraMusicAudioEngine({
  bindAudioElement,
  onTimeUpdate,
  onDurationChange,
  onPlaying,
  onPause,
  onEnded,
  onError,
}: Pick<
  AltaraMusicPlayerController,
  'bindAudioElement' | 'onTimeUpdate' | 'onDurationChange' | 'onPlaying' | 'onPause' | 'onEnded' | 'onError'
>) {
  return (
    <audio
      ref={bindAudioElement}
      preload="metadata"
      onTimeUpdate={onTimeUpdate}
      onDurationChange={onDurationChange}
      onPlaying={onPlaying}
      onPause={onPause}
      onEnded={onEnded}
      onError={onError}
    />
  )
}
