import {
  Archive,
  Eye,
  EyeOff,
  FilePlus2,
  LoaderCircle,
  RefreshCcw,
  RotateCcw,
  Save,
  ShieldCheck,
  X,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  NET_NVN_BODY_MAX_LENGTH,
  NET_NVN_BYLINE_NAME_MAX_LENGTH,
  NET_NVN_BYLINE_ROLE_MAX_LENGTH,
  NET_NVN_DISTRICT_LABEL_MAX_LENGTH,
  NET_NVN_HEADLINE_MAX_LENGTH,
  NET_NVN_LOCATION_LABEL_MAX_LENGTH,
  NET_NVN_PULL_QUOTE_ATTRIBUTION_MAX_LENGTH,
  NET_NVN_PULL_QUOTE_MAX_LENGTH,
  NET_NVN_REFERENCE_APP_MAX_LENGTH,
  NET_NVN_REFERENCE_ID_MAX_LENGTH,
  NET_NVN_REFERENCE_KIND_MAX_LENGTH,
  NET_NVN_SHORT_HEADLINE_MAX_LENGTH,
  NET_NVN_SLUG_MAX_LENGTH,
  NET_NVN_SOURCE_LABEL_MAX_ITEMS,
  NET_NVN_SOURCE_LABEL_MAX_LENGTH,
  NET_NVN_SUMMARY_MAX_LENGTH,
  NET_NVN_TAG_MAX_ITEMS,
  NET_NVN_TAG_MAX_LENGTH,
  isNetNvnGmRequestError,
  netNvnBylineKinds,
  netNvnCategories,
  netNvnPriorities,
  netNvnSourceStatuses,
  netNvnStoryKinds,
  type NetNvnArticleStatus,
  type NetNvnArticleMedia,
  type NetNvnGmArticleDetail,
  type NetNvnGmArticleInput,
  type NetNvnGmArticleMediaInput,
  type NetNvnGmLifecycleAction,
} from '../../lib/netNvnTypes'
import { useNetDialog } from './netDialogStack'
import {
  NVN_BYLINE_KIND_LABELS,
  NVN_CATEGORY_LABELS,
  NVN_SOURCE_STATUS_LABELS,
  NVN_STORY_KIND_LABELS,
  formatNvnDateTime,
} from './nvnPresentation'
import { useNetNvnGmControl } from './useNetNvnGmControl'
import type { CompleteNetNvnLocalMutation } from './useNetNvnRealtime'
import { NvnArticleBody, NvnArticleHero } from './NvnArticleMedia'
import { NvnNewsroomMediaEditor } from './NvnNewsroomMediaEditor'

type DirectoryFilter = 'all' | NetNvnArticleStatus

interface NvnNewsroomControlProps {
  readonly enabled: boolean
  readonly realtimeInvalidationVersion: number
  readonly beginLocalMutation: () => CompleteNetNvnLocalMutation
  readonly onDirtyChange: (dirty: boolean) => void
  readonly onPublicContentChanged: () => void
  readonly onNotice: (message: string) => void
}

interface NewsroomDraft {
  slug: string
  storyKind: NetNvnGmArticleInput['storyKind']
  priority: NetNvnGmArticleInput['priority']
  category: NetNvnGmArticleInput['category']
  headline: string
  shortHeadline: string
  summary: string
  body: string
  bylineName: string
  bylineRole: string
  bylineKind: NetNvnGmArticleInput['bylineKind']
  sourceStatus: NetNvnGmArticleInput['sourceStatus']
  tags: string
  sourceLabels: string
  districtLabel: string
  locationLabel: string
  occurredAt: string
  pullQuote: string
  pullQuoteAttribution: string
  referenceAppId: string
  referenceResourceKind: string
  referenceResourceId: string
}

interface ConfirmationState {
  readonly title: string
  readonly body: string
  readonly confirmLabel: string
  readonly tone?: 'standard' | 'danger'
  readonly action: () => void | Promise<void>
}

const EMPTY_DRAFT: NewsroomDraft = {
  slug: '',
  storyKind: 'report',
  priority: 'standard',
  category: 'new-vega',
  headline: '',
  shortHeadline: '',
  summary: '',
  body: '',
  bylineName: '',
  bylineRole: '',
  bylineKind: 'reporter',
  sourceStatus: 'developing',
  tags: '',
  sourceLabels: '',
  districtLabel: '',
  locationLabel: '',
  occurredAt: '',
  pullQuote: '',
  pullQuoteAttribution: '',
  referenceAppId: '',
  referenceResourceKind: '',
  referenceResourceId: '',
}

const FILTER_LABELS: Record<DirectoryFilter, string> = {
  all: 'All',
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
}

