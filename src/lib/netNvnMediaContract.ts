import { parseNewsArticleMedia } from './newsArticleMedia'
import {
  NET_NVN_INLINE_MEDIA_MAX,
  NET_NVN_MEDIA_ALT_MAX_LENGTH,
  NET_NVN_MEDIA_CAPTION_MAX_LENGTH,
  NET_NVN_MEDIA_MAX_TOTAL,
  NET_NVN_MEDIA_REF_MAX_LENGTH,
  type NetNvnArticleMedia,
} from './netNvnTypes'

/** Defensively parses the bounded JSON projection shared by player and GM detail RPCs. */
export function parseNetNvnArticleMedia(
  value: unknown,
  invalid: (message: string) => never,
): readonly NetNvnArticleMedia[] {
  return parseNewsArticleMedia(value, invalid, {
    productLabel: 'NVN',
    maxTotal: NET_NVN_MEDIA_MAX_TOTAL,
    maxInline: NET_NVN_INLINE_MEDIA_MAX,
    mediaRefMaxLength: NET_NVN_MEDIA_REF_MAX_LENGTH,
    captionMaxLength: NET_NVN_MEDIA_CAPTION_MAX_LENGTH,
    altTextMaxLength: NET_NVN_MEDIA_ALT_MAX_LENGTH,
  }) as readonly NetNvnArticleMedia[]
}
