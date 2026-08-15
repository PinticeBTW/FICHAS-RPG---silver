import { isSharedMediaReference } from './media/mediaReference'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type NewsMediaPlacementKind = 'hero' | 'inline'

export interface NewsArticleMedia {
  readonly id: string
  readonly placementKind: NewsMediaPlacementKind
  readonly mediaRef: string
  readonly caption?: string
  readonly altText: string
  /** Zero-based paragraph index. Inline media renders after this paragraph. */
  readonly paragraphIndex?: number
  readonly sortOrder: number
}

export interface NewsroomArticleMediaInput {
  readonly mediaId?: string
  readonly placementKind: NewsMediaPlacementKind
  readonly mediaRef: string
  readonly caption?: string
  readonly altText: string
  /** Zero-based paragraph index. Required for inline media, absent for hero. */
  readonly paragraphIndex?: number
}

export interface NewsArticleMediaContract {
  readonly productLabel: string
  readonly maxTotal: number
  readonly maxInline: number
  readonly mediaRefMaxLength: number
  readonly captionMaxLength: number
  readonly altTextMaxLength: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Shared fail-closed parser for bounded news-media payloads. Product adapters
 * retain their own server tables and RPCs while sharing one defensive client
 * contract.
 */
export function parseNewsArticleMedia(
  value: unknown,
  invalid: (message: string) => never,
  contract: NewsArticleMediaContract,
): readonly NewsArticleMedia[] {
  if (!Array.isArray(value) || value.length > contract.maxTotal) {
    return invalid(`Invalid bounded article media returned by the ${contract.productLabel} server.`)
  }

  let heroCount = 0
  let inlineCount = 0
  const occupiedSlots = new Set<string>()
  return value.map((candidate) => {
    if (!isRecord(candidate)) {
      return invalid(`Invalid article media row returned by the ${contract.productLabel} server.`)
    }
    const id = candidate.id
    const placementKind = candidate.placement_kind
    const mediaRef = candidate.media_ref
    const caption = candidate.caption
    const altText = candidate.alt_text
    const paragraphIndex = candidate.paragraph_index
    const sortOrder = candidate.sort_order

    if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
      return invalid(`Invalid article media ID returned by the ${contract.productLabel} server.`)
    }
    if (placementKind !== 'hero' && placementKind !== 'inline') {
      return invalid(`Invalid article media placement returned by the ${contract.productLabel} server.`)
    }
    if (
      typeof mediaRef !== 'string'
      || mediaRef.length > contract.mediaRefMaxLength
      || !isSharedMediaReference(mediaRef)
    ) {
      return invalid(`Invalid shared-media reference returned by the ${contract.productLabel} server.`)
    }
    if (
      caption !== null
      && caption !== undefined
      && (
        typeof caption !== 'string'
        || caption.trim().length === 0
        || caption.length > contract.captionMaxLength
      )
    ) {
      return invalid(`Invalid article media caption returned by the ${contract.productLabel} server.`)
    }
    if (
      typeof altText !== 'string'
      || altText.trim().length === 0
      || altText.length > contract.altTextMaxLength
    ) {
      return invalid(`Invalid article media alternative text returned by the ${contract.productLabel} server.`)
    }
    if (!Number.isSafeInteger(sortOrder) || Number(sortOrder) < 0 || Number(sortOrder) > 7) {
      return invalid(`Invalid article media order returned by the ${contract.productLabel} server.`)
    }

    if (placementKind === 'hero') {
      heroCount += 1
      if (heroCount > 1 || paragraphIndex !== null || Number(sortOrder) !== 0) {
        return invalid(`Invalid hero media placement returned by the ${contract.productLabel} server.`)
      }
    } else {
      inlineCount += 1
      if (
        inlineCount > contract.maxInline
        || !Number.isSafeInteger(paragraphIndex)
        || Number(paragraphIndex) < 0
        || Number(paragraphIndex) > 4095
      ) {
        return invalid(`Invalid inline media placement returned by the ${contract.productLabel} server.`)
      }
    }

    const slotKey = `${placementKind}:${String(sortOrder)}`
    if (occupiedSlots.has(slotKey)) {
      return invalid(`Duplicate article media slot returned by the ${contract.productLabel} server.`)
    }
    occupiedSlots.add(slotKey)

    return {
      id,
      placementKind,
      mediaRef,
      ...(typeof caption === 'string' ? { caption } : {}),
      altText,
      ...(placementKind === 'inline' ? { paragraphIndex: Number(paragraphIndex) } : {}),
      sortOrder: Number(sortOrder),
    }
  })
}

export function splitNewsArticleParagraphs(body: string): readonly string[] {
  return body.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean)
}