function toDateTimeLocal(value: string | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function draftFromDetail(detail: NetNvnGmArticleDetail): NewsroomDraft {
  return {
    slug: detail.slug,
    storyKind: detail.storyKind,
    priority: detail.priority,
    category: detail.category,
    headline: detail.headline,
    shortHeadline: detail.shortHeadline ?? '',
    summary: detail.summary ?? '',
    body: detail.body,
    bylineName: detail.bylineName,
    bylineRole: detail.bylineRole ?? '',
    bylineKind: detail.bylineKind,
    sourceStatus: detail.sourceStatus,
    tags: detail.tags.join(', '),
    sourceLabels: detail.sourceLabels.join('\n'),
    districtLabel: detail.districtLabel ?? '',
    locationLabel: detail.locationLabel ?? '',
    occurredAt: toDateTimeLocal(detail.occurredAt),
    pullQuote: detail.pullQuote ?? '',
    pullQuoteAttribution: detail.pullQuoteAttribution ?? '',
    referenceAppId: detail.primaryReference?.appId ?? '',
    referenceResourceKind: detail.primaryReference?.resourceKind ?? '',
    referenceResourceId: detail.primaryReference?.resourceId ?? '',
  }
}

function serializeDraft(draft: NewsroomDraft): string {
  return JSON.stringify(draft)
}

function slugFromHeadline(headline: string): string {
  return headline
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, NET_NVN_SLUG_MAX_LENGTH)
    .replace(/-+$/g, '')
}

function optional(value: string): string | undefined {
  const normalized = value.trim()
  return normalized || undefined
}

function normalizedList(
  value: string,
  separator: RegExp,
  maximumItems: number,
  maximumLength: number,
  label: string,
): readonly string[] {
  const unique = new Map<string, string>()
  for (const item of value.split(separator)) {
    const normalized = item.trim()
    if (!normalized) continue
    if (normalized.length > maximumLength) {
      throw new Error(`${label} entries cannot exceed ${maximumLength} characters.`)
    }
    const key = normalized.toLocaleLowerCase()
    if (!unique.has(key)) unique.set(key, normalized)
  }
  if (unique.size > maximumItems) {
    throw new Error(`${label} supports at most ${maximumItems} entries.`)
  }
  return [...unique.values()]
}

function inputFromDraft(draft: NewsroomDraft): NetNvnGmArticleInput {
  const slug = draft.slug.trim().toLowerCase()
  const headline = draft.headline.trim()
  const body = draft.body.trim()
  const bylineName = draft.bylineName.trim()
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error('Slug must use lowercase letters, numbers, and single hyphens.')
  }
  if (!headline) throw new Error('Headline is required.')
  if (!body) throw new Error('Article body is required.')
  if (!bylineName) throw new Error('Byline name is required.')

  const tags = normalizedList(
    draft.tags,
    /[,\n]/,
    NET_NVN_TAG_MAX_ITEMS,
    NET_NVN_TAG_MAX_LENGTH,
    'Tags',
  )
  const sourceLabels = normalizedList(
    draft.sourceLabels,
    /\n/,
    NET_NVN_SOURCE_LABEL_MAX_ITEMS,
    NET_NVN_SOURCE_LABEL_MAX_LENGTH,
    'Source labels',
  )
  const pullQuote = optional(draft.pullQuote)
  const pullQuoteAttribution = optional(draft.pullQuoteAttribution)
  if (Boolean(pullQuote) !== Boolean(pullQuoteAttribution)) {
    throw new Error('Pull quote and attribution must be supplied together.')
  }
  const reference = [
    optional(draft.referenceAppId),
    optional(draft.referenceResourceKind),
    optional(draft.referenceResourceId),
  ] as const
  if (reference.some(Boolean) && !reference.every(Boolean)) {
    throw new Error('Cross-app reference requires application, resource kind, and resource ID.')
  }
  const occurredAt = draft.occurredAt
    ? new Date(draft.occurredAt).toISOString()
    : undefined

  return {
    slug,
    storyKind: draft.storyKind,
    priority: draft.priority,
    category: draft.category,
    headline,
    ...(optional(draft.shortHeadline) ? { shortHeadline: optional(draft.shortHeadline) } : {}),
    ...(optional(draft.summary) ? { summary: optional(draft.summary) } : {}),
    body,
    bylineName,
    ...(optional(draft.bylineRole) ? { bylineRole: optional(draft.bylineRole) } : {}),
    bylineKind: draft.bylineKind,
    sourceStatus: draft.sourceStatus,
    tags,
    sourceLabels,
    ...(optional(draft.districtLabel) ? { districtLabel: optional(draft.districtLabel) } : {}),
    ...(optional(draft.locationLabel) ? { locationLabel: optional(draft.locationLabel) } : {}),
    ...(occurredAt ? { occurredAt } : {}),
    ...(pullQuote && pullQuoteAttribution ? { pullQuote, pullQuoteAttribution } : {}),
    ...(reference.every(Boolean) ? {
      primaryReference: {
        appId: reference[0]!,
        resourceKind: reference[1]!,
        resourceId: reference[2]!,
      },
    } : {}),
  }
}

