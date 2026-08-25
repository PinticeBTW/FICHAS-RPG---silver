import {
  Archive,
  BookOpenText,
  Database,
  FilePlus2,
  FileText,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'

import {
  deleteNetSearchGmDocument,
  deleteNetSearchGmEntry,
  fetchNetSearchGmDirectory,
  fetchNetSearchGmDocument,
  fetchNetSearchGmEntry,
  previewNetSearchGmLoreImport,
  saveNetSearchGmDocument,
  saveNetSearchGmEntry,
  setNetSearchGmEntryLifecycle,
} from '../../lib/netSearchService'
import {
  NET_SEARCH_ALIAS_MAX_LENGTH,
  NET_SEARCH_CONTENT_MAX_LENGTH,
  NET_SEARCH_LORE_CONTENT_MAX_LENGTH,
  NET_SEARCH_LORE_FILE_MAX_BYTES,
  NET_SEARCH_QUERY_MAX_LENGTH,
  NET_SEARCH_REFERENCE_MAX_LENGTH,
  NET_SEARCH_SOURCE_LABEL_MAX_LENGTH,
  NET_SEARCH_SUMMARY_MAX_LENGTH,
  NET_SEARCH_TAG_MAX_LENGTH,
  NET_SEARCH_TITLE_MAX_LENGTH,
  netSearchEntryTypes,
  netSearchGmLifecycleFilters,
  netSearchGmSourceFilters,
  netSearchVisibilities,
  type NetSearchEntryStatus,
  type NetSearchEntryType,
  type NetSearchGmDirectoryRow,
  type NetSearchGmDocumentDetail,
  type NetSearchGmDocumentInput,
  type NetSearchGmEntryDetail,
  type NetSearchGmEntryInput,
  type NetSearchGmLifecycleFilter,
  type NetSearchGmSourceFilter,
  type NetSearchLorePreviewSection,
  type NetSearchVisibility,
} from '../../lib/netSearchTypes'

import { NetSearchMarkdownEditor } from './NetSearchMarkdownEditor'
import { NetSearchMarkdownPreview } from './NetSearchMarkdownPreview'

interface NetSearchKnowledgeControlProps {
  readonly enabled: boolean
  readonly onNotice: (message: string) => void
  readonly productName?: string
}

interface KnowledgeDraft {
  title: string
  entryType: NetSearchEntryType
  summary: string
  content: string
  aliases: string
  tags: string
  visibility: NetSearchVisibility
  availableFrom: string
  expiresAt: string
  relatedReferences: string
}

interface LoreDocumentDraft {
  title: string
  sourceLabel: string
  visibility: NetSearchVisibility
  availableFrom: string
  expiresAt: string
  rawContent: string
}

type EditorMode = 'entry' | 'document'
type ConfirmAction = 'archive' | 'restore' | 'delete-entry' | 'delete-document'

const EMPTY_ENTRY_DRAFT: KnowledgeDraft = {
  title: '',
  entryType: 'other',
  summary: '',
  content: '',
  aliases: '',
  tags: '',
  visibility: 'public',
  availableFrom: '',
  expiresAt: '',
  relatedReferences: '',
}

const EMPTY_DOCUMENT_DRAFT: LoreDocumentDraft = {
  title: '',
  sourceLabel: '',
  visibility: 'public',
  availableFrom: '',
  expiresAt: '',
  rawContent: '',
}

const CONTROL_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function toLocalDateTime(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function toServerDateTime(value: string): string | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

function entryDraftFromDetail(detail: NetSearchGmEntryDetail): KnowledgeDraft {
  return {
    title: detail.title,
    entryType: detail.entryType,
    summary: detail.summary,
    content: detail.content,
    aliases: detail.aliases.join(', '),
    tags: detail.tags.join(', '),
    visibility: detail.visibility,
    availableFrom: toLocalDateTime(detail.availableFrom),
    expiresAt: toLocalDateTime(detail.expiresAt),
    relatedReferences: detail.relatedReferences.join('\n'),
  }
}

function documentDraftFromDetail(detail: NetSearchGmDocumentDetail): LoreDocumentDraft {
  return {
    title: detail.title,
    sourceLabel: detail.sourceLabel ?? '',
    visibility: detail.visibility,
    availableFrom: toLocalDateTime(detail.availableFrom),
    expiresAt: toLocalDateTime(detail.expiresAt),
    rawContent: detail.rawContent,
  }
}

function splitList(value: string, separator: RegExp): readonly string[] {
  const values = value
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean)
  return values.filter((item, index) => (
    values.findIndex((candidate) => candidate.toLocaleLowerCase() === item.toLocaleLowerCase()) === index
  ))
}

function lifecycleLabel(input: {
  readonly status: NetSearchEntryStatus
  readonly availableFrom?: string
  readonly expiresAt?: string
}): string {
  if (input.status === 'archived') return 'ARCHIVED'
  const now = Date.now()
  if (input.availableFrom && Date.parse(input.availableFrom) > now) return 'FUTURE'
  if (input.expiresAt && Date.parse(input.expiresAt) <= now) return 'EXPIRED'
  return 'CURRENT'
}

function documentLifecycleLabel(detail: NetSearchGmDocumentDetail): string {
  return lifecycleLabel({
    status: 'active',
    ...(detail.availableFrom ? { availableFrom: detail.availableFrom } : {}),
    ...(detail.expiresAt ? { expiresAt: detail.expiresAt } : {}),
  })
}

function formatControlDate(value: string): string {
  return CONTROL_DATE_FORMATTER.format(new Date(value))
}

function toEntryInput(draft: KnowledgeDraft): NetSearchGmEntryInput {
  const availableFrom = toServerDateTime(draft.availableFrom)
  const expiresAt = toServerDateTime(draft.expiresAt)
  return {
    title: draft.title.trim(),
    entryType: draft.entryType,
    summary: draft.summary.trim(),
    content: draft.content.trim(),
    aliases: splitList(draft.aliases, /[,\n]/),
    tags: splitList(draft.tags, /[,\n]/).map((tag) => tag.replace(/^#/, '')),
    visibility: draft.visibility,
    ...(availableFrom ? { availableFrom } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    relatedReferences: splitList(draft.relatedReferences, /\n/),
  }
}

function toDocumentInput(draft: LoreDocumentDraft): NetSearchGmDocumentInput {
  const availableFrom = toServerDateTime(draft.availableFrom)
  const expiresAt = toServerDateTime(draft.expiresAt)
  const sourceLabel = draft.sourceLabel.trim()
  return {
    title: draft.title.trim(),
    ...(sourceLabel ? { sourceLabel } : {}),
    visibility: draft.visibility,
    ...(availableFrom ? { availableFrom } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    rawContent: draft.rawContent.trim(),
  }
}

function validateTimeWindow(availableFromValue: string, expiresAtValue: string): string | null {
  const availableFrom = toServerDateTime(availableFromValue)
  const expiresAt = toServerDateTime(expiresAtValue)
  if (availableFromValue && !availableFrom) return 'Available From is not a valid date.'
  if (expiresAtValue && !expiresAt) return 'Expires At is not a valid date.'
  if (availableFrom && expiresAt && Date.parse(expiresAt) <= Date.parse(availableFrom)) {
    return 'Expires At must be later than Available From.'
  }
  return null
}

function estimateSearchableSections(characterCount: number): number {
  return characterCount > 0 ? Math.max(1, Math.ceil(characterCount / 2400)) : 0
}

function validateLoreCore(draft: LoreDocumentDraft): string | null {
  if (!draft.title.trim() || !draft.rawContent.trim()) {
    return 'Title and lore content are required.'
  }
  if (draft.rawContent.length > NET_SEARCH_LORE_CONTENT_MAX_LENGTH) {
    return `Lore content is limited to ${NET_SEARCH_LORE_CONTENT_MAX_LENGTH.toLocaleString()} characters.`
  }
  if (new Blob([draft.rawContent]).size > NET_SEARCH_LORE_FILE_MAX_BYTES) {
    return 'Lore content is too large after UTF-8 encoding.'
  }
  return null
}

function importedTitle(fileName: string): string {
  return fileName.replace(/\.(?:txt|md)$/i, '').replaceAll(/[-_]+/g, ' ').trim()
}

export function NetSearchKnowledgeControl({
  enabled,
  onNotice,
  productName = 'VEIL SEARCH',
}: NetSearchKnowledgeControlProps) {
  const [directory, setDirectory] = useState<readonly NetSearchGmDirectoryRow[]>([])
  const [directoryLoading, setDirectoryLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [mutating, setMutating] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<NetSearchGmSourceFilter>('all')
  const [visibility, setVisibility] = useState<NetSearchVisibility | 'all'>('all')
  const [lifecycle, setLifecycle] = useState<NetSearchGmLifecycleFilter>('all')
  const [editorMode, setEditorMode] = useState<EditorMode>('entry')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [entryDetail, setEntryDetail] = useState<NetSearchGmEntryDetail | null>(null)
  const [documentDetail, setDocumentDetail] = useState<NetSearchGmDocumentDetail | null>(null)
  const [entryDraft, setEntryDraft] = useState<KnowledgeDraft>(EMPTY_ENTRY_DRAFT)
  const [documentDraft, setDocumentDraft] = useState<LoreDocumentDraft>(EMPTY_DOCUMENT_DRAFT)
  const [preview, setPreview] = useState<readonly NetSearchLorePreviewSection[] | null>(null)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const directoryGenerationRef = useRef(0)
  const detailGenerationRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadDirectory = useCallback(async () => {
    const generation = ++directoryGenerationRef.current
    setDirectoryLoading(true)
    setError(null)
    try {
      const rows = await fetchNetSearchGmDirectory({
        query,
        sourceFilter,
        visibility,
        lifecycle,
      })
      if (directoryGenerationRef.current !== generation) return
      setDirectory(rows)
    } catch (loadError) {
      if (directoryGenerationRef.current !== generation) return
      setError(loadError instanceof Error ? loadError.message : 'Knowledge directory is unavailable.')
    } finally {
      if (directoryGenerationRef.current === generation) setDirectoryLoading(false)
    }
  }, [lifecycle, query, sourceFilter, visibility])

  useEffect(() => {
    if (!enabled) return
    const timer = window.setTimeout(() => { void loadDirectory() }, 220)
    return () => window.clearTimeout(timer)
  }, [enabled, loadDirectory])

  const openSource = useCallback(async (source: NetSearchGmDirectoryRow) => {
    const nextMode: EditorMode = source.sourceKind === 'lore_document' ? 'document' : 'entry'
    const isSameSelection = source.id === selectedId && nextMode === editorMode
    if (dirty && !isSameSelection && !window.confirm('Discard unsaved knowledge changes?')) return
    const generation = ++detailGenerationRef.current
    setEditorMode(nextMode)
    setSelectedId(source.id)
    setDetailLoading(true)
    setError(null)
    setPreview(null)
    try {
      if (nextMode === 'document') {
        const nextDetail = await fetchNetSearchGmDocument(source.id)
        if (detailGenerationRef.current !== generation) return
        if (!nextDetail) {
          setError('That lore document no longer exists.')
          setSelectedId(null)
          setDocumentDetail(null)
          return
        }
        setDocumentDetail(nextDetail)
        setEntryDetail(null)
        setDocumentDraft(documentDraftFromDetail(nextDetail))
      } else {
        const nextDetail = await fetchNetSearchGmEntry(source.id)
        if (detailGenerationRef.current !== generation) return
        if (!nextDetail) {
          setError('That canonical entry no longer exists.')
          setSelectedId(null)
          setEntryDetail(null)
          return
        }
        setEntryDetail(nextDetail)
        setDocumentDetail(null)
        setEntryDraft(entryDraftFromDetail(nextDetail))
      }
      setDirty(false)
    } catch (loadError) {
      if (detailGenerationRef.current !== generation) return
      setError(loadError instanceof Error ? loadError.message : 'Knowledge source is unavailable.')
    } finally {
      if (detailGenerationRef.current === generation) setDetailLoading(false)
    }
  }, [dirty, editorMode, selectedId])

  const startNewEntry = () => {
    if (dirty && !window.confirm('Discard unsaved knowledge changes?')) return
    ++detailGenerationRef.current
    setEditorMode('entry')
    setSelectedId(null)
    setEntryDetail(null)
    setDocumentDetail(null)
    setEntryDraft(EMPTY_ENTRY_DRAFT)
    setPreview(null)
    setDirty(false)
    setError(null)
  }

  const startImportLore = () => {
    if (dirty && !window.confirm('Discard unsaved knowledge changes?')) return
    ++detailGenerationRef.current
    setEditorMode('document')
    setSelectedId(null)
    setEntryDetail(null)
    setDocumentDetail(null)
    setDocumentDraft(EMPTY_DOCUMENT_DRAFT)
    setPreview(null)
    setDirty(false)
    setError(null)
  }

  const updateEntryDraft = <Key extends keyof KnowledgeDraft>(
    key: Key,
    value: KnowledgeDraft[Key],
  ) => {
    setEntryDraft((current) => ({ ...current, [key]: value }))
    setDirty(true)
  }

  const updateDocumentDraft = <Key extends keyof LoreDocumentDraft>(
    key: Key,
    value: LoreDocumentDraft[Key],
  ) => {
    setDocumentDraft((current) => ({ ...current, [key]: value }))
    if (key === 'title' || key === 'rawContent') setPreview(null)
    setDirty(true)
  }

  const saveEntry = async () => {
    if (!entryDraft.title.trim() || !entryDraft.summary.trim() || !entryDraft.content.trim()) {
      setError('Title, summary, and canonical content are required.')
      return
    }
    const timeError = validateTimeWindow(entryDraft.availableFrom, entryDraft.expiresAt)
    if (timeError) {
      setError(timeError)
      return
    }

    setMutating(true)
    setError(null)
    try {
      const wasExisting = Boolean(selectedId)
      const saved = await saveNetSearchGmEntry(selectedId, toEntryInput(entryDraft))
      setSelectedId(saved.id)
      setEntryDetail(saved)
      setEntryDraft(entryDraftFromDetail(saved))
      setDirty(false)
      await loadDirectory()
      onNotice(`${productName} // ${wasExisting ? 'KNOWLEDGE UPDATED' : 'KNOWLEDGE CREATED'}`)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Knowledge entry failed to save.')
    } finally {
      setMutating(false)
    }
  }

  const previewDocument = async () => {
    const loreError = validateLoreCore(documentDraft)
    if (loreError) {
      setError(loreError)
      return
    }

    setPreviewLoading(true)
    setError(null)
    try {
      const sections = await previewNetSearchGmLoreImport(
        documentDraft.title.trim(),
        documentDraft.rawContent,
      )
      setPreview(sections)
      onNotice(`${productName} // ${sections.length} SEARCHABLE SECTIONS PREVIEWED`)
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Lore preview failed.')
    } finally {
      setPreviewLoading(false)
    }
  }

  const saveDocument = async () => {
    const loreError = validateLoreCore(documentDraft)
    if (loreError) {
      setError(loreError)
      return
    }
    const timeError = validateTimeWindow(documentDraft.availableFrom, documentDraft.expiresAt)
    if (timeError) {
      setError(timeError)
      return
    }

    setMutating(true)
    setError(null)
    try {
      const wasExisting = Boolean(selectedId)
      const saved = await saveNetSearchGmDocument(selectedId, toDocumentInput(documentDraft))
      setSelectedId(saved.id)
      setDocumentDetail(saved)
      setDocumentDraft(documentDraftFromDetail(saved))
      setPreview(null)
      setDirty(false)
      await loadDirectory()
      onNotice(`${productName} // LORE DOCUMENT ${wasExisting ? 'UPDATED' : 'IMPORTED'} · ${saved.searchableSections} SECTIONS`)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Lore document failed to save.')
    } finally {
      setMutating(false)
    }
  }

  const importTextFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    if (!/\.(?:txt|md)$/i.test(file.name)) {
      setError('Choose a .txt or .md lore file.')
      return
    }
    if (file.size > NET_SEARCH_LORE_FILE_MAX_BYTES) {
      setError('That file is too large for this import path.')
      return
    }

    setError(null)
    try {
      const rawContent = await file.text()
      if (rawContent.length > NET_SEARCH_LORE_CONTENT_MAX_LENGTH) {
        setError(`Lore content is limited to ${NET_SEARCH_LORE_CONTENT_MAX_LENGTH.toLocaleString()} characters.`)
        return
      }
      setDocumentDraft((current) => ({
        ...current,
        title: current.title || importedTitle(file.name),
        sourceLabel: current.sourceLabel || file.name,
        rawContent,
      }))
      setPreview(null)
      setDirty(true)
      onNotice(`${productName} // ${file.name.toUpperCase()} LOADED FOR PREVIEW`)
    } catch {
      setError('The selected text file could not be read.')
    }
  }

  const applyConfirmedAction = async () => {
    const action = confirmAction
    if (!action || !selectedId) return
    setConfirmAction(null)
    setMutating(true)
    setError(null)
    try {
      if (action === 'delete-document') {
        await deleteNetSearchGmDocument(selectedId)
        setSelectedId(null)
        setDocumentDetail(null)
        setDocumentDraft(EMPTY_DOCUMENT_DRAFT)
        setPreview(null)
        setDirty(false)
        onNotice(`${productName} // LORE DOCUMENT DELETED`)
      } else if (action === 'delete-entry') {
        await deleteNetSearchGmEntry(selectedId)
        setSelectedId(null)
        setEntryDetail(null)
        setEntryDraft(EMPTY_ENTRY_DRAFT)
        setDirty(false)
        onNotice(`${productName} // KNOWLEDGE ENTRY DELETED`)
      } else {
        const updated = await setNetSearchGmEntryLifecycle(selectedId, action)
        setEntryDetail(updated)
        setEntryDraft(entryDraftFromDetail(updated))
        setDirty(false)
        onNotice(`${productName} // KNOWLEDGE ${action === 'archive' ? 'ARCHIVED' : 'RESTORED'}`)
      }
      await loadDirectory()
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'Knowledge lifecycle failed to change.')
    } finally {
      setMutating(false)
    }
  }

  const selectedLifecycle = entryDetail
    ? lifecycleLabel(entryDetail)
    : documentDetail
      ? documentLifecycleLabel(documentDetail)
      : null
  const directorySummary = `${directory.length} SOURCE${directory.length === 1 ? '' : 'S'}`
  const displayedSectionCount = preview?.length
    ?? documentDetail?.searchableSections
    ?? estimateSearchableSections(documentDraft.rawContent.length)
  const isDocumentMode = editorMode === 'document'

  return (
    <div className="net-search-control">
      <aside className="net-search-control__directory">
        <header>
          <div><span>GM SYSTEM</span><strong>SEARCH INDEX</strong></div>
          <div className="net-search-control__create-actions">
            <button type="button" onClick={startNewEntry}><FilePlus2 size={13} /> New entry</button>
            <button type="button" onClick={startImportLore}><Upload size={13} /> Import lore</button>
          </div>
        </header>

        <div className="net-search-control__filters">
          <label className="net-search-control__query">
            <Search size={13} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={NET_SEARCH_QUERY_MAX_LENGTH} placeholder="Search title or content" />
            {query ? <button type="button" onClick={() => setQuery('')} aria-label="Clear directory query"><X size={12} /></button> : null}
          </label>
          <div>
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as NetSearchGmSourceFilter)} aria-label="Source type filter">
              {netSearchGmSourceFilters.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}
            </select>
            <select value={visibility} onChange={(event) => setVisibility(event.target.value as NetSearchVisibility | 'all')} aria-label="Visibility filter">
              <option value="all">ALL ACCESS</option>
              {netSearchVisibilities.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}
            </select>
            <select value={lifecycle} onChange={(event) => setLifecycle(event.target.value as NetSearchGmLifecycleFilter)} aria-label="Lifecycle filter">
              {netSearchGmLifecycleFilters.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}
            </select>
          </div>
        </div>

        <div className="net-search-control__directory-status">
          <span>{directorySummary}</span>
          <button type="button" onClick={() => void loadDirectory()} disabled={directoryLoading} aria-label="Refresh directory">
            <RefreshCw size={12} className={directoryLoading ? 'net-search-spin' : undefined} />
          </button>
        </div>

        <div className="net-search-control__list">
          {directoryLoading && directory.length === 0 ? (
            <div className="net-search-control__list-state"><LoaderCircle className="net-search-spin" /> Loading index…</div>
          ) : directory.length === 0 ? (
            <div className="net-search-control__list-state"><Database /> No knowledge sources match these filters.</div>
          ) : directory.map((source) => {
            const isLoreDocument = source.sourceKind === 'lore_document'
            return (
              <button
                key={`${source.sourceKind}:${source.id}`}
                type="button"
                data-selected={selectedId === source.id && editorMode === (isLoreDocument ? 'document' : 'entry') ? 'true' : 'false'}
                onClick={() => void openSource(source)}
              >
                <span>
                  <i className="net-search-control__kind">
                    {isLoreDocument ? <FileText size={9} /> : <BookOpenText size={9} />}
                    {isLoreDocument ? 'LORE DOCUMENT' : 'CANONICAL ENTRY'}
                  </i>
                  <i data-visibility={source.visibility}>{source.visibility}</i>
                  <i data-lifecycle={lifecycleLabel(source)}>{lifecycleLabel(source)}</i>
                </span>
                <strong>{source.title}</strong>
                <small>
                  {isLoreDocument
                    ? `${source.searchableSections ?? 0} SEARCHABLE SECTIONS`
                    : source.entryType.toUpperCase()}
                  {' · '}{formatControlDate(source.updatedAt)}
                </small>
              </button>
            )
          })}
        </div>
      </aside>

      <main className="net-search-control__editor">
        <header className="net-search-control__editor-head">
          <div>
            <span>{isDocumentMode ? (selectedId ? 'LORE DOCUMENT' : 'IMPORT LORE') : (selectedId ? 'CANONICAL ENTRY' : 'NEW ENTRY')}</span>
            <strong>
              {isDocumentMode
                ? documentDetail?.title || 'Untitled lore document'
                : entryDetail?.title || 'Untitled canonical entry'}
            </strong>
          </div>
          <div>
            {isDocumentMode && documentDetail ? <i data-visibility={documentDetail.visibility}>{documentDetail.visibility.toUpperCase()}</i> : null}
            {!isDocumentMode && entryDetail ? <i data-visibility={entryDetail.visibility}>{entryDetail.visibility.toUpperCase()}</i> : null}
            {selectedLifecycle ? <i data-lifecycle={selectedLifecycle}>{selectedLifecycle}</i> : null}
          </div>
        </header>

        {error ? <div className="net-search-control__error" role="alert"><ShieldAlert size={15} /><span>{error}</span></div> : null}
        {detailLoading ? (
          <div className="net-search-control__editor-state"><LoaderCircle className="net-search-spin" /> Loading knowledge source…</div>
        ) : isDocumentMode ? (
          <div className="net-search-control__form net-search-control__form--lore">
            <div className="net-search-control__form-row net-search-control__form-row--title">
              <label><span>Title</span><input value={documentDraft.title} onChange={(event) => updateDocumentDraft('title', event.target.value)} maxLength={NET_SEARCH_TITLE_MAX_LENGTH} /></label>
              <label><span>Type / Source <small>optional</small></span><input value={documentDraft.sourceLabel} onChange={(event) => updateDocumentDraft('sourceLabel', event.target.value)} maxLength={NET_SEARCH_SOURCE_LABEL_MAX_LENGTH} placeholder="GM notes, Session 12, city archive…" /></label>
              <label><span>Visibility</span><select value={documentDraft.visibility} onChange={(event) => updateDocumentDraft('visibility', event.target.value as NetSearchVisibility)}>{netSearchVisibilities.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label>
            </div>

            <div className="net-search-control__form-row">
              <label><span>Available From <small>optional</small></span><input type="datetime-local" value={documentDraft.availableFrom} onChange={(event) => updateDocumentDraft('availableFrom', event.target.value)} /></label>
              <label><span>Expires At <small>optional</small></span><input type="datetime-local" value={documentDraft.expiresAt} onChange={(event) => updateDocumentDraft('expiresAt', event.target.value)} /></label>
            </div>

            <div className="net-search-control__lore-toolbar">
              <div>
                <span><strong>{documentDraft.rawContent.length.toLocaleString()}</strong> Characters</span>
                <span><strong>{displayedSectionCount}</strong> {preview ? 'Searchable sections' : 'Estimated searchable sections'}</span>
              </div>
              <button type="button" onClick={() => fileInputRef.current?.click()}>
                <Upload size={13} /> Load .txt / .md
              </button>
              <input ref={fileInputRef} type="file" accept=".txt,.md,text/plain,text/markdown" onChange={(event) => void importTextFile(event)} hidden />
            </div>

            <div className="net-search-control__lore-editor-field">
              <span>Lore content <small>Markdown source · safe formatted preview</small></span>
              <NetSearchMarkdownEditor
                value={documentDraft.rawContent}
                onChange={(value) => updateDocumentDraft('rawContent', value)}
                maxLength={NET_SEARCH_LORE_CONTENT_MAX_LENGTH}
                placeholder="Paste Silver/GM lore here. Long documents are automatically divided into searchable sections."
              />
            </div>

            {preview ? (
              <section className="net-search-control__preview" aria-label="Lore import preview">
                <header>
                  <div><span>IMPORT PREVIEW</span><strong>{documentDraft.title.trim()}</strong></div>
                  <div><span>{documentDraft.rawContent.length.toLocaleString()} CHARACTERS</span><span>{preview.length} SEARCHABLE SECTIONS</span></div>
                </header>
                <div>
                  {preview.slice(0, 16).map((section) => (
                    <article key={section.index}>
                      <strong>{String(section.index + 1).padStart(2, '0')} — {section.heading || `SECTION ${section.index + 1}`}</strong>
                      <NetSearchMarkdownPreview content={section.excerpt} compact fallback={section.excerpt} />
                      <small>{section.characterCount.toLocaleString()} characters</small>
                    </article>
                  ))}
                  {preview.length > 16 ? <p className="net-search-control__preview-more">+ {preview.length - 16} more searchable sections</p> : null}
                </div>
              </section>
            ) : null}
          </div>
        ) : (
          <div className="net-search-control__form">
            <div className="net-search-control__form-row net-search-control__form-row--title">
              <label><span>Title</span><input value={entryDraft.title} onChange={(event) => updateEntryDraft('title', event.target.value)} maxLength={NET_SEARCH_TITLE_MAX_LENGTH} /></label>
              <label><span>Type</span><select value={entryDraft.entryType} onChange={(event) => updateEntryDraft('entryType', event.target.value as NetSearchEntryType)}>{netSearchEntryTypes.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label>
              <label><span>Visibility</span><select value={entryDraft.visibility} onChange={(event) => updateEntryDraft('visibility', event.target.value as NetSearchVisibility)}>{netSearchVisibilities.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label>
            </div>

            <label><span>Summary</span><textarea value={entryDraft.summary} onChange={(event) => updateEntryDraft('summary', event.target.value)} maxLength={NET_SEARCH_SUMMARY_MAX_LENGTH} rows={3} placeholder="Concise verified description shown in search results." /></label>
            <label><span>Canonical content</span><textarea className="net-search-control__content" value={entryDraft.content} onChange={(event) => updateEntryDraft('content', event.target.value)} maxLength={NET_SEARCH_CONTENT_MAX_LENGTH} rows={12} placeholder="Authoritative lore and facts. AI-generated answers are never stored here automatically." /></label>

            <div className="net-search-control__form-row">
              <label><span>Aliases <small>comma separated</small></span><input value={entryDraft.aliases} onChange={(event) => updateEntryDraft('aliases', event.target.value)} maxLength={NET_SEARCH_ALIAS_MAX_LENGTH * 20} /></label>
              <label><span>Tags <small>comma separated</small></span><input value={entryDraft.tags} onChange={(event) => updateEntryDraft('tags', event.target.value)} maxLength={NET_SEARCH_TAG_MAX_LENGTH * 20} /></label>
            </div>

            <div className="net-search-control__form-row">
              <label><span>Available From</span><input type="datetime-local" value={entryDraft.availableFrom} onChange={(event) => updateEntryDraft('availableFrom', event.target.value)} /></label>
              <label><span>Expires At</span><input type="datetime-local" value={entryDraft.expiresAt} onChange={(event) => updateEntryDraft('expiresAt', event.target.value)} /></label>
            </div>

            <label><span>Related references <small>one safe label/reference per line</small></span><textarea value={entryDraft.relatedReferences} onChange={(event) => updateEntryDraft('relatedReferences', event.target.value)} maxLength={NET_SEARCH_REFERENCE_MAX_LENGTH * 20} rows={4} /></label>
          </div>
        )}

        <footer className="net-search-control__actions">
          <div>
            {!isDocumentMode && entryDetail?.status === 'active' ? <button type="button" className="danger" onClick={() => setConfirmAction('archive')} disabled={mutating || dirty}><Archive size={14} /> Archive</button> : null}
            {!isDocumentMode && entryDetail?.status === 'archived' ? <button type="button" onClick={() => setConfirmAction('restore')} disabled={mutating || dirty}><RotateCcw size={14} /> Restore</button> : null}
            {!isDocumentMode && entryDetail ? <button type="button" className="danger" onClick={() => setConfirmAction('delete-entry')} disabled={mutating}><Trash2 size={14} /> Delete</button> : null}
            {isDocumentMode && documentDetail ? <button type="button" className="danger" onClick={() => setConfirmAction('delete-document')} disabled={mutating}><Trash2 size={14} /> Delete document</button> : null}
          </div>
          {isDocumentMode ? (
            <div className="net-search-control__import-actions">
              <button type="button" onClick={() => void previewDocument()} disabled={mutating || previewLoading || !documentDraft.title.trim() || !documentDraft.rawContent.trim()}>
                {previewLoading ? <LoaderCircle className="net-search-spin" size={14} /> : <Search size={14} />}
                Preview import
              </button>
              <button type="button" className="primary" onClick={() => void saveDocument()} disabled={mutating || previewLoading || detailLoading || !dirty}>
                {mutating ? <LoaderCircle className="net-search-spin" size={14} /> : <Upload size={14} />}
                {selectedId ? 'Save document' : 'Import document'}
              </button>
            </div>
          ) : (
            <button type="button" className="primary" onClick={() => void saveEntry()} disabled={mutating || detailLoading || !dirty}>
              {mutating ? <LoaderCircle className="net-search-spin" size={14} /> : <Save size={14} />}
              {selectedId ? 'Save changes' : 'Create entry'}
            </button>
          )}
        </footer>
      </main>

      {confirmAction ? (
        <div className="net-search-control__confirm" role="dialog" aria-modal="true" aria-labelledby="net-search-confirm-title">
          <div>
            <ShieldAlert size={24} />
            <h2 id="net-search-confirm-title">
              {confirmAction === 'delete-document'
                ? 'Delete this lore document?'
                : confirmAction === 'delete-entry'
                  ? 'Delete this canonical entry?'
                  : `${confirmAction === 'archive' ? 'Archive' : 'Restore'} this entry?`}
            </h2>
            <p>
              {confirmAction === 'delete-document'
                ? 'This permanently removes the source and all of its private searchable chunks. The audit event remains traceable.'
                : confirmAction === 'delete-entry'
                  ? 'This permanently removes the canonical entry. The hidden audit event remains traceable.'
                  : 'The player-facing index will immediately follow the new lifecycle state.'}
            </p>
            <footer><button type="button" onClick={() => setConfirmAction(null)}>Cancel</button><button type="button" className="danger" onClick={() => void applyConfirmedAction()}>Confirm</button></footer>
          </div>
        </div>
      ) : null}
    </div>
  )
}
