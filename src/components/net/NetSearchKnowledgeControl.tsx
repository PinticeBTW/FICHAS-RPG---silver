import {
  Archive,
  Database,
  FilePlus2,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  deleteNetSearchGmEntry,
  fetchNetSearchGmDirectory,
  fetchNetSearchGmEntry,
  saveNetSearchGmEntry,
  setNetSearchGmEntryLifecycle,
} from '../../lib/netSearchService'
import {
  NET_SEARCH_ALIAS_MAX_LENGTH,
  NET_SEARCH_CONTENT_MAX_LENGTH,
  NET_SEARCH_QUERY_MAX_LENGTH,
  NET_SEARCH_REFERENCE_MAX_LENGTH,
  NET_SEARCH_SUMMARY_MAX_LENGTH,
  NET_SEARCH_TAG_MAX_LENGTH,
  NET_SEARCH_TITLE_MAX_LENGTH,
  netSearchEntryTypes,
  netSearchGmLifecycleFilters,
  netSearchVisibilities,
  type NetSearchEntryType,
  type NetSearchGmDirectoryRow,
  type NetSearchGmEntryDetail,
  type NetSearchGmEntryInput,
  type NetSearchGmLifecycleFilter,
  type NetSearchVisibility,
} from '../../lib/netSearchTypes'

