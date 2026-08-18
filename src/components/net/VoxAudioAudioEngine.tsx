import type { VoxAudioPlayerController } from './useVoxAudioPlayer'

export function VoxAudioAudioEngine({
  bindAudioElement,
  onTimeUpdate,
  onDurationChange,
  onPlaying,
  onPause,
  onEnded,
  onError,
}: Pick<
  VoxAudioPlayerController,
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
