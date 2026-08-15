import {
  NET_NVN_INLINE_MEDIA_MAX,
  NET_NVN_MEDIA_ALT_MAX_LENGTH,
  NET_NVN_MEDIA_CAPTION_MAX_LENGTH,
  NET_NVN_MEDIA_MAX_TOTAL,
  type NetNvnArticleMedia,
  type NetNvnGmArticleMediaInput,
} from '../../lib/netNvnTypes'
import {
  NewsroomMediaEditor,
  type NewsroomMediaEditorConfig,
} from './news/NewsroomMediaEditor'

const config: NewsroomMediaEditorConfig = {
  noticePrefix: 'NVN',
  storageSubjectKind: 'nvn-article',
  newsroomClassPrefix: 'nvn',
  spinnerClassName: 'nvn-reader-feedback__spinner',
  accentColor: '#2de2d0',
  heroCropTitle: 'Frame newsroom hero',
  heroCropDescription: 'Choose the 16:9 crop used at the top of this article. The optimized result stays in private RPG media storage.',
  maxTotal: NET_NVN_MEDIA_MAX_TOTAL,
  maxInline: NET_NVN_INLINE_MEDIA_MAX,
  captionMaxLength: NET_NVN_MEDIA_CAPTION_MAX_LENGTH,
  altTextMaxLength: NET_NVN_MEDIA_ALT_MAX_LENGTH,
  articleMediaTheme: {
    figure: 'nvn-article-media',
    fallback: 'nvn-article-media__fallback',
    spinner: 'nvn-reader-feedback__spinner',
    body: 'nvn-article__body',
    paragraphBlock: 'nvn-article__paragraph-block',
  },
  articleMediaCopy: {
    resolving: 'Resolving secure image',
    unavailable: 'Secure image could not be opened',
    retry: 'Retry image',
  },
}

export function NvnNewsroomMediaEditor({
  articleId,
  body,
  media,
  busy,
  missingDraftFields,
  draftValidationIssue,
  canSaveDraft,
  onSaveDraft,
  onSet,
  onRequestRemove,
  onNotice,
}: {
  readonly articleId?: string
  readonly body: string
  readonly media: readonly NetNvnArticleMedia[]
  readonly busy: boolean
  readonly missingDraftFields: readonly string[]
  readonly draftValidationIssue?: string
  readonly canSaveDraft: boolean
  readonly onSaveDraft: () => Promise<boolean>
  readonly onSet: (input: NetNvnGmArticleMediaInput) => Promise<void>
  readonly onRequestRemove: (media: NetNvnArticleMedia) => void
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
      draftValidationIssue={draftValidationIssue}
      canSaveDraft={canSaveDraft}
      onSaveDraft={onSaveDraft}
      onSet={onSet}
      onRequestRemove={onRequestRemove}
      onNotice={onNotice}
    />
  )
}