interface NewsroomDraftReadiness {
  readonly missingFields: readonly string[]
  readonly validationIssue?: string
  readonly canSave: boolean
}

function newsroomDraftReadiness(draft: NewsroomDraft): NewsroomDraftReadiness {
  const missingFields = [
    !draft.headline.trim() ? 'Headline' : null,
    !draft.slug.trim() ? 'Slug' : null,
    !draft.body.trim() ? 'Body' : null,
    !draft.bylineName.trim() ? 'Byline name' : null,
  ].filter((value): value is string => Boolean(value))
  const slug = draft.slug.trim().toLowerCase()
  const validationIssue = slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    ? 'Slug must use lowercase letters, numbers, and single hyphens.'
    : undefined
  return {
    missingFields,
    ...(validationIssue ? { validationIssue } : {}),
    canSave: missingFields.length === 0 && !validationIssue,
  }
}

function friendlyError(error: unknown): string {
  if (isNetNvnGmRequestError(error)) return error.message
  if (error instanceof Error) return error.message
  return 'The newsroom could not confirm that editorial operation.'
}

function Field({ label, hint, wide = false, children }: {
  readonly label: string
  readonly hint?: string
  readonly wide?: boolean
  readonly children: ReactNode
}) {
  return (
    <label className="nvn-newsroom-field" data-wide={wide ? 'true' : undefined}>
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  )
}

export function NvnNewsroomConfirmation({
  title,
  body,
  confirmLabel,
  tone = 'standard',
  onConfirm,
  onCancel,
}: {
  readonly title: string
  readonly body: string
  readonly confirmLabel: string
  readonly tone?: 'standard' | 'danger'
  readonly onConfirm: () => void
  readonly onCancel: () => void
}) {
  const { dialogRef, onFocusCapture } = useNetDialog<HTMLDivElement>(onCancel)
  return (
    <div className="nvn-newsroom-dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel()
    }}>
      <div
        ref={dialogRef}
        className="nvn-newsroom-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="nvn-newsroom-confirm-title"
        tabIndex={-1}
        onFocusCapture={onFocusCapture}
      >
        <header>
          <ShieldCheck size={17} aria-hidden="true" />
          <strong id="nvn-newsroom-confirm-title">{title}</strong>
          <button type="button" aria-label="Close confirmation" onClick={onCancel}>
            <X size={15} aria-hidden="true" />
          </button>
        </header>
        <p>{body}</p>
        <footer>
          <button type="button" data-net-dialog-initial-focus onClick={onCancel}>Cancel</button>
          <button type="button" data-tone={tone} onClick={onConfirm}>{confirmLabel}</button>
        </footer>
      </div>
    </div>
  )
}

