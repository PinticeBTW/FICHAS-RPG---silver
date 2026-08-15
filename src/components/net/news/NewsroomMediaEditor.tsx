import { ImagePlus, LoaderCircle, RefreshCcw, Save, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { validateImageInput } from '../../../lib/media/imageOptimization'
import { uploadSharedImage } from '../../../lib/media/mediaStorage'
import type { SharedMediaSubjectKind } from '../../../lib/media/mediaTypes'
import {
  splitNewsArticleParagraphs,
  type NewsArticleMedia,
  type NewsMediaPlacementKind,
  type NewsroomArticleMediaInput,
} from '../../../lib/newsArticleMedia'
import { ImageCropDialog } from '../../shared/ImageCropDialog'
import {
  NewsArticleMediaFigure,
  type NewsArticleMediaCopy,
  type NewsArticleMediaTheme,
} from './NewsArticleMedia'

export interface NewsroomMediaEditorConfig {
  readonly noticePrefix: string
  readonly storageSubjectKind: SharedMediaSubjectKind
  readonly newsroomClassPrefix: string
  readonly spinnerClassName: string
  readonly accentColor: string
  readonly heroCropTitle: string
  readonly heroCropDescription: string
  readonly maxTotal: number
  readonly maxInline: number
  readonly captionMaxLength: number
  readonly altTextMaxLength: number
  readonly articleMediaTheme: NewsArticleMediaTheme
  readonly articleMediaCopy: NewsArticleMediaCopy
}

interface MediaRowProps<TMedia extends NewsArticleMedia> {
  readonly config: NewsroomMediaEditorConfig
  readonly articleId: string
  readonly placementKind: NewsMediaPlacementKind
  readonly paragraphCount: number
  readonly media?: TMedia
  readonly busy: boolean
  readonly onSet: (input: NewsroomArticleMediaInput) => Promise<void>
  readonly onRequestRemove: (media: TMedia) => void
  readonly onNotice: (message: string) => void
}

type MediaActionPhase = 'idle' | 'cropping' | 'uploading' | 'attaching'

function MediaRow<TMedia extends NewsArticleMedia>({
  config,
  articleId,
  placementKind,
  paragraphCount,
  media,
  busy,
  onSet,
  onRequestRemove,
  onNotice,
}: MediaRowProps<TMedia>) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const mountedRef = useRef(true)
  const operationVersionRef = useRef(0)
  const cropSourceRef = useRef<string | null>(null)
  const [altText, setAltText] = useState(media?.altText ?? '')
  const [caption, setCaption] = useState(media?.caption ?? '')
  const [paragraphIndex, setParagraphIndex] = useState(media?.paragraphIndex ?? 0)
  const [phase, setPhase] = useState<MediaActionPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [cropSource, setCropSource] = useState<string | null>(null)
  const [retryReference, setRetryReference] = useState<string | null>(null)
  const className = (name: string) => `${config.newsroomClassPrefix}-${name}`

  const clearCropSource = () => {
    if (cropSourceRef.current) URL.revokeObjectURL(cropSourceRef.current)
    cropSourceRef.current = null
    setCropSource(null)
  }

  useEffect(() => {
    setAltText(media?.altText ?? '')
    setCaption(media?.caption ?? '')
    setParagraphIndex(media?.paragraphIndex ?? 0)
    setRetryReference(null)
    setError(null)
  }, [media?.altText, media?.caption, media?.id, media?.mediaRef, media?.paragraphIndex])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      operationVersionRef.current += 1
      if (cropSourceRef.current) URL.revokeObjectURL(cropSourceRef.current)
      cropSourceRef.current = null
    }
  }, [])

  const normalizedAlt = altText.trim()
  const normalizedCaption = caption.trim()
  const actionPending = phase === 'uploading' || phase === 'attaching'
  const canAct = normalizedAlt.length > 0 && !busy && phase === 'idle'
  const canSave = Boolean(media) && canAct
  const operationIsCurrent = (version: number) => (
    mountedRef.current && operationVersionRef.current === version
  )

  const inputForReference = (mediaRef: string): NewsroomArticleMediaInput => ({
    ...(media ? { mediaId: media.id } : {}),
    placementKind,
    mediaRef,
    ...(normalizedCaption ? { caption: normalizedCaption } : {}),
    altText: normalizedAlt,
    ...(placementKind === 'inline' ? {
      paragraphIndex: Math.min(Math.max(paragraphIndex, 0), Math.max(0, paragraphCount - 1)),
    } : {}),
  })

  const attachReference = async (mediaRef: string, version: number): Promise<boolean> => {
    if (!normalizedAlt) {
      if (operationIsCurrent(version)) {
        setError('Describe the image for readers using assistive technology before uploading.')
      }
      return false
    }
    if (operationIsCurrent(version)) setPhase('attaching')
    try {
      await onSet(inputForReference(mediaRef))
      if (!operationIsCurrent(version)) return false
      setRetryReference(null)
      setError(null)
      if (!media) {
        setAltText('')
        setCaption('')
        setParagraphIndex(0)
      }
      return true
    } catch (operationError) {
      if (!operationIsCurrent(version)) return false
      setRetryReference(mediaRef)
      setError(operationError instanceof Error ? operationError.message : 'Image metadata could not be attached.')
      return false
    } finally {
      if (operationIsCurrent(version)) setPhase('idle')
    }
  }

  const upload = async (file: Blob) => {
    const validation = validateImageInput(file, 'general')
    if (validation) {
      setError(validation)
      return
    }
    const version = ++operationVersionRef.current
    setPhase('uploading')
    setError(null)
    try {
      const slot = placementKind === 'hero'
        ? 'hero'
        : `inline-${media?.id ?? crypto.randomUUID()}`
      const uploaded = await uploadSharedImage({
        subjectKind: config.storageSubjectKind,
        subjectId: articleId,
        mediaKind: 'general',
        slot,
      }, file, 'general')
      if (!operationIsCurrent(version)) return
      const attached = await attachReference(uploaded.reference, version)
      if (attached && operationIsCurrent(version)) {
        onNotice(`${config.noticePrefix} // OPTIMIZED IMAGE UPLOADED`)
      }
    } catch (uploadError) {
      if (operationIsCurrent(version)) {
        setError(uploadError instanceof Error ? uploadError.message : 'Image upload failed.')
      }
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (operationIsCurrent(version)) setPhase('idle')
    }
  }

  const selectFile = (file: File | undefined) => {
    if (!file) return
    const validation = validateImageInput(file, 'general')
    if (validation) {
      setError(validation)
      return
    }
    if (placementKind === 'hero') {
      clearCropSource()
      const source = URL.createObjectURL(file)
      cropSourceRef.current = source
      setCropSource(source)
      setPhase('cropping')
      return
    }
    void upload(file)
  }

  const saveMetadata = async () => {
    if (!media || !canSave) return
    const version = ++operationVersionRef.current
    setPhase('attaching')
    setError(null)
    try {
      await onSet(inputForReference(media.mediaRef))
      if (operationIsCurrent(version)) setError(null)
    } catch (operationError) {
      if (operationIsCurrent(version)) {
        setError(operationError instanceof Error ? operationError.message : 'Image metadata could not be saved.')
      }
    } finally {
      if (operationIsCurrent(version)) setPhase('idle')
    }
  }

  const retryAttachment = async () => {
    if (!retryReference || !canAct) return
    const version = ++operationVersionRef.current
    const attached = await attachReference(retryReference, version)
    if (attached && operationIsCurrent(version)) {
      onNotice(`${config.noticePrefix} // ARTICLE MEDIA ATTACHED`)
    }
  }

  const actionLabel = phase === 'uploading'
    ? 'Optimizing image'
    : phase === 'attaching'
      ? 'Attaching image'
      : media
        ? 'Replace image'
        : 'Choose image'

  return (
    <section className={className('newsroom-media-row')} data-placement={placementKind}>
      <header>
        <div>
          <strong>{media ? (placementKind === 'hero' ? 'Hero image' : `Inline image ${media.sortOrder + 1}`) : `Add ${placementKind} image`}</strong>
          <span>{placementKind === 'hero' ? '16:9 lead treatment' : 'Placed after an article paragraph'}</span>
        </div>
        {media ? (
          <button type="button" className={className('newsroom-media-remove')} onClick={() => onRequestRemove(media)} disabled={busy || phase !== 'idle'}>
            <Trash2 size={13} aria-hidden="true" /> Remove
          </button>
        ) : null}
      </header>

      {media ? (
        <div className={className('newsroom-media-thumb')}>
          <NewsArticleMediaFigure media={media} theme={config.articleMediaTheme} copy={config.articleMediaCopy} />
        </div>
      ) : null}

      <label>
        <span>Alternative text</span>
        <input
          value={altText}
          maxLength={config.altTextMaxLength}
          onChange={(event) => setAltText(event.target.value)}
          placeholder="Describe the visible content and relevant context"
        />
      </label>
      <label>
        <span>Caption <small>optional</small></span>
        <textarea rows={2} value={caption} maxLength={config.captionMaxLength} onChange={(event) => setCaption(event.target.value)} />
      </label>

      {placementKind === 'inline' ? (
        <label>
          <span>Insert after paragraph</span>
          <select value={Math.min(paragraphIndex, Math.max(0, paragraphCount - 1))} onChange={(event) => setParagraphIndex(Number(event.target.value))}>
            {Array.from({ length: Math.max(1, paragraphCount) }, (_, index) => (
              <option key={index} value={index}>Paragraph {index + 1}</option>
            ))}
          </select>
        </label>
      ) : null}

      {error ? <p className={className('newsroom-media-error')} role="alert">{error}</p> : null}
      {retryReference ? (
        <p className={className('newsroom-media-pending')} role="status">
          Upload completed, but attachment failed. The secure descriptor is retained for this retry.
          <button type="button" onClick={() => void retryAttachment()} disabled={!canAct}>
            <RefreshCcw size={13} aria-hidden="true" /> Retry attach
          </button>
        </p>
      ) : null}

      <footer>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
          className={className('newsroom-media-file')}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            selectFile(file)
          }}
        />
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={!canAct}>
          {actionPending ? <LoaderCircle className={config.spinnerClassName} size={14} aria-hidden="true" /> : media ? <Upload size={14} aria-hidden="true" /> : <ImagePlus size={14} aria-hidden="true" />}
          {actionLabel}
        </button>
        {media ? (
          <button type="button" onClick={() => void saveMetadata()} disabled={!canSave}>
            <Save size={14} aria-hidden="true" /> Save details
          </button>
        ) : null}
      </footer>

      {cropSource ? (
        <ImageCropDialog
          source={cropSource}
          title={config.heroCropTitle}
          description={config.heroCropDescription}
          aspectRatio={16 / 9}
          outputWidth={1600}
          outputHeight={900}
          accentColor={config.accentColor}
          onCancel={() => {
            operationVersionRef.current += 1
            clearCropSource()
            setPhase('idle')
          }}
          onConfirm={async (blob) => {
            await upload(blob)
            if (mountedRef.current && cropSourceRef.current === cropSource) {
              clearCropSource()
              setPhase('idle')
            }
          }}
        />
      ) : null}
    </section>
  )
}

