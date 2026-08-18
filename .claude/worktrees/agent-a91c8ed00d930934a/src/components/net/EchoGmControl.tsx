import {
  Archive,
  Eye,
  EyeOff,
  Link2,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  Plus,
  RefreshCcw,
  RotateCcw,
  Save,
  ShieldCheck,
  Unlink,
  Users,
  X,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'

import {
  NET_ECHO_BODY_MAX_LENGTH,
  NET_ECHO_LOCKED_TEASER_MAX_LENGTH,
  NET_ECHO_SUMMARY_MAX_LENGTH,
  NET_ECHO_TITLE_MAX_LENGTH,
  isNetEchoPrerequisiteRequiredError,
  netEchoIntensities,
  netEchoRelationshipKinds,
  netEchoReliabilities,
  netEchoSignalKinds,
  netEchoSignalStatuses,
  netEchoVisibilityModes,
  type NetEchoGmSignalDetail,
  type NetEchoGmSignalInput,
  type NetEchoRelationshipKind,
  type NetEchoSignalStatus,
} from '../../lib/netEchoTypes'
import { SharedMediaImage } from '../shared/SharedMediaImage'
import { useNetDialog } from './netDialogStack'
import { useNetEchoGmControl } from './useNetEchoGmControl'

type DirectoryFilter = 'all' | NetEchoSignalStatus

interface EchoGmControlProps {
  readonly enabled: boolean
  readonly onDirtyChange: (dirty: boolean) => void
  readonly onNotice: (message: string) => void
}

interface EchoGmDraft {
  kind: NetEchoGmSignalInput['kind']
  visibilityMode: NetEchoGmSignalInput['visibilityMode']
  title: string
  summary: string
  body: string
  reliability: NetEchoGmSignalInput['reliability']
  intensity: NetEchoGmSignalInput['intensity']
  frequencies: string
  mapX: string
  mapY: string
  integrityPercent: string
  lockedTeaser: string
  sourceLabel: string
  locationLabel: string
  districtLabel: string
  occurredAt: string
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

const EMPTY_DRAFT: EchoGmDraft = {
  kind: 'fragment',
  visibilityMode: 'global',
  title: '',
  summary: '',
  body: '',
  reliability: 'unknown',
  intensity: 'medium',
  frequencies: '',
  mapX: '50',
  mapY: '50',
  integrityPercent: '',
  lockedTeaser: '',
  sourceLabel: '',
  locationLabel: '',
  districtLabel: '',
  occurredAt: '',
  referenceAppId: '',
  referenceResourceKind: '',
  referenceResourceId: '',
}

const KIND_LABELS: Record<NetEchoGmSignalInput['kind'], string> = {
  fragment: 'Fragment',
  transmission: 'Transmission',
  rumor: 'Rumor',
  incident: 'Incident',
  'location-trace': 'Location trace',
  'leaked-record': 'Leaked record',
  'memory-fragment': 'Memory fragment',
  'identity-clue': 'Identity clue',
  'faction-activity': 'Faction activity',
  dead: 'Dead signal',
  corrupted: 'Corrupted signal',
  encrypted: 'Encrypted signal',
}

const RELATIONSHIP_LABELS: Record<NetEchoRelationshipKind, string> = {
  related: 'Related to',
  supports: 'Supports',
  contradicts: 'Contradicts',
  origin: 'Originates from',
  requires: 'Unlock after',
}

function inputValue(value: string | undefined): string {
  return value ?? ''
}

function toDateTimeLocal(value: string | undefined): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  const offset = parsed.getTimezoneOffset() * 60_000
  return new Date(parsed.getTime() - offset).toISOString().slice(0, 16)
}

function draftFromDetail(detail: NetEchoGmSignalDetail): EchoGmDraft {
  return {
    kind: detail.kind,
    visibilityMode: detail.visibilityMode,
    title: detail.title,
    summary: inputValue(detail.summary),
    body: detail.body,
    reliability: detail.reliability,
    intensity: detail.intensity,
    frequencies: detail.frequencies.join(', '),
    mapX: String(detail.mapX),
    mapY: String(detail.mapY),
    integrityPercent: detail.integrityPercent === undefined ? '' : String(detail.integrityPercent),
    lockedTeaser: inputValue(detail.lockedTeaser),
    sourceLabel: inputValue(detail.sourceLabel),
    locationLabel: inputValue(detail.locationLabel),
    districtLabel: inputValue(detail.districtLabel),
    occurredAt: toDateTimeLocal(detail.occurredAt),
    referenceAppId: inputValue(detail.primaryReference?.appId),
    referenceResourceKind: inputValue(detail.primaryReference?.resourceKind),
    referenceResourceId: inputValue(detail.primaryReference?.resourceId),
  }
}

function serializeDraft(draft: EchoGmDraft): string {
  return JSON.stringify(draft)
}

function cleanOptional(value: string): string | undefined {
  const clean = value.trim()
  return clean || undefined
}

function buildSignalInput(draft: EchoGmDraft): NetEchoGmSignalInput {
  const title = draft.title.trim()
  const summary = cleanOptional(draft.summary)
  const body = draft.body.trim()
  const lockedTeaser = draft.visibilityMode === 'prerequisite'
    ? cleanOptional(draft.lockedTeaser)
    : undefined
  if (!title || title.length > NET_ECHO_TITLE_MAX_LENGTH) {
    throw new Error(`Title must contain 1–${NET_ECHO_TITLE_MAX_LENGTH} characters.`)
  }
  if (summary && summary.length > NET_ECHO_SUMMARY_MAX_LENGTH) {
    throw new Error(`Summary is limited to ${NET_ECHO_SUMMARY_MAX_LENGTH} characters.`)
  }
  if (!body || body.length > NET_ECHO_BODY_MAX_LENGTH) {
    throw new Error(`Body must contain 1–${NET_ECHO_BODY_MAX_LENGTH} characters.`)
  }
  if (lockedTeaser && lockedTeaser.length > NET_ECHO_LOCKED_TEASER_MAX_LENGTH) {
    throw new Error(`Locked teaser is limited to ${NET_ECHO_LOCKED_TEASER_MAX_LENGTH} characters.`)
  }

  const frequencies = [...new Set(draft.frequencies
    .split(',')
    .map((frequency) => frequency.trim().toLowerCase())
    .filter(Boolean))]
  if (frequencies.length > 10 || frequencies.some((frequency) => frequency.length > 32)) {
    throw new Error('Use at most 10 frequencies of 32 characters each.')
  }

  const mapX = Number(draft.mapX)
  const mapY = Number(draft.mapY)
  if (!Number.isFinite(mapX) || mapX < 0 || mapX > 100
    || !Number.isFinite(mapY) || mapY < 0 || mapY > 100) {
    throw new Error('Map X and Y must be between 0 and 100.')
  }
  const integrityPercent = draft.integrityPercent.trim() === ''
    ? undefined
    : Number(draft.integrityPercent)
  if (integrityPercent !== undefined
    && (!Number.isInteger(integrityPercent) || integrityPercent < 0 || integrityPercent > 100)) {
    throw new Error('Integrity must be a whole number between 0 and 100.')
  }

  const occurredAt = draft.occurredAt
    ? new Date(draft.occurredAt).toISOString()
    : undefined
  const referenceParts = [
    draft.referenceAppId.trim(),
    draft.referenceResourceKind.trim(),
    draft.referenceResourceId.trim(),
  ]
  const hasAnyReference = referenceParts.some(Boolean)
  const hasFullReference = referenceParts.every(Boolean)
  if (hasAnyReference && !hasFullReference) {
    throw new Error('Cross-app references require app, resource kind, and resource id.')
  }

  return {
    kind: draft.kind,
    visibilityMode: draft.visibilityMode,
    title,
    ...(summary ? { summary } : {}),
    body,
    reliability: draft.reliability,
    intensity: draft.intensity,
    frequencies,
    mapX,
    mapY,
    ...(integrityPercent === undefined ? {} : { integrityPercent }),
    ...(lockedTeaser ? { lockedTeaser } : {}),
    ...(cleanOptional(draft.sourceLabel) ? { sourceLabel: cleanOptional(draft.sourceLabel) } : {}),
    ...(cleanOptional(draft.locationLabel) ? { locationLabel: cleanOptional(draft.locationLabel) } : {}),
    ...(cleanOptional(draft.districtLabel) ? { districtLabel: cleanOptional(draft.districtLabel) } : {}),
    ...(occurredAt ? { occurredAt } : {}),
    ...(hasFullReference
      ? {
          primaryReference: {
            appId: referenceParts[0]!.toLowerCase(),
            resourceKind: referenceParts[1]!.toLowerCase(),
            resourceId: referenceParts[2]!,
          },
        }
      : {}),
  }
}

function friendlyError(error: unknown): string {
  if (isNetEchoPrerequisiteRequiredError(error)) return error.message
  if (error instanceof Error) {
    const separator = error.message.indexOf(': ')
    return separator >= 0 ? error.message.slice(separator + 2) : error.message
  }
  return 'ECHO could not confirm that editorial operation.'
}

function Field({ label, hint, children }: {
  readonly label: string
  readonly hint?: string
  readonly children: ReactNode
}) {
  return (
    <label className="net-echo-gm-field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  )
}

export function EchoGmConfirmation({
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
    <div className="net-echo-gm-dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel()
    }}>
      <div
        className="net-echo-gm-dialog"
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="echo-gm-confirm-title"
        tabIndex={-1}
        onFocusCapture={onFocusCapture}
      >
        <header>
          <div>
            <span>EDITORIAL AUTHORITY</span>
            <strong id="echo-gm-confirm-title">{title}</strong>
          </div>
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

export function EchoGmControl({ enabled, onDirtyChange, onNotice }: EchoGmControlProps) {
  const control = useNetEchoGmControl(enabled)
  const [directoryFilter, setDirectoryFilter] = useState<DirectoryFilter>('all')
  const [isNew, setIsNew] = useState(false)
  const [draft, setDraft] = useState<EchoGmDraft>(EMPTY_DRAFT)
  const [baseline, setBaseline] = useState(serializeDraft(EMPTY_DRAFT))
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null)
  const [nextLinkTargetId, setNextLinkTargetId] = useState('')
  const [nextRelationshipKind, setNextRelationshipKind] = useState<NetEchoRelationshipKind>('related')
  const [nextLinkLabel, setNextLinkLabel] = useState('')

  const dirty = (isNew || Boolean(control.selectedSignalId))
    && serializeDraft(draft) !== baseline

  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
  }, [dirty, onDirtyChange])

  const filteredDirectory = useMemo(
    () => control.directory.filter((signal) =>
      directoryFilter === 'all' || signal.status === directoryFilter),
    [control.directory, directoryFilter],
  )

  const currentDetail = !isNew ? control.detail : null
  const outgoingLinks = currentDetail?.links.filter((link) =>
    link.fromSignalId === currentDetail.id) ?? []
  const incomingLinks = currentDetail?.links.filter((link) =>
    link.toSignalId === currentDetail.id) ?? []
  const prerequisiteCount = outgoingLinks.filter((link) =>
    link.relationshipKind === 'requires').length

  const startNew = () => {
    const apply = () => {
      control.clearSelection()
      setIsNew(true)
      setDraft({ ...EMPTY_DRAFT })
      setBaseline(serializeDraft(EMPTY_DRAFT))
      setFormError(null)
      setConfirmation(null)
    }
    if (!dirty) {
      apply()
      return
    }
    setConfirmation({
      title: 'Discard unsaved signal edits?',
      body: 'The current local draft has not been written to the authoritative ECHO record.',
      confirmLabel: 'Discard edits',
      tone: 'danger',
      action: apply,
    })
  }

  const selectSignal = (signalId: string) => {
    if (!isNew && control.selectedSignalId === signalId) return
    const apply = async () => {
      setIsNew(false)
      setFormError(null)
      setConfirmation(null)
      const selected = await control.selectSignal(signalId)
      if (!selected) return
      const next = draftFromDetail(selected)
      setDraft(next)
      setBaseline(serializeDraft(next))
    }
    if (!dirty) {
      void apply()
      return
    }
    setConfirmation({
      title: 'Discard unsaved signal edits?',
      body: 'Switching records now will discard the current local editor changes.',
      confirmLabel: 'Switch signal',
      tone: 'danger',
      action: apply,
    })
  }

  const saveSignal = async () => {
    setFormError(null)
    try {
      const input = buildSignalInput(draft)
      const saved = isNew
        ? await control.createSignal(input)
        : control.selectedSignalId
          ? await control.updateSignal(control.selectedSignalId, input)
          : null
      if (!saved) return
      const next = draftFromDetail(saved)
      setIsNew(false)
      setDraft(next)
      setBaseline(serializeDraft(next))
      onNotice(isNew ? 'ECHO // DRAFT SIGNAL CREATED' : 'ECHO // SIGNAL UPDATED')
    } catch (error) {
      setFormError(friendlyError(error))
    }
  }

  const requestLifecycle = (status: NetEchoSignalStatus) => {
    if (!currentDetail || dirty) return
    const copy = status === 'revealed'
      ? {
          title: 'Reveal this signal?',
          body: 'The server will expose it only to players who satisfy its configured visibility rules.',
          confirmLabel: 'Reveal signal',
        }
      : status === 'draft'
        ? {
            title: currentDetail.status === 'archived' ? 'Restore this signal?' : 'Return signal to draft?',
            body: currentDetail.status === 'archived'
              ? 'The record returns to an editable draft and remains absent from player maps.'
              : 'Players will lose map/detail access after their next refresh. Private history is retained.',
            confirmLabel: currentDetail.status === 'archived' ? 'Restore draft' : 'Hide signal',
          }
        : {
            title: 'Archive this signal?',
            body: 'The record remains recoverable to the GM but disappears from normal player maps.',
            confirmLabel: 'Archive signal',
          }
    setConfirmation({
      ...copy,
      tone: status === 'revealed' ? 'standard' : 'danger',
      action: async () => {
        setConfirmation(null)
        setFormError(null)
        try {
          await control.setLifecycle(currentDetail.id, status)
          onNotice(`ECHO // SIGNAL ${status.toUpperCase()}`)
        } catch (error) {
          setFormError(friendlyError(error))
        }
      },
    })
  }

  const addLink = async () => {
    if (!currentDetail || !nextLinkTargetId) return
    setFormError(null)
    try {
      await control.setLink({
        fromSignalId: currentDetail.id,
        toSignalId: nextLinkTargetId,
        relationshipKind: nextRelationshipKind,
        ...(cleanOptional(nextLinkLabel) ? { label: cleanOptional(nextLinkLabel) } : {}),
        desiredLinked: true,
      })
      setNextLinkTargetId('')
      setNextLinkLabel('')
      onNotice('ECHO // SIGNAL LINK CONFIRMED')
    } catch (error) {
      setFormError(friendlyError(error))
    }
  }

  const removeLink = async (
    toSignalId: string,
    relationshipKind: NetEchoRelationshipKind,
  ) => {
    if (!currentDetail) return
    setFormError(null)
    try {
      await control.setLink({
        fromSignalId: currentDetail.id,
        toSignalId,
        relationshipKind,
        desiredLinked: false,
      })
      onNotice('ECHO // SIGNAL LINK REMOVED')
    } catch (error) {
      setFormError(friendlyError(error))
    }
  }

  const setDraftField = <K extends keyof EchoGmDraft>(key: K, value: EchoGmDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const positionMapNode = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = Math.min(Math.max(((event.clientX - bounds.left) / bounds.width) * 100, 0), 100)
    const y = Math.min(Math.max(((event.clientY - bounds.top) / bounds.height) * 100, 0), 100)
    setDraft((current) => ({ ...current, mapX: x.toFixed(1), mapY: y.toFixed(1) }))
  }

  const hasEditor = isNew || control.detailPhase === 'ready'
  const projectionCopy = currentDetail?.status === 'revealed'
    ? 'CURRENT PLAYER PROJECTION'
    : 'PLAYER PROJECTION AFTER REVEAL'

  return (
    <section className="net-echo-gm-control" aria-label="ECHO GM signal control">
      <aside className="net-echo-gm-directory">
        <header>
          <div>
            <span>AUTHORITATIVE GM</span>
            <h2>SIGNAL CONTROL</h2>
          </div>
          <button type="button" aria-label="Refresh signal directory" onClick={() => void control.loadDirectory(true)}>
            <RefreshCcw size={14} aria-hidden="true" />
          </button>
        </header>

        <button className="net-echo-gm-new" type="button" onClick={startNew}>
          <Plus size={14} aria-hidden="true" />
          New signal
        </button>

        <div className="net-echo-gm-filters" role="tablist" aria-label="Signal lifecycle filter">
          {(['all', ...netEchoSignalStatuses] as const).map((status) => (
            <button
              key={status}
              type="button"
              role="tab"
              aria-selected={directoryFilter === status}
              data-active={directoryFilter === status ? 'true' : 'false'}
              onClick={() => setDirectoryFilter(status)}
            >
              {status}
            </button>
          ))}
        </div>

        <div className="net-echo-gm-directory__list" aria-busy={control.directoryPhase === 'loading'}>
          {control.directoryPhase === 'loading' && control.directory.length === 0 ? (
            <div className="net-echo-gm-quiet-state" role="status">
              <LoaderCircle size={17} aria-hidden="true" />
              <strong>SYNCING SIGNAL DIRECTORY</strong>
            </div>
          ) : control.directoryPhase === 'failed' && control.directory.length === 0 ? (
            <div className="net-echo-gm-quiet-state" role="alert">
              <strong>DIRECTORY OFFLINE</strong>
              <span>{control.directoryError}</span>
              <button type="button" onClick={() => void control.loadDirectory()}>Retry</button>
            </div>
          ) : filteredDirectory.length === 0 ? (
            <div className="net-echo-gm-quiet-state">
              <strong>{control.directory.length === 0 ? 'NO SIGNALS' : 'NO SIGNALS IN THIS STATE'}</strong>
              <span>{control.directory.length === 0 ? 'Create the first approved intelligence signal.' : 'Change the lifecycle filter.'}</span>
            </div>
          ) : filteredDirectory.map((signal) => (
            <button
              key={signal.id}
              type="button"
              className="net-echo-gm-directory__row"
              data-active={!isNew && control.selectedSignalId === signal.id ? 'true' : 'false'}
              onClick={() => selectSignal(signal.id)}
            >
              <span>
                <strong>{signal.title}</strong>
                <small>{signal.kind} // {signal.visibilityMode}</small>
              </span>
              <em data-status={signal.status}>{signal.status}</em>
            </button>
          ))}
        </div>
      </aside>

      <main className="net-echo-gm-editor">
        {!hasEditor ? (
          <div className="net-echo-gm-quiet-state net-echo-gm-quiet-state--editor" role="status">
            {control.detailPhase === 'loading' ? <LoaderCircle size={22} aria-hidden="true" /> : <ShieldCheck size={22} aria-hidden="true" />}
            <strong>{control.detailPhase === 'loading' ? 'SYNCHRONIZING SECRET RECORD' : 'NO SIGNAL SELECTED'}</strong>
            <span>{control.detailError ?? 'Select a signal or create the first approved ECHO record.'}</span>
            {control.detailPhase === 'failed' && control.selectedSignalId ? (
              <button type="button" onClick={() => void control.selectSignal(control.selectedSignalId!)}>Retry detail</button>
            ) : null}
          </div>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); void saveSignal() }}>
            <header className="net-echo-gm-editor__header">
              <div>
                <span>{isNew ? 'UNSAVED DRAFT' : `${currentDetail?.status.toUpperCase()} // ${currentDetail?.visibilityMode.toUpperCase()}`}</span>
                <h2>{isNew ? 'NEW SIGNAL' : currentDetail?.title}</h2>
              </div>
              <div className="net-echo-gm-editor__save-state" data-dirty={dirty ? 'true' : 'false'}>
                {dirty ? 'UNSAVED CHANGES' : 'SERVER CONFIRMED'}
              </div>
            </header>

            {formError ? <div className="net-echo-gm-error" role="alert">{formError}</div> : null}

            <section className="net-echo-gm-form-section">
              <h3>SECRET SIGNAL RECORD</h3>
              <Field label="Title">
                <input value={draft.title} maxLength={NET_ECHO_TITLE_MAX_LENGTH} onChange={(event) => setDraftField('title', event.target.value)} />
              </Field>
              <Field label="Summary" hint={`${draft.summary.length}/${NET_ECHO_SUMMARY_MAX_LENGTH}`}>
                <textarea rows={2} value={draft.summary} maxLength={NET_ECHO_SUMMARY_MAX_LENGTH} onChange={(event) => setDraftField('summary', event.target.value)} />
              </Field>
              <Field label="Full intelligence body" hint={`${draft.body.length}/${NET_ECHO_BODY_MAX_LENGTH}`}>
                <textarea rows={8} value={draft.body} maxLength={NET_ECHO_BODY_MAX_LENGTH} onChange={(event) => setDraftField('body', event.target.value)} />
              </Field>
            </section>

            <section className="net-echo-gm-form-section net-echo-gm-form-grid">
              <h3>CLASSIFICATION</h3>
              <Field label="Kind">
                <select value={draft.kind} onChange={(event) => setDraftField('kind', event.target.value as EchoGmDraft['kind'])}>
                  {netEchoSignalKinds.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
                </select>
              </Field>
              <Field label="Reliability">
                <select value={draft.reliability} onChange={(event) => setDraftField('reliability', event.target.value as EchoGmDraft['reliability'])}>
                  {netEchoReliabilities.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </Field>
              <Field label="Intensity">
                <select value={draft.intensity} onChange={(event) => setDraftField('intensity', event.target.value as EchoGmDraft['intensity'])}>
                  {netEchoIntensities.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </Field>
              <Field label="Integrity %" hint="Optional 0–100">
                <input type="number" min="0" max="100" step="1" value={draft.integrityPercent} onChange={(event) => setDraftField('integrityPercent', event.target.value)} />
              </Field>
              <Field label="Frequencies / tags" hint="Comma-separated; max 10">
                <input value={draft.frequencies} onChange={(event) => setDraftField('frequencies', event.target.value)} placeholder="ghost-band, civic-net" />
              </Field>
            </section>

            <section className="net-echo-gm-form-section net-echo-gm-form-grid">
              <h3>SOURCE / INCIDENT CONTEXT</h3>
              <Field label="Source label">
                <input value={draft.sourceLabel} maxLength={120} onChange={(event) => setDraftField('sourceLabel', event.target.value)} />
              </Field>
              <Field label="Location">
                <input value={draft.locationLabel} maxLength={120} onChange={(event) => setDraftField('locationLabel', event.target.value)} />
              </Field>
              <Field label="District">
                <input value={draft.districtLabel} maxLength={80} onChange={(event) => setDraftField('districtLabel', event.target.value)} />
              </Field>
              <Field label="Occurred at">
                <input type="datetime-local" value={draft.occurredAt} onChange={(event) => setDraftField('occurredAt', event.target.value)} />
              </Field>
            </section>

            <section className="net-echo-gm-form-section net-echo-gm-reference-grid">
              <h3>OPTIONAL CROSS-APP REFERENCE</h3>
              <Field label="App">
                <input value={draft.referenceAppId} maxLength={32} onChange={(event) => setDraftField('referenceAppId', event.target.value)} placeholder="pulse" />
              </Field>
              <Field label="Resource kind">
                <input value={draft.referenceResourceKind} maxLength={40} onChange={(event) => setDraftField('referenceResourceKind', event.target.value)} placeholder="post" />
              </Field>
              <Field label="Stable resource id">
                <input value={draft.referenceResourceId} maxLength={160} onChange={(event) => setDraftField('referenceResourceId', event.target.value)} />
              </Field>
            </section>

            <footer className="net-echo-gm-editor__footer">
              <button type="submit" className="net-echo-gm-primary" disabled={control.isMutating || !dirty}>
                {control.isMutating ? <LoaderCircle size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
                {isNew || currentDetail?.status === 'draft' ? 'Save draft' : 'Save changes'}
              </button>
              <span>Saving never reveals a signal.</span>
            </footer>
          </form>
        )}
      </main>

      <aside className="net-echo-gm-rail">
        {hasEditor ? (
          <>
            <section>
              <h3>VISIBILITY GATE</h3>
              <Field label="Visibility mode">
                <select value={draft.visibilityMode} onChange={(event) => {
                  const visibilityMode = event.target.value as EchoGmDraft['visibilityMode']
                  setDraft((current) => ({
                    ...current,
                    visibilityMode,
                    lockedTeaser: visibilityMode === 'prerequisite' ? current.lockedTeaser : '',
                  }))
                }}>
                  {netEchoVisibilityModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                </select>
              </Field>
              {draft.visibilityMode === 'prerequisite' ? (
                <Field label="Safe locked teaser" hint="Optional. Without it, the locked node is omitted.">
                  <textarea rows={3} value={draft.lockedTeaser} maxLength={NET_ECHO_LOCKED_TEASER_MAX_LENGTH} onChange={(event) => setDraftField('lockedTeaser', event.target.value)} />
                </Field>
              ) : null}
            </section>

            <section>
              <h3>MAP POSITION</h3>
              <button className="net-echo-gm-minimap" type="button" onClick={positionMapNode} aria-label="Set signal map position">
                <span style={{ left: `${Math.min(Math.max(Number(draft.mapX) || 0, 0), 100)}%`, top: `${Math.min(Math.max(Number(draft.mapY) || 0, 0), 100)}%` }} />
              </button>
              <div className="net-echo-gm-coordinate-grid">
                <Field label="X">
                  <input type="number" min="0" max="100" step="0.1" value={draft.mapX} onChange={(event) => setDraftField('mapX', event.target.value)} />
                </Field>
                <Field label="Y">
                  <input type="number" min="0" max="100" step="0.1" value={draft.mapY} onChange={(event) => setDraftField('mapY', event.target.value)} />
                </Field>
              </div>
            </section>

            <section className="net-echo-gm-preview">
              <h3>{projectionCopy}</h3>
              <div className="net-echo-gm-preview__secret">
                <span>GM SECRET DATA</span>
                <strong>{draft.title.trim() || 'UNTITLED SIGNAL'}</strong>
                <p>{draft.body.trim() || 'No full intelligence body entered yet.'}</p>
              </div>
              <div className="net-echo-gm-preview__player">
                <span>PLAYER PROJECTION</span>
                {currentDetail?.status !== 'revealed' && !isNew ? <small>DRAFT/ARCHIVED // CURRENTLY ABSENT</small> : null}
                {draft.visibilityMode === 'prerequisite' ? (
                  draft.lockedTeaser.trim() ? (
                    <>
                      <LockKeyhole size={15} aria-hidden="true" />
                      <strong>ENCRYPTED SIGNAL</strong>
                      <p>{draft.lockedTeaser.trim()}</p>
                      <small>X {draft.mapX} // Y {draft.mapY}</small>
                    </>
                  ) : (
                    <p>OMITTED UNTIL ALL DIRECT PREREQUISITES ARE DISCOVERED.</p>
                  )
                ) : draft.visibilityMode === 'granted' ? (
                  <p>ABSENT EXCEPT FOR ECHO ACCOUNTS WITH AN ACTIVE GRANT.</p>
                ) : (
                  <>
                    <strong>{draft.title.trim() || 'UNTITLED SIGNAL'}</strong>
                    <small>{draft.kind} // {draft.reliability}</small>
                  </>
                )}
              </div>
            </section>

            {currentDetail ? (
              <section>
                <h3>SIGNAL LINKS</h3>
                {draft.visibilityMode === 'prerequisite' && prerequisiteCount === 0 ? (
                  <div className="net-echo-gm-warning" role="status">
                    Add at least one prerequisite before revealing.
                  </div>
                ) : null}
                <Field label="Relationship">
                  <select value={nextRelationshipKind} onChange={(event) => setNextRelationshipKind(event.target.value as NetEchoRelationshipKind)}>
                    {netEchoRelationshipKinds.map((kind) => <option key={kind} value={kind}>{RELATIONSHIP_LABELS[kind]}</option>)}
                  </select>
                </Field>
                <Field label={nextRelationshipKind === 'requires' ? 'Unlock this signal after' : 'Target signal'}>
                  <select value={nextLinkTargetId} onChange={(event) => setNextLinkTargetId(event.target.value)}>
                    <option value="">Select signal</option>
                    {control.directory.filter((signal) => signal.id !== currentDetail.id).map((signal) => (
                      <option key={signal.id} value={signal.id}>{signal.title} [{signal.status}]</option>
                    ))}
                  </select>
                </Field>
                <Field label="Optional link label">
                  <input value={nextLinkLabel} maxLength={80} onChange={(event) => setNextLinkLabel(event.target.value)} />
                </Field>
                <button type="button" className="net-echo-gm-secondary" disabled={!nextLinkTargetId || control.isMutating} onClick={() => void addLink()}>
                  <Link2 size={13} aria-hidden="true" /> Add link
                </button>
                <div className="net-echo-gm-link-list">
                  {outgoingLinks.length === 0 ? <p>No outgoing links.</p> : outgoingLinks.map((link) => {
                    const target = control.directory.find((signal) => signal.id === link.toSignalId)
                    return (
                      <div key={`${link.toSignalId}:${link.relationshipKind}`}>
                        <span>
                          <strong>{link.relationshipKind === 'requires' ? 'THIS SIGNAL REQUIRES' : link.relationshipKind.toUpperCase()}</strong>
                          <small>{target?.title ?? 'UNKNOWN SIGNAL'}{link.label ? ` // ${link.label}` : ''}</small>
                        </span>
                        <button type="button" aria-label={`Remove link to ${target?.title ?? 'signal'}`} disabled={control.isMutating} onClick={() => void removeLink(link.toSignalId, link.relationshipKind)}>
                          <Unlink size={13} aria-hidden="true" />
                        </button>
                      </div>
                    )
                  })}
                  {incomingLinks.length > 0 ? <p>{incomingLinks.length} incoming link(s). Edit from their source signal.</p> : null}
                </div>
              </section>
            ) : null}

            {currentDetail?.visibilityMode === 'granted' ? (
              <section>
                <h3>ACCOUNT GRANTS</h3>
                {control.grantPhase === 'idle' ? (
                  <button type="button" className="net-echo-gm-secondary" onClick={() => void control.loadGrantTargets(currentDetail.id)}>
                    <Users size={13} aria-hidden="true" /> Load grant ledger
                  </button>
                ) : control.grantPhase === 'loading' ? (
                  <p className="net-echo-gm-small-state">Synchronizing playable ECHO accounts…</p>
                ) : control.grantPhase === 'failed' ? (
                  <div className="net-echo-gm-warning">
                    {control.grantError}
                    <button type="button" onClick={() => void control.loadGrantTargets(currentDetail.id)}>Retry</button>
                  </div>
                ) : (
                  <div className="net-echo-gm-grants" aria-busy={control.grantPhase === 'refreshing'}>
                    {control.grantTargets.length === 0 ? <p>No active playable ECHO accounts.</p> : control.grantTargets.map((target) => (
                      <div key={target.accountId}>
                        <span className="net-echo-gm-grants__avatar">
                          {target.avatarUrl ? <SharedMediaImage source={target.avatarUrl} variant="thumbnail" alt="" loading="lazy" decoding="async" /> : target.displayName.slice(0, 1).toUpperCase()}
                        </span>
                        <span>
                          <strong>{target.displayName}</strong>
                          <small>@{target.handle}</small>
                        </span>
                        <button type="button" data-active={target.granted ? 'true' : 'false'} disabled={control.isMutating} onClick={async () => {
                          try {
                            await control.setGrant(currentDetail.id, target, !target.granted)
                            onNotice(`ECHO // ACCESS ${target.granted ? 'REVOKED' : 'GRANTED'}`)
                          } catch (error) {
                            setFormError(friendlyError(error))
                          }
                        }}>
                          {target.granted ? 'Granted' : 'Grant'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ) : null}

            {currentDetail ? (
              <section className="net-echo-gm-lifecycle">
                <h3>LIFECYCLE</h3>
                {dirty ? <p>Save or discard local edits before changing lifecycle.</p> : null}
                <div>
                  {currentDetail.status !== 'revealed' ? (
                    <button type="button" disabled={dirty || control.isMutating || (draft.visibilityMode === 'prerequisite' && prerequisiteCount === 0)} onClick={() => requestLifecycle('revealed')}>
                      <Eye size={13} aria-hidden="true" /> Reveal
                    </button>
                  ) : (
                    <button type="button" disabled={dirty || control.isMutating} onClick={() => requestLifecycle('draft')}>
                      <EyeOff size={13} aria-hidden="true" /> Hide
                    </button>
                  )}
                  {currentDetail.status !== 'archived' ? (
                    <button type="button" data-tone="danger" disabled={dirty || control.isMutating} onClick={() => requestLifecycle('archived')}>
                      <Archive size={13} aria-hidden="true" /> Archive
                    </button>
                  ) : (
                    <button type="button" disabled={dirty || control.isMutating} onClick={() => requestLifecycle('draft')}>
                      <RotateCcw size={13} aria-hidden="true" /> Restore
                    </button>
                  )}
                </div>
              </section>
            ) : null}
          </>
        ) : (
          <div className="net-echo-gm-quiet-state net-echo-gm-quiet-state--rail">
            <MapPin size={19} aria-hidden="true" />
            <strong>EDITORIAL GRID READY</strong>
            <span>Player visibility, topology and grants remain server-authoritative.</span>
          </div>
        )}
      </aside>

      {confirmation ? (
        <EchoGmConfirmation
          title={confirmation.title}
          body={confirmation.body}
          confirmLabel={confirmation.confirmLabel}
          tone={confirmation.tone}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => { void confirmation.action() }}
        />
      ) : null}
    </section>
  )
}
