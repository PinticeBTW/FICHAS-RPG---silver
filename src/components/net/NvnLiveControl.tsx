import {
  Archive,
  FilePlus2,
  LoaderCircle,
  Radio,
  RefreshCcw,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Square,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import {
  NET_NVN_LIVE_BYLINE_MAX_LENGTH,
  NET_NVN_LIVE_HEADLINE_MAX_LENGTH,
  NET_NVN_LIVE_LOCATION_MAX_LENGTH,
  NET_NVN_LIVE_SUMMARY_MAX_LENGTH,
  NET_NVN_LIVE_UPDATE_BODY_MAX_LENGTH,
  isNetNvnLiveRequestError,
  netNvnIncidentUpdateKinds,
  netNvnIncidentUpdateVerificationStatuses,
  netNvnIncidentVerificationStatuses,
  type NetNvnGmIncidentDetail,
  type NetNvnGmIncidentInput,
  type NetNvnGmIncidentUpdateInput,
  type NetNvnIncidentLifecycleAction,
  type NetNvnIncidentStatus,
} from '../../lib/netNvnLiveTypes'
import { netNvnCategories } from '../../lib/netNvnTypes'
import { NvnNewsroomConfirmation } from './NvnNewsroomControl'
import {
  NVN_CATEGORY_LABELS,
  formatNvnDateTime,
} from './nvnPresentation'
import type { CompleteNetNvnLocalMutation } from './useNetNvnRealtime'
import { useNetNvnGmLiveControl } from './useNetNvnGmLiveControl'

type DirectoryFilter = 'all' | NetNvnIncidentStatus

interface NvnLiveControlProps {
  readonly enabled: boolean
  readonly realtimeInvalidationVersion: number
  readonly beginLocalMutation: () => CompleteNetNvnLocalMutation
  readonly onDirtyChange: (dirty: boolean) => void
  readonly onNotice: (message: string) => void
}

interface IncidentDraft {
  headline: string
  summary: string
  category: NetNvnGmIncidentInput['category']
  verificationStatus: NetNvnGmIncidentInput['verificationStatus']
  bylineName: string
  bylineRole: string
  districtLabel: string
  locationLabel: string
  occurredAt: string
}

interface ConfirmationState {
  readonly title: string
  readonly body: string
  readonly confirmLabel: string
  readonly tone?: 'standard' | 'danger'
  readonly action: () => void | Promise<void>
}

const EMPTY_DRAFT: IncidentDraft = {
  headline: '',
  summary: '',
  category: 'new-vega',
  verificationStatus: 'developing',
  bylineName: '',
  bylineRole: '',
  districtLabel: '',
  locationLabel: '',
  occurredAt: '',
}

const FILTER_LABELS: Record<DirectoryFilter, string> = {
  all: 'All',
  draft: 'Draft',
  live: 'Live',
  closed: 'Closed',
  archived: 'Archived',
}

const INCIDENT_VERIFICATION_LABELS = {
  developing: 'Developing',
  verified: 'Verified',
  'multiple-sources': 'Multiple sources',
  'official-statement': 'Official statement',
  unconfirmed: 'Unconfirmed',
} as const

const UPDATE_KIND_LABELS = {
  update: 'Update',
  confirmation: 'Confirmation',
  warning: 'Warning',
  correction: 'Correction',
} as const

const UPDATE_VERIFICATION_LABELS = {
  confirmed: 'Confirmed',
  developing: 'Developing',
  unconfirmed: 'Unconfirmed',
} as const

function optional(value: string): string | undefined {
  return value.trim() || undefined
}

function toDateTimeLocal(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function draftFromDetail(detail: NetNvnGmIncidentDetail): IncidentDraft {
  return {
    headline: detail.headline,
    summary: detail.summary ?? '',
    category: detail.category,
    verificationStatus: detail.verificationStatus,
    bylineName: detail.bylineName,
    bylineRole: detail.bylineRole ?? '',
    districtLabel: detail.districtLabel ?? '',
    locationLabel: detail.locationLabel ?? '',
    occurredAt: toDateTimeLocal(detail.occurredAt),
  }
}

function serializeDraft(draft: IncidentDraft): string {
  return JSON.stringify(draft)
}

function inputFromDraft(draft: IncidentDraft): NetNvnGmIncidentInput {
  const headline = draft.headline.trim()
  const bylineName = draft.bylineName.trim()
  if (!headline) throw new Error('Incident headline is required.')
  if (!bylineName) throw new Error('Newsroom byline is required.')
  let occurredAt: string | undefined
  if (draft.occurredAt) {
    const parsed = new Date(draft.occurredAt)
    if (Number.isNaN(parsed.getTime())) throw new Error('Occurrence time is invalid.')
    occurredAt = parsed.toISOString()
  }
  return {
    headline,
    ...(optional(draft.summary) ? { summary: optional(draft.summary) } : {}),
    category: draft.category,
    verificationStatus: draft.verificationStatus,
    bylineName,
    ...(optional(draft.bylineRole) ? { bylineRole: optional(draft.bylineRole) } : {}),
    ...(optional(draft.districtLabel) ? { districtLabel: optional(draft.districtLabel) } : {}),
    ...(optional(draft.locationLabel) ? { locationLabel: optional(draft.locationLabel) } : {}),
    ...(occurredAt ? { occurredAt } : {}),
  }
}

function friendlyError(error: unknown): string {
  if (isNetNvnLiveRequestError(error)) return error.message
  if (error instanceof Error) return error.message
  return 'The LIVE newsroom could not confirm that operation.'
}

function Field({ label, wide = false, children }: {
  readonly label: string
  readonly wide?: boolean
  readonly children: ReactNode
}) {
  return (
    <label className="nvn-newsroom-field" data-wide={wide ? 'true' : undefined}>
      <span>{label}</span>
      {children}
    </label>
  )
}

export function NvnLiveControl({
  enabled,
  realtimeInvalidationVersion,
  beginLocalMutation,
  onDirtyChange,
  onNotice,
}: NvnLiveControlProps) {
  const control = useNetNvnGmLiveControl(enabled)
  const [directoryFilter, setDirectoryFilter] = useState<DirectoryFilter>('all')
  const [isNew, setIsNew] = useState(false)
  const [draft, setDraft] = useState<IncidentDraft>(EMPTY_DRAFT)
  const [baseline, setBaseline] = useState(serializeDraft(EMPTY_DRAFT))
  const [baselineServerUpdatedAt, setBaselineServerUpdatedAt] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null)
  const [updateDraft, setUpdateDraft] = useState<NetNvnGmIncidentUpdateInput>({
    updateKind: 'update',
    verificationStatus: 'developing',
    body: '',
  })
  const dirtyRef = useRef(false)
  const realtimeVersionRef = useRef(realtimeInvalidationVersion)
  const reconciledVersionRef = useRef(0)

  const dirty = (isNew || Boolean(control.selectedIncidentId))
    && serializeDraft(draft) !== baseline

  useEffect(() => {
    dirtyRef.current = dirty
    realtimeVersionRef.current = realtimeInvalidationVersion
  }, [dirty, realtimeInvalidationVersion])

  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    if (!enabled || realtimeInvalidationVersion <= reconciledVersionRef.current) return
    const expectedVersion = realtimeInvalidationVersion
    reconciledVersionRef.current = expectedVersion
    void control.loadDirectory(true)
    if (isNew || !control.selectedIncidentId) return
    void control.refreshSelectedIncident().then((loaded) => {
      if (!loaded || realtimeVersionRef.current !== expectedVersion || dirtyRef.current) return
      const next = draftFromDetail(loaded)
      setDraft(next)
      setBaseline(serializeDraft(next))
      setBaselineServerUpdatedAt(loaded.updatedAt)
      setFormError(null)
    })
  }, [
    control,
    enabled,
    isNew,
    realtimeInvalidationVersion,
  ])

  const filteredDirectory = useMemo(
    () => control.directory.filter((incident) =>
      directoryFilter === 'all' || incident.status === directoryFilter),
    [control.directory, directoryFilter],
  )

  const setDraftField = <Key extends keyof IncidentDraft>(
    key: Key,
    value: IncidentDraft[Key],
  ) => setDraft((current) => ({ ...current, [key]: value }))

  const applyDetail = (detail: NetNvnGmIncidentDetail) => {
    const next = draftFromDetail(detail)
    setIsNew(false)
    setDraft(next)
    setBaseline(serializeDraft(next))
    setBaselineServerUpdatedAt(detail.updatedAt)
    setFormError(null)
  }

  const startNew = () => {
    const apply = () => {
      control.clearSelection()
      setIsNew(true)
      setDraft({ ...EMPTY_DRAFT })
      setBaseline(serializeDraft(EMPTY_DRAFT))
      setBaselineServerUpdatedAt(null)
      setUpdateDraft({ updateKind: 'update', verificationStatus: 'developing', body: '' })
      setFormError(null)
      setConfirmation(null)
    }
    if (!dirty) return apply()
    setConfirmation({
      title: 'Discard unsaved LIVE edits?',
      body: 'The current local metadata has not been written to the authoritative incident record.',
      confirmLabel: 'Discard changes',
      tone: 'danger',
      action: apply,
    })
  }

  const selectIncident = (incidentId: string) => {
    const apply = async () => {
      setIsNew(false)
      setFormError(null)
      setUpdateDraft({ updateKind: 'update', verificationStatus: 'developing', body: '' })
      setConfirmation(null)
      const loaded = await control.selectIncident(incidentId)
      if (loaded) applyDetail(loaded)
    }
    if (!dirty) void apply()
    else {
      setConfirmation({
        title: 'Leave unsaved incident?',
        body: 'Switching LIVE records will discard the current local metadata edits.',
        confirmLabel: 'Switch incident',
        tone: 'danger',
        action: apply,
      })
    }
  }

  const saveIncident = async () => {
    setFormError(null)
    const completeLocalMutation = beginLocalMutation()
    try {
      const input = inputFromDraft(draft)
      const creating = isNew
      const previousUpdatedAt = control.detail?.updatedAt
      const saved = creating
        ? await control.createIncident(input)
        : await control.updateIncident(control.selectedIncidentId!, input)
      completeLocalMutation(creating || saved.updatedAt !== previousUpdatedAt)
      applyDetail(saved)
      onNotice(creating ? 'NVN // LIVE INCIDENT DRAFT CREATED' : 'NVN // LIVE METADATA SAVED')
    } catch (error) {
      completeLocalMutation(false)
      setFormError(friendlyError(error))
    }
  }

  const lifecycleCopy: Record<NetNvnIncidentLifecycleAction, Omit<ConfirmationState, 'action'>> = {
    start: {
      title: 'Start live coverage?',
      body: 'This incident will become the one active NVN LIVE desk visible to authenticated readers.',
      confirmLabel: 'Start LIVE',
    },
    close: {
      title: 'Close live coverage?',
      body: 'The active desk will disappear from player LIVE. Its append-only ledger remains in Newsroom Control.',
      confirmLabel: 'Close coverage',
      tone: 'danger',
    },
    archive: {
      title: 'Archive closed incident?',
      body: 'The closed incident remains recoverable in the editorial directory.',
      confirmLabel: 'Archive incident',
    },
    restore: {
      title: 'Restore archived incident?',
      body: 'The incident will return to Closed. It will not resume LIVE coverage.',
      confirmLabel: 'Restore to closed',
    },
  }

  const requestLifecycle = (action: NetNvnIncidentLifecycleAction) => {
    if (!control.selectedIncidentId || isNew) return
    if (dirty) {
      setFormError('Save or discard metadata edits before changing the LIVE lifecycle.')
      return
    }
    setConfirmation({
      ...lifecycleCopy[action],
      action: async () => {
        setConfirmation(null)
        setFormError(null)
        const completeLocalMutation = beginLocalMutation()
        try {
          const saved = await control.setLifecycle(control.selectedIncidentId!, action)
          completeLocalMutation(true)
          applyDetail(saved)
          onNotice(`NVN // LIVE ${action.toUpperCase()} CONFIRMED`)
        } catch (error) {
          completeLocalMutation(false)
          setFormError(friendlyError(error))
        }
      },
    })
  }

  const appendUpdate = async () => {
    if (!control.selectedIncidentId || control.detail?.status !== 'live') return
    const completeLocalMutation = beginLocalMutation()
    setFormError(null)
    try {
      const body = updateDraft.body.trim()
      if (!body) throw new Error('Update body is required.')
      const saved = await control.appendUpdate(control.selectedIncidentId, {
        ...updateDraft,
        body,
      })
      completeLocalMutation(true)
      setUpdateDraft((current) => ({ ...current, body: '' }))
      setBaselineServerUpdatedAt(saved.updatedAt)
      onNotice(`NVN // LIVE UPDATE #${saved.updates.length} APPENDED`)
    } catch (error) {
      completeLocalMutation(false)
      setFormError(friendlyError(error))
    }
  }

  const selectedDirectoryIncident = control.directory.find(
    (incident) => incident.id === control.selectedIncidentId,
  )
  const serverChangedWhileDirty = Boolean(
    dirty
    && selectedDirectoryIncident
    && baselineServerUpdatedAt
    && selectedDirectoryIncident.updatedAt !== baselineServerUpdatedAt,
  )
  const showEditor = isNew || Boolean(control.selectedIncidentId)
  const currentStatus = isNew ? 'draft' : control.detail?.status

  return (
    <section className="nvn-live-control" aria-label="NVN Live Control">
      <aside className="nvn-newsroom-directory nvn-live-control__directory">
        <header>
          <div><Radio size={15} aria-hidden="true" /><strong>Live Control</strong></div>
          <button type="button" onClick={() => void control.loadDirectory(true)} aria-label="Refresh incident directory">
            <RefreshCcw size={14} aria-hidden="true" />
          </button>
        </header>
        <button type="button" className="nvn-newsroom-new" onClick={startNew}>
          <FilePlus2 size={14} aria-hidden="true" /> New incident
        </button>
        <div className="nvn-live-control__filters" aria-label="Incident lifecycle filter">
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
              <span>Syncing incident index</span>
            </div>
          ) : control.directoryError && control.directory.length === 0 ? (
            <div className="nvn-newsroom-directory__state" data-error="true">
              <span>{control.directoryError}</span>
              <button type="button" onClick={() => void control.loadDirectory()}>Retry</button>
            </div>
          ) : filteredDirectory.length === 0 ? (
            <div className="nvn-newsroom-directory__state">
              <span>{control.directory.length === 0 ? 'No incidents. Create the first approved LIVE draft.' : `No ${FILTER_LABELS[directoryFilter].toLowerCase()} incidents.`}</span>
            </div>
          ) : filteredDirectory.map((incident) => (
            <button
              key={incident.id}
              type="button"
              className="nvn-newsroom-directory__row"
              data-active={!isNew && control.selectedIncidentId === incident.id ? 'true' : undefined}
              onClick={() => selectIncident(incident.id)}
            >
              <span>
                <strong>{incident.headline}</strong>
                <small>{incident.updateCount} updates · {NVN_CATEGORY_LABELS[incident.category]}</small>
              </span>
              <em data-status={incident.status}>{incident.status}</em>
            </button>
          ))}
        </div>
      </aside>

      <main className="nvn-live-control__editor">
        {!showEditor ? (
          <div className="nvn-newsroom-welcome">
            <Radio size={22} aria-hidden="true" />
            <h2>No incident selected</h2>
            <p>Select a newsroom incident or create the first approved LIVE draft.</p>
            <button type="button" onClick={startNew}><FilePlus2 size={14} aria-hidden="true" /> New incident</button>
          </div>
        ) : control.detailPhase === 'loading' && !isNew ? (
          <div className="nvn-newsroom-welcome" role="status">
            <LoaderCircle className="nvn-reader-feedback__spinner" size={22} aria-hidden="true" />
            <h2>Opening incident record</h2>
            <p>Retrieving the authoritative metadata and bounded ledger.</p>
          </div>
        ) : control.detailPhase === 'failed' && !isNew ? (
          <div className="nvn-newsroom-welcome" role="alert">
            <h2>Incident unavailable</h2>
            <p>{control.detailError}</p>
            <button type="button" onClick={() => control.selectedIncidentId && selectIncident(control.selectedIncidentId)}>
              <RefreshCcw size={14} aria-hidden="true" /> Retry
            </button>
          </div>
        ) : (
          <form className="nvn-live-control__form" onSubmit={(event) => {
            event.preventDefault()
            void saveIncident()
          }}>
            <header className="nvn-newsroom-form__header">
              <div>
                <h2>{isNew ? 'New live incident' : draft.headline || 'Untitled incident'}</h2>
                <span data-dirty={dirty ? 'true' : undefined}>
                  {dirty ? 'Unsaved changes' : currentStatus ?? 'Draft'}
                </span>
              </div>
              <button type="submit" disabled={control.isMutating || !dirty || !draft.headline.trim() || !draft.bylineName.trim()}>
                {control.isMutating ? <LoaderCircle className="nvn-reader-feedback__spinner" size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
                {isNew ? 'Save draft' : 'Save metadata'}
              </button>
            </header>

            {formError ? <p className="nvn-newsroom-error" role="alert">{formError}</p> : null}
            {serverChangedWhileDirty ? (
              <p className="nvn-live__notice nvn-newsroom-stale" role="status">
                <RefreshCcw size={14} aria-hidden="true" />
                Another newsroom session changed this incident. Your local metadata edits were preserved; the ledger has still synchronized.
              </p>
            ) : null}
            {control.detailError && control.detailPhase === 'ready' ? (
              <p className="nvn-live__notice nvn-newsroom-stale" role="status">{control.detailError}</p>
            ) : null}

            <div className="nvn-newsroom-form__fields">
              <Field label="Headline" wide>
                <input required maxLength={NET_NVN_LIVE_HEADLINE_MAX_LENGTH} value={draft.headline} onChange={(event) => setDraftField('headline', event.target.value)} />
              </Field>
              <Field label="Summary" wide>
                <textarea maxLength={NET_NVN_LIVE_SUMMARY_MAX_LENGTH} value={draft.summary} onChange={(event) => setDraftField('summary', event.target.value)} />
              </Field>
              <Field label="Category">
                <select value={draft.category} onChange={(event) => setDraftField('category', event.target.value as IncidentDraft['category'])}>
                  {netNvnCategories.map((category) => <option key={category} value={category}>{NVN_CATEGORY_LABELS[category]}</option>)}
                </select>
              </Field>
              <Field label="Verification">
                <select value={draft.verificationStatus} onChange={(event) => setDraftField('verificationStatus', event.target.value as IncidentDraft['verificationStatus'])}>
                  {netNvnIncidentVerificationStatuses.map((status) => <option key={status} value={status}>{INCIDENT_VERIFICATION_LABELS[status]}</option>)}
                </select>
              </Field>
              <Field label="Byline name">
                <input required maxLength={NET_NVN_LIVE_BYLINE_MAX_LENGTH} value={draft.bylineName} onChange={(event) => setDraftField('bylineName', event.target.value)} />
              </Field>
              <Field label="Byline role">
                <input maxLength={NET_NVN_LIVE_BYLINE_MAX_LENGTH} value={draft.bylineRole} onChange={(event) => setDraftField('bylineRole', event.target.value)} />
              </Field>
              <Field label="District">
                <input maxLength={NET_NVN_LIVE_LOCATION_MAX_LENGTH} value={draft.districtLabel} onChange={(event) => setDraftField('districtLabel', event.target.value)} />
              </Field>
              <Field label="Location">
                <input maxLength={NET_NVN_LIVE_LOCATION_MAX_LENGTH} value={draft.locationLabel} onChange={(event) => setDraftField('locationLabel', event.target.value)} />
              </Field>
              <Field label="Occurred at">
                <input type="datetime-local" value={draft.occurredAt} onChange={(event) => setDraftField('occurredAt', event.target.value)} />
              </Field>
            </div>
          </form>
        )}
      </main>

      <aside className="nvn-live-control__ledger">
        <header>
          <div>
            <ShieldCheck size={15} aria-hidden="true" />
            <strong>{currentStatus === 'live' ? 'Live now' : 'Incident ledger'}</strong>
          </div>
          {control.detail ? <span>{control.detail.updates.length} / 100</span> : null}
        </header>

        {control.detail ? (
          <>
            <section className="nvn-live-control__lifecycle">
              <strong>{control.detail.status}</strong>
              {control.detail.status === 'draft' ? (
                <button type="button" onClick={() => requestLifecycle('start')} disabled={dirty || control.isMutating}>
                  <Radio size={14} aria-hidden="true" /> Start live coverage
                </button>
              ) : null}
              {control.detail.status === 'live' ? (
                <button type="button" data-tone="danger" onClick={() => requestLifecycle('close')} disabled={dirty || control.isMutating}>
                  <Square size={13} aria-hidden="true" /> Close coverage
                </button>
              ) : null}
              {control.detail.status === 'closed' ? (
                <button type="button" onClick={() => requestLifecycle('archive')} disabled={dirty || control.isMutating}>
                  <Archive size={14} aria-hidden="true" /> Archive incident
                </button>
              ) : null}
              {control.detail.status === 'archived' ? (
                <button type="button" onClick={() => requestLifecycle('restore')} disabled={dirty || control.isMutating}>
                  <RotateCcw size={14} aria-hidden="true" /> Restore to closed
                </button>
              ) : null}
              <dl>
                <div><dt>Updated</dt><dd>{formatNvnDateTime(control.detail.updatedAt)}</dd></div>
                {control.detail.startedAt ? <div><dt>Started</dt><dd>{formatNvnDateTime(control.detail.startedAt)}</dd></div> : null}
                {control.detail.closedAt ? <div><dt>Closed</dt><dd>{formatNvnDateTime(control.detail.closedAt)}</dd></div> : null}
              </dl>
            </section>

            {control.detail.status === 'live' ? (
              <form className="nvn-live-control__composer" onSubmit={(event) => {
                event.preventDefault()
                void appendUpdate()
              }}>
                <h3>Append newsroom update</h3>
                <div>
                  <select value={updateDraft.updateKind} onChange={(event) => setUpdateDraft((current) => ({ ...current, updateKind: event.target.value as NetNvnGmIncidentUpdateInput['updateKind'] }))} aria-label="Update kind">
                    {netNvnIncidentUpdateKinds.map((kind) => <option key={kind} value={kind}>{UPDATE_KIND_LABELS[kind]}</option>)}
                  </select>
                  <select value={updateDraft.verificationStatus} onChange={(event) => setUpdateDraft((current) => ({ ...current, verificationStatus: event.target.value as NetNvnGmIncidentUpdateInput['verificationStatus'] }))} aria-label="Update verification">
                    {netNvnIncidentUpdateVerificationStatuses.map((status) => <option key={status} value={status}>{UPDATE_VERIFICATION_LABELS[status]}</option>)}
                  </select>
                </div>
                <textarea required maxLength={NET_NVN_LIVE_UPDATE_BODY_MAX_LENGTH} value={updateDraft.body} onChange={(event) => setUpdateDraft((current) => ({ ...current, body: event.target.value }))} placeholder="File the next verified newsroom update…" />
                <button type="submit" disabled={control.isMutating || !updateDraft.body.trim()}>
                  <Send size={14} aria-hidden="true" /> Append update
                </button>
              </form>
            ) : (
              <p className="nvn-live-control__ledger-note">
                {control.detail.status === 'draft'
                  ? 'Start coverage before appending to the immutable ledger.'
                  : 'This ledger is closed. Corrections can only be appended while coverage is LIVE.'}
              </p>
            )}

            <ol className="nvn-live-control__updates">
              {control.detail.updates.length === 0 ? (
                <li className="nvn-live-control__updates-empty">No updates filed.</li>
              ) : control.detail.updates.map((update) => (
                <li key={update.id} data-kind={update.updateKind}>
                  <header><strong>#{update.sequence} · {UPDATE_KIND_LABELS[update.updateKind]}</strong><time dateTime={update.publishedAt}>{formatNvnDateTime(update.publishedAt)}</time></header>
                  <span>{UPDATE_VERIFICATION_LABELS[update.verificationStatus]}</span>
                  <p>{update.body}</p>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <div className="nvn-newsroom-preview__empty">
            <Radio size={18} aria-hidden="true" />
            <p>Lifecycle and append-only updates appear after a saved incident is selected.</p>
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