export function NvnNewsroomControl({
  enabled,
  realtimeInvalidationVersion,
  beginLocalMutation,
  onDirtyChange,
  onPublicContentChanged,
  onNotice,
}: NvnNewsroomControlProps) {
  const control = useNetNvnGmControl(enabled)
  const [directoryFilter, setDirectoryFilter] = useState<DirectoryFilter>('all')
  const [isNew, setIsNew] = useState(false)
  const [draft, setDraft] = useState<NewsroomDraft>(EMPTY_DRAFT)
  const [baseline, setBaseline] = useState(serializeDraft(EMPTY_DRAFT))
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null)
  const dirtyRef = useRef(false)
  const realtimeInvalidationVersionRef = useRef(realtimeInvalidationVersion)
  const reconciledDirectoryVersionRef = useRef(0)
  const reconciledDetailVersionRef = useRef(0)

  const dirty = (isNew || Boolean(control.selectedArticleId))
    && serializeDraft(draft) !== baseline

  useEffect(() => {
    dirtyRef.current = dirty
    realtimeInvalidationVersionRef.current = realtimeInvalidationVersion
  }, [dirty, realtimeInvalidationVersion])

  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    if (!enabled || realtimeInvalidationVersion <= 0) return
    const expectedVersion = realtimeInvalidationVersion

    if (expectedVersion > reconciledDirectoryVersionRef.current) {
      reconciledDirectoryVersionRef.current = expectedVersion
      void control.loadDirectory(true)
    }

    if (isNew || !control.selectedArticleId) {
      reconciledDetailVersionRef.current = expectedVersion
      return
    }
    if (dirty || expectedVersion <= reconciledDetailVersionRef.current) return

    reconciledDetailVersionRef.current = expectedVersion
    void control.refreshSelectedArticle().then((loaded) => {
      if (
        !loaded
        || dirtyRef.current
        || realtimeInvalidationVersionRef.current !== expectedVersion
      ) return
      const next = draftFromDetail(loaded)
      setDraft(next)
      setBaseline(serializeDraft(next))
      setFormError(null)
    })
  }, [
    control,
    dirty,
    enabled,
    isNew,
    realtimeInvalidationVersion,
  ])

  const filteredDirectory = useMemo(
    () => control.directory.filter((article) =>
      directoryFilter === 'all' || article.status === directoryFilter),
    [control.directory, directoryFilter],
  )
  const draftReadiness = useMemo(() => newsroomDraftReadiness(draft), [draft])

  const updateDraft = <Key extends keyof NewsroomDraft>(key: Key, value: NewsroomDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const startNew = () => {
    const apply = () => {
      control.clearSelection()
      setIsNew(true)
      setDraft({ ...EMPTY_DRAFT })
      setBaseline(serializeDraft(EMPTY_DRAFT))
      setFormError(null)
      setConfirmation(null)
      reconciledDetailVersionRef.current = realtimeInvalidationVersion
    }
    if (!dirty) return apply()
    setConfirmation({
      title: 'Discard unsaved article edits?',
      body: 'The current local changes have not been written to the authoritative newsroom record.',
      confirmLabel: 'Discard changes',
      tone: 'danger',
      action: apply,
    })
  }

  const selectArticle = (articleId: string) => {
    const apply = async () => {
      setIsNew(false)
      setFormError(null)
      setConfirmation(null)
      const loaded = await control.selectArticle(articleId)
      if (loaded) {
        const next = draftFromDetail(loaded)
        reconciledDetailVersionRef.current = realtimeInvalidationVersion
        setDraft(next)
        setBaseline(serializeDraft(next))
      }
    }
    if (!dirty) {
      void apply()
      return
    }
    setConfirmation({
      title: 'Leave unsaved article?',
      body: 'Switching records will discard the current local edits.',
      confirmLabel: 'Switch article',
      tone: 'danger',
      action: apply,
    })
  }

  const saveArticle = async (): Promise<boolean> => {
    setFormError(null)
    const completeLocalMutation = beginLocalMutation()
    try {
      const input = inputFromDraft(draft)
      const creatingArticle = isNew
      const previousStatus = control.detail?.status
      const previousUpdatedAt = control.detail?.updatedAt
      const saved = isNew
        ? await control.createArticle(input)
        : await control.updateArticle(control.selectedArticleId!, input)
      const changed = creatingArticle || saved.updatedAt !== previousUpdatedAt
      completeLocalMutation(changed)
      const next = draftFromDetail(saved)
      reconciledDetailVersionRef.current = realtimeInvalidationVersion
      setIsNew(false)
      setDraft(next)
      setBaseline(serializeDraft(next))
      if (changed && (previousStatus === 'published' || previousStatus === 'archived')) {
        onPublicContentChanged()
      }
      onNotice(creatingArticle ? 'NVN // DRAFT CREATED' : 'NVN // ARTICLE SAVED')
      return true
    } catch (error) {
      completeLocalMutation(false)
      setFormError(friendlyError(error))
      return false
    }
  }

  const lifecycleCopy = (action: NetNvnGmLifecycleAction) => {
    const copies: Record<NetNvnGmLifecycleAction, Omit<ConfirmationState, 'action'>> = {
      publish: {
        title: 'Publish article?',
        body: 'This report will become visible on the authenticated public NVN grid.',
        confirmLabel: 'Publish article',
      },
      hide: {
        title: 'Hide article?',
        body: 'This report will return to draft and disappear from all player readers.',
        confirmLabel: 'Return to draft',
        tone: 'danger',
      },
      archive: {
        title: 'Archive article?',
        body: 'This report will leave current-news feeds and remain available in the public Archive.',
        confirmLabel: 'Archive article',
      },
      restore: {
        title: 'Restore article?',
        body: 'This archived report will return to published news without changing its original publication time.',
        confirmLabel: 'Restore article',
      },
    }
    return copies[action]
  }

  const requestLifecycle = (action: NetNvnGmLifecycleAction) => {
    if (!control.selectedArticleId || isNew) return
    if (dirty) {
      setFormError('Save or discard local edits before changing article visibility.')
      return
    }
    const copy = lifecycleCopy(action)
    setConfirmation({
      ...copy,
      action: async () => {
        setConfirmation(null)
        setFormError(null)
        const completeLocalMutation = beginLocalMutation()
        try {
          const saved = await control.setLifecycle(control.selectedArticleId!, action)
          completeLocalMutation(true)
          const next = draftFromDetail(saved)
          reconciledDetailVersionRef.current = realtimeInvalidationVersion
          setDraft(next)
          setBaseline(serializeDraft(next))
          onPublicContentChanged()
          onNotice(`NVN // ARTICLE ${action.toUpperCase()} CONFIRMED`)
        } catch (error) {
          completeLocalMutation(false)
          setFormError(friendlyError(error))
        }
      },
    })
  }

  const suggestSlug = () => {
    const slug = slugFromHeadline(draft.headline)
    if (slug) updateDraft('slug', slug)
  }

  const setArticleMedia = async (input: NetNvnGmArticleMediaInput) => {
    if (!control.selectedArticleId || isNew) throw new Error('Save the Draft before adding media.')
    const articleId = control.selectedArticleId
    const before = JSON.stringify(control.detail?.media ?? [])
    const completeLocalMutation = beginLocalMutation()
    try {
      const saved = await control.setMedia(articleId, input)
      const changed = JSON.stringify(saved.media) !== before
      completeLocalMutation(changed)
      if (changed && (saved.status === 'published' || saved.status === 'archived')) {
        onPublicContentChanged()
      }
      onNotice('NVN // ARTICLE MEDIA SAVED')
    } catch (error) {
      completeLocalMutation(false)
      throw new Error(friendlyError(error))
    }
  }

  const requestRemoveMedia = (media: NetNvnArticleMedia) => {
    if (!control.selectedArticleId || isNew) return
    const articleId = control.selectedArticleId
    setConfirmation({
      title: 'Remove article image?',
      body: 'The image will stop appearing in this article. The immutable Storage object is not deleted automatically.',
      confirmLabel: 'Remove image',
      tone: 'danger',
      action: async () => {
        setConfirmation(null)
        const completeLocalMutation = beginLocalMutation()
        try {
          const saved = await control.removeMedia(articleId, media.id)
          completeLocalMutation(true)
          if (saved.status === 'published' || saved.status === 'archived') onPublicContentChanged()
          onNotice('NVN // ARTICLE MEDIA REMOVED')
        } catch (error) {
          completeLocalMutation(false)
          setFormError(friendlyError(error))
        }
      },
    })
  }

  const currentStatus = isNew ? 'draft' : control.detail?.status
  const selectedDirectoryArticle = control.directory.find(
    (article) => article.id === control.selectedArticleId,
  )
  const serverChangedWhileDirty = Boolean(
    !isNew
    && control.selectedArticleId
    && dirty
    && selectedDirectoryArticle
    && control.detail
    && selectedDirectoryArticle.updatedAt !== control.detail.updatedAt,
  )
  const showEditor = isNew || Boolean(control.selectedArticleId)
  const previewTags = draft.tags
    .split(/[,\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, NET_NVN_TAG_MAX_ITEMS)

  return (
    <section className="nvn-newsroom-shell" aria-label="NVN Newsroom Control">
      <aside className="nvn-newsroom-directory">
        <header>
          <div>
            <ShieldCheck size={15} aria-hidden="true" />
            <strong>Newsroom Control</strong>
          </div>
          <button type="button" onClick={() => void control.loadDirectory(true)} aria-label="Refresh article directory">
            <RefreshCcw size={14} aria-hidden="true" />
          </button>
        </header>

        <button type="button" className="nvn-newsroom-new" onClick={startNew}>
          <FilePlus2 size={14} aria-hidden="true" /> New article
        </button>

        <div className="nvn-newsroom-filters" aria-label="Article lifecycle filter">
          {(Object.keys(FILTER_LABELS) as DirectoryFilter[]).map((filter) => (
            <button
              key={filter}
              type="button"
              data-active={directoryFilter === filter ? 'true' : undefined}
              onClick={() => setDirectoryFilter(filter)}
            >
              {FILTER_LABELS[filter]}
            </button>
          ))}
        </div>

        <div className="nvn-newsroom-directory__list" aria-busy={control.directoryPhase === 'loading'}>
          {control.directoryError && control.directory.length > 0 ? (
            <div className="nvn-newsroom-directory__warning" role="status">
              <span>{control.directoryError}</span>
              <button type="button" onClick={() => void control.loadDirectory(true)}>Retry</button>
            </div>
          ) : null}
          {control.directoryPhase === 'loading' ? (
            <div className="nvn-newsroom-directory__state">
              <LoaderCircle className="nvn-reader-feedback__spinner" size={17} aria-hidden="true" />
              <span>Syncing article index</span>
            </div>
          ) : control.directoryError && control.directory.length === 0 ? (
            <div className="nvn-newsroom-directory__state" data-error="true">
              <span>{control.directoryError}</span>
              <button type="button" onClick={() => void control.loadDirectory()}>Retry</button>
            </div>
          ) : filteredDirectory.length === 0 ? (
            <div className="nvn-newsroom-directory__state">
              <span>{control.directory.length === 0 ? 'No articles. Create the first newsroom draft.' : `No ${FILTER_LABELS[directoryFilter].toLowerCase()} articles.`}</span>
            </div>
          ) : (
            filteredDirectory.map((article) => (
              <button
                key={article.id}
                type="button"
                className="nvn-newsroom-directory__row"
                data-active={!isNew && control.selectedArticleId === article.id ? 'true' : undefined}
                onClick={() => selectArticle(article.id)}
              >
                <span>
                  <strong>{article.headline}</strong>
                  <small>{article.slug}</small>
                </span>
                <em data-status={article.status}>{article.status}</em>
              </button>
            ))
          )}
        </div>
      </aside>

      <main className="nvn-newsroom-editor">
        {!showEditor ? (
          <div className="nvn-newsroom-welcome">
            <ShieldCheck size={22} aria-hidden="true" />
            <h2>No article selected</h2>
            <p>Select an editorial record or create the first approved NVN story.</p>
            <button type="button" onClick={startNew}><FilePlus2 size={14} aria-hidden="true" /> New article</button>
          </div>
        ) : control.detailPhase === 'loading' && !isNew ? (
          <div className="nvn-newsroom-welcome" role="status">
            <LoaderCircle className="nvn-reader-feedback__spinner" size={22} aria-hidden="true" />
            <h2>Opening editorial record</h2>
            <p>Retrieving the exact authoritative article payload.</p>
          </div>
        ) : control.detailPhase === 'failed' && !isNew ? (
          <div className="nvn-newsroom-welcome" role="alert">
            <h2>Article unavailable</h2>
            <p>{control.detailError}</p>
            <button type="button" onClick={() => control.selectedArticleId && selectArticle(control.selectedArticleId)}>
              <RefreshCcw size={14} aria-hidden="true" /> Retry
            </button>
          </div>
        ) : (
          <form className="nvn-newsroom-form" onSubmit={(event) => {
            event.preventDefault()
            void saveArticle()
          }}>
            <header className="nvn-newsroom-form__header">
              <div>
                <h2>{isNew ? 'New article' : draft.headline || 'Untitled article'}</h2>
                <span data-dirty={dirty ? 'true' : undefined}>
                  {dirty ? 'Unsaved changes' : currentStatus ?? 'Draft'}
                </span>
              </div>
              <button
                type="submit"
                disabled={control.isMutating || (!isNew && !dirty) || (isNew && !draftReadiness.canSave)}
                aria-describedby={isNew && !draftReadiness.canSave ? 'nvn-draft-requirements' : undefined}
              >
                {control.isMutating ? <LoaderCircle className="nvn-reader-feedback__spinner" size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
                {isNew ? 'Save draft' : 'Save changes'}
              </button>
            </header>

            {isNew && !draftReadiness.canSave ? (
              <div className="nvn-newsroom-draft-requirements" id="nvn-draft-requirements" role="status">
                <strong>Draft not ready</strong>
                {draftReadiness.missingFields.length > 0 ? (
                  <span>Complete: {draftReadiness.missingFields.join(', ')}.</span>
                ) : null}
                {draftReadiness.validationIssue ? <span>{draftReadiness.validationIssue}</span> : null}
              </div>
            ) : null}
            {formError ? <p className="nvn-newsroom-error" role="alert">{formError}</p> : null}
            {serverChangedWhileDirty ? (
              <p className="nvn-live__notice nvn-newsroom-stale" role="status">
                <RefreshCcw size={14} aria-hidden="true" />
                Another newsroom session changed this server record. Your unsaved local edits were preserved.
              </p>
            ) : null}
            {control.detailError && control.detailPhase === 'ready' ? (
              <p className="nvn-live__notice nvn-newsroom-stale" role="status">
                <RefreshCcw size={14} aria-hidden="true" />
                {control.detailError}
              </p>
            ) : null}

            <div className="nvn-newsroom-form__fields">
              <Field label="Headline" wide>
                <input required maxLength={NET_NVN_HEADLINE_MAX_LENGTH} value={draft.headline} onChange={(event) => updateDraft('headline', event.target.value)} />
              </Field>
              <Field label="Slug" hint="Public navigation label. UUID remains authority.">
                <span className="nvn-newsroom-slug-control">
                  <input required maxLength={NET_NVN_SLUG_MAX_LENGTH} value={draft.slug} onChange={(event) => updateDraft('slug', event.target.value.toLowerCase())} />
                  <button type="button" onClick={suggestSlug}>Suggest</button>
                </span>
              </Field>
              <Field label="Short headline">
                <input maxLength={NET_NVN_SHORT_HEADLINE_MAX_LENGTH} value={draft.shortHeadline} onChange={(event) => updateDraft('shortHeadline', event.target.value)} />
              </Field>
              <Field label="Summary" wide>
                <textarea rows={3} maxLength={NET_NVN_SUMMARY_MAX_LENGTH} value={draft.summary} onChange={(event) => updateDraft('summary', event.target.value)} />
              </Field>
              <Field label="Body" hint={`${draft.body.length}/${NET_NVN_BODY_MAX_LENGTH} characters`} wide>
                <textarea required className="nvn-newsroom-body-input" rows={12} maxLength={NET_NVN_BODY_MAX_LENGTH} value={draft.body} onChange={(event) => updateDraft('body', event.target.value)} />
              </Field>

              <Field label="Story kind">
                <select value={draft.storyKind} onChange={(event) => updateDraft('storyKind', event.target.value as NewsroomDraft['storyKind'])}>
                  {netNvnStoryKinds.map((kind) => <option key={kind} value={kind}>{NVN_STORY_KIND_LABELS[kind]}</option>)}
                </select>
              </Field>
              <Field label="Priority">
                <select value={draft.priority} onChange={(event) => updateDraft('priority', event.target.value as NewsroomDraft['priority'])}>
                  {netNvnPriorities.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                </select>
              </Field>
              <Field label="Category">
                <select value={draft.category} onChange={(event) => updateDraft('category', event.target.value as NewsroomDraft['category'])}>
                  {netNvnCategories.map((category) => <option key={category} value={category}>{NVN_CATEGORY_LABELS[category]}</option>)}
                </select>
              </Field>
              <Field label="Source status">
                <select value={draft.sourceStatus} onChange={(event) => updateDraft('sourceStatus', event.target.value as NewsroomDraft['sourceStatus'])}>
                  {netNvnSourceStatuses.map((status) => <option key={status} value={status}>{NVN_SOURCE_STATUS_LABELS[status]}</option>)}
                </select>
              </Field>

              <Field label="Byline name">
                <input required maxLength={NET_NVN_BYLINE_NAME_MAX_LENGTH} value={draft.bylineName} onChange={(event) => updateDraft('bylineName', event.target.value)} />
              </Field>
              <Field label="Byline role">
                <input maxLength={NET_NVN_BYLINE_ROLE_MAX_LENGTH} value={draft.bylineRole} onChange={(event) => updateDraft('bylineRole', event.target.value)} />
              </Field>
              <Field label="Byline kind">
                <select value={draft.bylineKind} onChange={(event) => updateDraft('bylineKind', event.target.value as NewsroomDraft['bylineKind'])}>
                  {netNvnBylineKinds.map((kind) => <option key={kind} value={kind}>{NVN_BYLINE_KIND_LABELS[kind]}</option>)}
                </select>
              </Field>
              <Field label="Occurred at">
                <input type="datetime-local" value={draft.occurredAt} onChange={(event) => updateDraft('occurredAt', event.target.value)} />
              </Field>

              <Field label="Tags" hint={`Comma-separated, up to ${NET_NVN_TAG_MAX_ITEMS}.`} wide>
                <input maxLength={(NET_NVN_TAG_MAX_LENGTH + 2) * NET_NVN_TAG_MAX_ITEMS} value={draft.tags} onChange={(event) => updateDraft('tags', event.target.value)} placeholder="public-grid, city-hall" />
              </Field>
              <Field label="Source labels" hint={`One per line, up to ${NET_NVN_SOURCE_LABEL_MAX_ITEMS}.`} wide>
                <textarea rows={3} maxLength={(NET_NVN_SOURCE_LABEL_MAX_LENGTH + 1) * NET_NVN_SOURCE_LABEL_MAX_ITEMS} value={draft.sourceLabels} onChange={(event) => updateDraft('sourceLabels', event.target.value)} />
              </Field>
              <Field label="District">
                <input maxLength={NET_NVN_DISTRICT_LABEL_MAX_LENGTH} value={draft.districtLabel} onChange={(event) => updateDraft('districtLabel', event.target.value)} />
              </Field>
              <Field label="Location">
                <input maxLength={NET_NVN_LOCATION_LABEL_MAX_LENGTH} value={draft.locationLabel} onChange={(event) => updateDraft('locationLabel', event.target.value)} />
              </Field>

              <Field label="Pull quote" wide>
                <textarea rows={3} maxLength={NET_NVN_PULL_QUOTE_MAX_LENGTH} value={draft.pullQuote} onChange={(event) => updateDraft('pullQuote', event.target.value)} />
              </Field>
              <Field label="Pull quote attribution" wide>
                <input maxLength={NET_NVN_PULL_QUOTE_ATTRIBUTION_MAX_LENGTH} value={draft.pullQuoteAttribution} onChange={(event) => updateDraft('pullQuoteAttribution', event.target.value)} />
              </Field>

              <fieldset className="nvn-newsroom-reference">
                <legend>Optional cross-app reference</legend>
                <Field label="Application">
                  <input maxLength={NET_NVN_REFERENCE_APP_MAX_LENGTH} value={draft.referenceAppId} onChange={(event) => updateDraft('referenceAppId', event.target.value)} />
                </Field>
                <Field label="Resource kind">
                  <input maxLength={NET_NVN_REFERENCE_KIND_MAX_LENGTH} value={draft.referenceResourceKind} onChange={(event) => updateDraft('referenceResourceKind', event.target.value)} />
                </Field>
                <Field label="Resource ID">
                  <input maxLength={NET_NVN_REFERENCE_ID_MAX_LENGTH} value={draft.referenceResourceId} onChange={(event) => updateDraft('referenceResourceId', event.target.value)} />
                </Field>
              </fieldset>
            </div>

            <NvnNewsroomMediaEditor
              articleId={!isNew ? control.selectedArticleId ?? undefined : undefined}
              body={draft.body}
              media={control.detail?.media ?? []}
              busy={control.isMutating}
              missingDraftFields={draftReadiness.missingFields}
              draftValidationIssue={draftReadiness.validationIssue}
              canSaveDraft={draftReadiness.canSave}
              onSaveDraft={() => saveArticle()}
              onSet={setArticleMedia}
              onRequestRemove={requestRemoveMedia}
              onNotice={onNotice}
            />
          </form>
        )}
      </main>

      <aside className="nvn-newsroom-preview">
        <header>
          <Eye size={15} aria-hidden="true" />
          <strong>Player preview</strong>
          <span>{currentStatus ?? 'draft'}</span>
        </header>

        {showEditor ? (
          <>
            <article className="nvn-newsroom-preview__article">
              <div>
                <span>{NVN_CATEGORY_LABELS[draft.category]}</span>
                {draft.priority === 'breaking' ? <em>Breaking</em> : null}
                {draft.storyKind !== 'report' ? <span>{NVN_STORY_KIND_LABELS[draft.storyKind]}</span> : null}
              </div>
              <h2>{draft.headline || 'Untitled newsroom record'}</h2>
              {draft.summary ? <p className="nvn-newsroom-preview__summary">{draft.summary}</p> : null}
              <p className="nvn-newsroom-preview__byline">
                {draft.bylineName || 'Byline pending'}
                {` · ${draft.bylineRole || NVN_BYLINE_KIND_LABELS[draft.bylineKind]}`}
              </p>
              <p className="nvn-newsroom-preview__metadata">
                {NVN_SOURCE_STATUS_LABELS[draft.sourceStatus]}
                {draft.districtLabel || draft.locationLabel
                  ? ` · ${[draft.districtLabel, draft.locationLabel].filter(Boolean).join(' · ')}`
                  : ''}
              </p>
              <NvnArticleHero media={control.detail?.media ?? []} />
              <NvnArticleBody
                body={draft.body}
                media={control.detail?.media ?? []}
                emptyMessage="Article body will appear here."
              />
              {draft.pullQuote && draft.pullQuoteAttribution ? (
                <blockquote>
                  <p>{draft.pullQuote}</p>
                  <cite>{draft.pullQuoteAttribution}</cite>
                </blockquote>
              ) : null}
              {previewTags.length > 0 ? <p className="nvn-newsroom-preview__tags">{previewTags.map((tag) => `#${tag}`).join(' ')}</p> : null}
            </article>

            <section className="nvn-newsroom-lifecycle">
              <h3>Publication state</h3>
              {currentStatus === 'draft' && !isNew ? (
                <button type="button" onClick={() => requestLifecycle('publish')} disabled={control.isMutating}>
                  <Eye size={14} aria-hidden="true" /> Publish article
                </button>
              ) : null}
              {currentStatus === 'published' ? (
                <>
                  <button type="button" onClick={() => requestLifecycle('hide')} disabled={control.isMutating}>
                    <EyeOff size={14} aria-hidden="true" /> Return to draft
                  </button>
                  <button type="button" onClick={() => requestLifecycle('archive')} disabled={control.isMutating}>
                    <Archive size={14} aria-hidden="true" /> Archive article
                  </button>
                </>
              ) : null}
              {currentStatus === 'archived' ? (
                <button type="button" onClick={() => requestLifecycle('restore')} disabled={control.isMutating}>
                  <RotateCcw size={14} aria-hidden="true" /> Restore article
                </button>
              ) : null}
              {isNew ? <p>Save this record as a draft before publication controls become available.</p> : null}
              {control.detail ? (
                <dl>
                  <div><dt>Updated</dt><dd>{formatNvnDateTime(control.detail.updatedAt)}</dd></div>
                  {control.detail.publishedAt ? <div><dt>Published</dt><dd>{formatNvnDateTime(control.detail.publishedAt)}</dd></div> : null}
                  {control.detail.archivedAt ? <div><dt>Archived</dt><dd>{formatNvnDateTime(control.detail.archivedAt)}</dd></div> : null}
                </dl>
              ) : null}
            </section>
          </>
        ) : (
          <div className="nvn-newsroom-preview__empty">
            <Eye size={18} aria-hidden="true" />
            <p>Player-visible fields will be previewed after an editorial record is selected.</p>
          </div>
        )}
      </aside>

      {confirmation ? (
        <NvnNewsroomConfirmation
          title={confirmation.title}
          body={confirmation.body}
          confirmLabel={confirmation.confirmLabel}
          tone={confirmation.tone}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            const action = confirmation.action
            setConfirmation(null)
            void action()
          }}
        />
      ) : null}
    </section>
  )
}