interface NetSearchKnowledgeControlProps {
  readonly enabled: boolean
  readonly onNotice: (message: string) => void
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

const EMPTY_DRAFT: KnowledgeDraft = {
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

function draftFromDetail(detail: NetSearchGmEntryDetail): KnowledgeDraft {
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

function splitList(value: string, separator: RegExp): readonly string[] {
  const values = value
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean)
  return values.filter((item, index) => (
    values.findIndex((candidate) => candidate.toLocaleLowerCase() === item.toLocaleLowerCase()) === index
  ))
}

function lifecycleLabel(entry: NetSearchGmDirectoryRow | NetSearchGmEntryDetail): string {
  if (entry.status === 'archived') return 'ARCHIVED'
  const now = Date.now()
  if (entry.availableFrom && Date.parse(entry.availableFrom) > now) return 'FUTURE'
  if (entry.expiresAt && Date.parse(entry.expiresAt) <= now) return 'EXPIRED'
  return 'CURRENT'
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

export function NetSearchKnowledgeControl({ enabled, onNotice }: NetSearchKnowledgeControlProps) {
  const [directory, setDirectory] = useState<readonly NetSearchGmDirectoryRow[]>([])
  const [directoryLoading, setDirectoryLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [mutating, setMutating] = useState(false)
  const [query, setQuery] = useState('')
  const [visibility, setVisibility] = useState<NetSearchVisibility | 'all'>('all')
  const [lifecycle, setLifecycle] = useState<NetSearchGmLifecycleFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<NetSearchGmEntryDetail | null>(null)
  const [draft, setDraft] = useState<KnowledgeDraft>(EMPTY_DRAFT)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<'archive' | 'restore' | 'delete' | null>(null)
  const directoryGenerationRef = useRef(0)
  const detailGenerationRef = useRef(0)

  const loadDirectory = useCallback(async () => {
    const generation = ++directoryGenerationRef.current
    setDirectoryLoading(true)
    setError(null)
    try {
      const rows = await fetchNetSearchGmDirectory({ query, visibility, lifecycle })
      if (directoryGenerationRef.current !== generation) return
      setDirectory(rows)
    } catch (loadError) {
      if (directoryGenerationRef.current !== generation) return
      setError(loadError instanceof Error ? loadError.message : 'Knowledge directory is unavailable.')
    } finally {
      if (directoryGenerationRef.current === generation) setDirectoryLoading(false)
    }
  }, [lifecycle, query, visibility])

  useEffect(() => {
    if (!enabled) return
    const timer = window.setTimeout(() => { void loadDirectory() }, 220)
    return () => window.clearTimeout(timer)
  }, [enabled, loadDirectory])

  const openEntry = useCallback(async (entryId: string) => {
    if (dirty && entryId !== selectedId && !window.confirm('Discard unsaved knowledge changes?')) return
    const generation = ++detailGenerationRef.current
    setSelectedId(entryId)
    setDetailLoading(true)
    setError(null)
    try {
      const nextDetail = await fetchNetSearchGmEntry(entryId)
      if (detailGenerationRef.current !== generation) return
      if (!nextDetail) {
        setError('That knowledge entry no longer exists.')
        setSelectedId(null)
        setDetail(null)
        return
      }
      setDetail(nextDetail)
      setDraft(draftFromDetail(nextDetail))
      setDirty(false)
    } catch (loadError) {
      if (detailGenerationRef.current !== generation) return
      setError(loadError instanceof Error ? loadError.message : 'Knowledge entry is unavailable.')
    } finally {
      if (detailGenerationRef.current === generation) setDetailLoading(false)
    }
  }, [dirty, selectedId])

  const startNewEntry = () => {
    if (dirty && !window.confirm('Discard unsaved knowledge changes?')) return
    ++detailGenerationRef.current
    setSelectedId(null)
    setDetail(null)
    setDraft(EMPTY_DRAFT)
    setDirty(false)
    setError(null)
  }

  const updateDraft = <Key extends keyof KnowledgeDraft>(key: Key, value: KnowledgeDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setDirty(true)
  }

  const saveEntry = async () => {
    if (!draft.title.trim() || !draft.summary.trim() || !draft.content.trim()) {
      setError('Title, summary, and canonical content are required.')
      return
    }
    const availableFrom = toServerDateTime(draft.availableFrom)
    const expiresAt = toServerDateTime(draft.expiresAt)
    if (draft.availableFrom && !availableFrom) {
      setError('Available From is not a valid date.')
      return
    }
    if (draft.expiresAt && !expiresAt) {
      setError('Expires At is not a valid date.')
      return
    }
    if (availableFrom && expiresAt && Date.parse(expiresAt) <= Date.parse(availableFrom)) {
      setError('Expires At must be later than Available From.')
      return
    }

    setMutating(true)
    setError(null)
    try {
      const saved = await saveNetSearchGmEntry(selectedId, toEntryInput(draft))
      setSelectedId(saved.id)
      setDetail(saved)
      setDraft(draftFromDetail(saved))
      setDirty(false)
      await loadDirectory()
      onNotice(`VEIL SEARCH // ${selectedId ? 'KNOWLEDGE UPDATED' : 'KNOWLEDGE CREATED'}`)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Knowledge entry failed to save.')
    } finally {
      setMutating(false)
    }
  }

  const applyConfirmedAction = async () => {
    const action = confirmAction
    if (!action || !selectedId) return
    setConfirmAction(null)
    setMutating(true)
    setError(null)
    try {
      if (action === 'delete') {
        await deleteNetSearchGmEntry(selectedId)
        setSelectedId(null)
        setDetail(null)
        setDraft(EMPTY_DRAFT)
        setDirty(false)
        onNotice('VEIL SEARCH // KNOWLEDGE ENTRY DELETED')
      } else {
        const updated = await setNetSearchGmEntryLifecycle(selectedId, action)
        setDetail(updated)
        setDraft(draftFromDetail(updated))
        setDirty(false)
        onNotice(`VEIL SEARCH // KNOWLEDGE ${action === 'archive' ? 'ARCHIVED' : 'RESTORED'}`)
      }
      await loadDirectory()
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'Knowledge lifecycle failed to change.')
    } finally {
      setMutating(false)
    }
  }

  const selectedLifecycle = detail ? lifecycleLabel(detail) : null
  const directorySummary = `${directory.length} ENTR${directory.length === 1 ? 'Y' : 'IES'}`

  return (
    <div className="net-search-control">
      <aside className="net-search-control__directory">
        <header>
          <div><span>GM SYSTEM</span><strong>SEARCH INDEX</strong></div>
          <button type="button" onClick={startNewEntry}><FilePlus2 size={14} /> New</button>
        </header>

        <div className="net-search-control__filters">
          <label className="net-search-control__query">
            <Search size={13} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={NET_SEARCH_QUERY_MAX_LENGTH} placeholder="Filter knowledge" />
            {query ? <button type="button" onClick={() => setQuery('')}><X size={12} /></button> : null}
          </label>
          <div>
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
            <div className="net-search-control__list-state"><Database /> No knowledge entries match these filters.</div>
          ) : directory.map((entry) => (
            <button key={entry.id} type="button" data-selected={selectedId === entry.id ? 'true' : 'false'} onClick={() => void openEntry(entry.id)}>
              <span><i data-visibility={entry.visibility}>{entry.visibility}</i><i data-lifecycle={lifecycleLabel(entry)}>{lifecycleLabel(entry)}</i></span>
              <strong>{entry.title}</strong>
              <small>{entry.entryType.toUpperCase()} · {formatControlDate(entry.updatedAt)}</small>
            </button>
          ))}
        </div>
      </aside>

      <main className="net-search-control__editor">
        <header className="net-search-control__editor-head">
          <div>
            <span>{selectedId ? 'CANONICAL RECORD' : 'NEW CANONICAL RECORD'}</span>
            <strong>{detail?.title || 'Untitled knowledge entry'}</strong>
          </div>
          <div>
            {detail ? <i data-visibility={detail.visibility}>{detail.visibility.toUpperCase()}</i> : null}
            {selectedLifecycle ? <i data-lifecycle={selectedLifecycle}>{selectedLifecycle}</i> : null}
          </div>
        </header>

        {error ? <div className="net-search-control__error" role="alert"><ShieldAlert size={15} /><span>{error}</span></div> : null}
        {detailLoading ? (
          <div className="net-search-control__editor-state"><LoaderCircle className="net-search-spin" /> Loading canonical record…</div>
        ) : (
          <div className="net-search-control__form">
            <div className="net-search-control__form-row net-search-control__form-row--title">
              <label><span>Title</span><input value={draft.title} onChange={(event) => updateDraft('title', event.target.value)} maxLength={NET_SEARCH_TITLE_MAX_LENGTH} /></label>
              <label><span>Type</span><select value={draft.entryType} onChange={(event) => updateDraft('entryType', event.target.value as NetSearchEntryType)}>{netSearchEntryTypes.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label>
              <label><span>Visibility</span><select value={draft.visibility} onChange={(event) => updateDraft('visibility', event.target.value as NetSearchVisibility)}>{netSearchVisibilities.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label>
            </div>

            <label><span>Summary</span><textarea value={draft.summary} onChange={(event) => updateDraft('summary', event.target.value)} maxLength={NET_SEARCH_SUMMARY_MAX_LENGTH} rows={3} placeholder="Concise verified description shown in search results." /></label>
            <label><span>Canonical content</span><textarea className="net-search-control__content" value={draft.content} onChange={(event) => updateDraft('content', event.target.value)} maxLength={NET_SEARCH_CONTENT_MAX_LENGTH} rows={12} placeholder="Authoritative lore and facts. AI-generated answers are never stored here automatically." /></label>

            <div className="net-search-control__form-row">
              <label><span>Aliases <small>comma separated</small></span><input value={draft.aliases} onChange={(event) => updateDraft('aliases', event.target.value)} maxLength={NET_SEARCH_ALIAS_MAX_LENGTH * 20} /></label>
              <label><span>Tags <small>comma separated</small></span><input value={draft.tags} onChange={(event) => updateDraft('tags', event.target.value)} maxLength={NET_SEARCH_TAG_MAX_LENGTH * 20} /></label>
            </div>

            <div className="net-search-control__form-row">
              <label><span>Available From</span><input type="datetime-local" value={draft.availableFrom} onChange={(event) => updateDraft('availableFrom', event.target.value)} /></label>
              <label><span>Expires At</span><input type="datetime-local" value={draft.expiresAt} onChange={(event) => updateDraft('expiresAt', event.target.value)} /></label>
            </div>

            <label><span>Related references <small>one safe label/reference per line</small></span><textarea value={draft.relatedReferences} onChange={(event) => updateDraft('relatedReferences', event.target.value)} maxLength={NET_SEARCH_REFERENCE_MAX_LENGTH * 20} rows={4} /></label>
          </div>
        )}

        <footer className="net-search-control__actions">
          <div>
            {detail?.status === 'active' ? <button type="button" className="danger" onClick={() => setConfirmAction('archive')} disabled={mutating || dirty}><Archive size={14} /> Archive</button> : null}
            {detail?.status === 'archived' ? <button type="button" onClick={() => setConfirmAction('restore')} disabled={mutating || dirty}><RotateCcw size={14} /> Restore</button> : null}
            {detail ? <button type="button" className="danger" onClick={() => setConfirmAction('delete')} disabled={mutating}><Trash2 size={14} /> Delete</button> : null}
          </div>
          <button type="button" className="primary" onClick={() => void saveEntry()} disabled={mutating || detailLoading || !dirty}>
            {mutating ? <LoaderCircle className="net-search-spin" size={14} /> : <Save size={14} />}
            {selectedId ? 'Save changes' : 'Create entry'}
          </button>
        </footer>
      </main>

      {confirmAction ? (
        <div className="net-search-control__confirm" role="dialog" aria-modal="true" aria-labelledby="net-search-confirm-title">
          <div>
            <ShieldAlert size={24} />
            <h2 id="net-search-confirm-title">
              {confirmAction === 'delete' ? 'Delete this canonical record?' : `${confirmAction === 'archive' ? 'Archive' : 'Restore'} this record?`}
            </h2>
            <p>{confirmAction === 'delete' ? 'This permanently removes the canonical entry. The action remains traceable in the hidden audit ledger.' : 'The player-facing index will immediately follow the new lifecycle state.'}</p>
            <footer><button type="button" onClick={() => setConfirmAction(null)}>Cancel</button><button type="button" className="danger" onClick={() => void applyConfirmedAction()}>Confirm {confirmAction}</button></footer>
          </div>
        </div>
      ) : null}
    </div>
  )
}
