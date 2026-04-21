import { useMemo, useState } from 'react'
import { getCyberwareDisplayName } from '../../lib/cyberwareCatalog'
import { getCyberwareIconCandidates, getCyberwareIconFallbackLabel } from '../../lib/cyberwareIcons'
import type { Cyberware } from '../../types/cyberware'

interface CyberwareIconProps {
  cyberware: Cyberware
  alt?: string
  accentColor: string
  glowFilter?: string
  className?: string
  fallbackClassName?: string
}

export function CyberwareIcon({
  cyberware,
  alt,
  accentColor,
  glowFilter,
  className,
  fallbackClassName,
}: CyberwareIconProps) {
  const candidates = useMemo(() => getCyberwareIconCandidates(cyberware), [cyberware])
  const fallbackLabel = useMemo(() => getCyberwareIconFallbackLabel(cyberware), [cyberware])
  const displayName = useMemo(() => getCyberwareDisplayName(cyberware), [cyberware])
  const candidatesKey = useMemo(() => candidates.join('|'), [candidates])
  const [imageState, setImageState] = useState({
    candidatesKey: '',
    failedIndex: 0,
  })
  const candidateIndex = imageState.candidatesKey === candidatesKey ? imageState.failedIndex : 0
  const currentSrc = candidates[candidateIndex]

  if (currentSrc) {
    return (
      <img
        src={currentSrc}
        alt={alt || displayName}
        className={className}
        onError={() => {
          setImageState({
            candidatesKey,
            failedIndex: candidateIndex + 1,
          })
        }}
      />
    )
  }

  return (
    <span
      className={fallbackClassName}
      style={{
        color: accentColor,
        filter: glowFilter,
      }}
    >
      {fallbackLabel}
    </span>
  )
}