export function NewsroomMediaEditor<TMedia extends NewsArticleMedia>({
  config,
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
  readonly config: NewsroomMediaEditorConfig
  readonly articleId?: string
  readonly body: string
  readonly media: readonly TMedia[]
  readonly busy: boolean
  readonly missingDraftFields: readonly string[]
  readonly draftValidationIssue?: string
  readonly canSaveDraft: boolean
  readonly onSaveDraft: () => Promise<boolean>
  readonly onSet: (input: NewsroomArticleMediaInput) => Promise<void>
  readonly onRequestRemove: (media: TMedia) => void
  readonly onNotice: (message: string) => void
}) {
  const [isSavingDraft, setIsSavingDraft] = useState(false)
  const paragraphCount = useMemo(() => splitNewsArticleParagraphs(body).length, [body])
  const hero = media.find((item) => item.placementKind === 'hero')
  const inline = media.filter((item) => item.placementKind === 'inline')
    .sort((left, right) => left.sortOrder - right.sortOrder)
  const className = (name: string) => `${config.newsroomClassPrefix}-${name}`

  if (!articleId) {
    return (
      <section className={`${className('newsroom-media')} ${className('newsroom-media--locked')}`}>
        <ImagePlus size={18} aria-hidden="true" />
        <div>
          <h3>Article media</h3>
          <p>Save the article as a Draft before adding images.</p>
          {missingDraftFields.length > 0 ? (
            <div className={className('newsroom-media__requirements')}>
              <strong>Complete these fields first:</strong>
              <ul>{missingDraftFields.map((field) => <li key={field}>{field}</li>)}</ul>
            </div>
          ) : draftValidationIssue ? (
            <p className={className('newsroom-media-error')} role="alert">{draftValidationIssue}</p>
          ) : (
            <button
              type="button"
              disabled={!canSaveDraft || busy || isSavingDraft}
              onClick={() => {
                setIsSavingDraft(true)
                void onSaveDraft().finally(() => setIsSavingDraft(false))
              }}
            >
              {isSavingDraft ? <LoaderCircle className={config.spinnerClassName} size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
              Save draft &amp; add media
            </button>
          )}
        </div>
      </section>
    )
  }

  return (
    <section className={className('newsroom-media')}>
      <header className={className('newsroom-media__header')}>
        <div>
          <h3>Article media</h3>
          <p>One hero and up to {config.maxInline} inline images. Images are optimized before private upload.</p>
        </div>
        <span>{media.length}/{config.maxTotal}</span>
      </header>

      <MediaRow
        key={`${articleId}:${hero?.id ?? 'new-hero'}`}
        config={config}
        articleId={articleId}
        placementKind="hero"
        paragraphCount={paragraphCount}
        media={hero}
        busy={busy}
        onSet={onSet}
        onRequestRemove={onRequestRemove}
        onNotice={onNotice}
      />

      <div className={className('newsroom-media__inline-list')}>
        {inline.map((item) => (
          <MediaRow
            key={`${articleId}:${item.id}`}
            config={config}
            articleId={articleId}
            placementKind="inline"
            paragraphCount={paragraphCount}
            media={item}
            busy={busy}
            onSet={onSet}
            onRequestRemove={onRequestRemove}
            onNotice={onNotice}
          />
        ))}
        {inline.length < config.maxInline ? (
          <MediaRow
            key={`${articleId}:new-inline`}
            config={config}
            articleId={articleId}
            placementKind="inline"
            paragraphCount={paragraphCount}
            busy={busy}
            onSet={onSet}
            onRequestRemove={onRequestRemove}
            onNotice={onNotice}
          />
        ) : null}
      </div>
    </section>
  )
}
