import {
  NET_ALTARA_NEWS_INLINE_MEDIA_MAX,
  NET_ALTARA_NEWS_MEDIA_ALT_MAX_LENGTH,
  NET_ALTARA_NEWS_MEDIA_CAPTION_MAX_LENGTH,
  NET_ALTARA_NEWS_MEDIA_MAX_TOTAL,
  type NetAltaraNewsArticleMedia,
  type NetAltaraNewsGmArticleMediaInput,
} from '../../../lib/netAltaraNewsTypes'
import {
  NewsroomMediaEditor,
  type NewsroomMediaEditorConfig,
} from '../news/NewsroomMediaEditor'
import { altaraNewsMediaCopy, altaraNewsMediaTheme } from './altaraNewsMediaConfig'

const config: NewsroomMediaEditorConfig = {
  noticePrefix: 'NEWSROOM',
  storageSubjectKind: 'altara-news-article',
  newsroomClassPrefix: 'altara',
  spinnerClassName: 'altara-news-spin',
  accentColor: '#cdb785',
  heroCropTitle: 'Frame ALTARA NEWS hero',
  heroCropDescription: 'Choose the 16:9 editorial frame. The optimized result remains in private RPG media storage.',
  maxTotal: NET_ALTARA_NEWS_MEDIA_MAX_TOTAL,
  maxInline: NET_ALTARA_NEWS_INLINE_MEDIA_MAX,
  captionMaxLength: NET_ALTARA_NEWS_MEDIA_CAPTION_MAX_LENGTH,
  altTextMaxLength: NET_ALTARA_NEWS_MEDIA_ALT_MAX_LENGTH,
  articleMediaTheme: altaraNewsMediaTheme,
  articleMediaCopy: altaraNewsMediaCopy,
}

export function AltaraNewsroomMediaEditor({
  articleId,
  body,
  media,
  busy,
  missingDraftFields,
  canSaveDraft,
  onSaveDraft,
  onSet,
  onRequestRemove,
  onNotice,
}: {
  readonly articleId?: string
  readonly body: string
  readonly media: readonly NetAltaraNewsArticleMedia[]
  readonly busy: boolean
  readonly missingDraftFields: readonly string[]
  readonly canSaveDraft: boolean
  readonly onSaveDraft: () => Promise<boolean>
  readonly onSet: (input: NetAltaraNewsGmArticleMediaInput) => Promise<void>
  readonly onRequestRemove: (media: NetAltaraNewsArticleMedia) => void
  readonly onNotice: (message: string) => void
}) {
  return (
    <NewsroomMediaEditor
      config={config}
      articleId={articleId}
      body={body}
      media={media}
      busy={busy}
      missingDraftFields={missingDraftFields}
      canSaveDraft={canSaveDraft}
      onSaveDraft={onSaveDraft}
      onSet={onSet}
      onRequestRemove={onRequestRemove}
      onNotice={onNotice}
    />
  )
}
