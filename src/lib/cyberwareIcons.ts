import type { Cyberware } from '../types/cyberware'
import { getCyberwareDisplayName } from './cyberwareCatalog'

export const CYBERWARE_ICON_FOLDER = '/cyberware-icons'

const CYBERWARE_ICON_EXTENSIONS = ['png', 'webp', 'jpg', 'jpeg', 'svg'] as const

function hasExplicitExtension(value: string) {
  return /\.[a-z0-9]+$/i.test(value)
}

function isAbsoluteIconPath(value: string) {
  return /^(?:https?:|data:|\/)/i.test(value)
}

export function getCyberwareIconKey(cyberware: Cyberware) {
  if (typeof cyberware.icon === 'string') {
    const trimmedIcon = cyberware.icon.trim()

    if (!trimmedIcon) {
      return ''
    }

    return trimmedIcon
  }

  return cyberware.id.trim()
}

export function getCyberwareIconCandidates(cyberware: Cyberware) {
  const iconKey = getCyberwareIconKey(cyberware)

  if (!iconKey) {
    return []
  }

  if (isAbsoluteIconPath(iconKey)) {
    return [iconKey]
  }

  if (hasExplicitExtension(iconKey)) {
    return [`${CYBERWARE_ICON_FOLDER}/${iconKey}`]
  }

  return CYBERWARE_ICON_EXTENSIONS.map((extension) => `${CYBERWARE_ICON_FOLDER}/${iconKey}.${extension}`)
}

export function getCyberwareIconFallbackLabel(cyberware: Cyberware) {
  if (cyberware.icon?.trim()) {
    return cyberware.icon.trim().slice(0, 2).toUpperCase()
  }

  return getCyberwareDisplayName(cyberware)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase()
}
