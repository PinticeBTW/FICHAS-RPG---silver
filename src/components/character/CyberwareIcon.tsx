import { useEffect, useMemo, useState } from 'react'
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
  const [candidateIndex, setCandidateIndex] = useState(0)

  useEffect(() => {
    setCandidateIndex(0)
  }, [candidates])

  const currentSrc = candidates[candidateIndex]

  if (currentSrc) {
    return (
      <img
        src={currentSrc}
        alt={alt ?? cyberware.name}
        className={className}
        onError={() => {
          if (candidateIndex < candidates.length - 1) {
            setCandidateIndex((current) => current + 1)
          } else {
            setCandidateIndex(candidates.length)
          }
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
