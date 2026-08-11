import { isSharedMediaReference } from './media/mediaReference'
import {
  NET_NVN_INLINE_MEDIA_MAX,
  NET_NVN_MEDIA_ALT_MAX_LENGTH,
  NET_NVN_MEDIA_CAPTION_MAX_LENGTH,
  NET_NVN_MEDIA_MAX_TOTAL,
  NET_NVN_MEDIA_REF_MAX_LENGTH,
  netNvnMediaPlacementKinds,
  type NetNvnArticleMedia,
  type NetNvnMediaPlacementKind,
} from './netNvnTypes'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Defensively parses the bounded JSON projection shared by player and GM detail RPCs. */
export function parseNetNvnArticleMedia(
  value: unknown,
  invalid: (message: string) => never,
): readonly NetNvnArticleMedia[] {
  if (!Array.isArray(value) || value.length > NET_NVN_MEDIA_MAX_TOTAL) {
    return invalid('Invalid bounded article media returned by the NVN server.')
  }

  let heroCount = 0
  let inlineCount = 0
  const occupiedSlots = new Set<string>()
  return value.map((candidate) => {
    if (!isRecord(candidate)) return invalid('Invalid article media row returned by the NVN server.')
    const id = candidate.id
    const placementKind = candidate.placement_kind
    const mediaRef = candidate.media_ref
    const caption = candidate.caption
    const altText = candidate.alt_text
    const paragraphIndex = candidate.paragraph_index
    const sortOrder = candidate.sort_order

    if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
      return invalid('Invalid article media ID returned by the NVN server.')
    }
    if (
      typeof placementKind !== 'string'
      || !netNvnMediaPlacementKinds.includes(placementKind as NetNvnMediaPlacementKind)
    ) {
      return invalid('Invalid article media placement returned by the NVN server.')
    }
    if (
      typeof mediaRef !== 'string'
      || mediaRef.length > NET_NVN_MEDIA_REF_MAX_LENGTH
      || !isSharedMediaReference(mediaRef)
    ) {
      return invalid('Invalid shared-media reference returned by the NVN server.')
    }
    if (
      caption !== null
      && caption !== undefined
      && (
        typeof caption !== 'string'
        || caption.trim().length === 0
        || caption.length > NET_NVN_MEDIA_CAPTION_MAX_LENGTH
      )
    ) {
      return invalid('Invalid article media caption returned by the NVN server.')
    }
    if (
      typeof altText !== 'string'
      || altText.trim().length === 0
      || altText.length > NET_NVN_MEDIA_ALT_MAX_LENGTH
    ) {
      return invalid('Invalid article media alternative text returned by the NVN server.')
    }
    if (!Number.isSafeInteger(sortOrder) || Number(sortOrder) < 0 || Number(sortOrder) > 7) {
      return invalid('Invalid article media order returned by the NVN server.')
    }

    if (placementKind === 'hero') {
      heroCount += 1
      if (heroCount > 1 || paragraphIndex !== null || Number(sortOrder) !== 0) {
        return invalid('Invalid hero media placement returned by the NVN server.')
      }
    } else {
      inlineCount += 1
      if (
        inlineCount > NET_NVN_INLINE_MEDIA_MAX
        || !Number.isSafeInteger(paragraphIndex)
        || Number(paragraphIndex) < 0
        || Number(paragraphIndex) > 4095
      ) {
        return invalid('Invalid inline media placement returned by the NVN server.')
      }
    }

    const slotKey = `${placementKind}:${String(sortOrder)}`
    if (occupiedSlots.has(slotKey)) {
      return invalid('Duplicate article media slot returned by the NVN server.')
    }
    occupiedSlots.add(slotKey)

    return {
      id,
      placementKind: placementKind as NetNvnMediaPlacementKind,
      mediaRef,
      ...(typeof caption === 'string' ? { caption } : {}),
      altText,
      ...(placementKind === 'inline' ? { paragraphIndex: Number(paragraphIndex) } : {}),
      sortOrder: Number(sortOrder),
    }
  })
}
