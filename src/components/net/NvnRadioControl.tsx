import {
  Archive,
  CircleStop,
  FileAudio,
  LoaderCircle,
  Radio,
  RadioTower,
  RefreshCcw,
  RotateCcw,
  Save,
  ShieldAlert,
  Trash2,
  Upload,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  assertNetNvnRadioClipInput,
} from '../../lib/netNvnRadioService'
import {
  isNetNvnRadioError,
  netNvnRadioClipKinds,
  type NetNvnGmRadioClipInput,
  type NetNvnRadioMode,
} from '../../lib/netNvnRadioTypes'
import { NvnNewsroomConfirmation } from './NvnNewsroomControl'
import type { CompleteNetNvnLocalMutation } from './useNetNvnRealtime'
import { useNetNvnGmRadioControl } from './useNetNvnGmRadioControl'

interface NvnRadioControlProps {
  readonly enabled: boolean
  readonly realtimeInvalidationVersion: number
  readonly beginLocalMutation: () => CompleteNetNvnLocalMutation
  readonly onDirtyChange: (dirty: boolean) => void
  readonly onNotice: (message: string) => void
  readonly onRadioStateChanged: () => void
}

interface ConfirmationState {
  readonly title: string
  readonly body: string
  readonly confirmLabel: string
  readonly tone?: 'standard' | 'danger'
  readonly action: () => void | Promise<void>
}

const EMPTY_CLIP_INPUT: NetNvnGmRadioClipInput = {
  internalLabel: '',
  publicLabel: '',
  clipKind: 'bulletin',
  rotationEnabled: true,
  rotationWeight: 1,
}

const KIND_LABELS: Record<NetNvnGmRadioClipInput['clipKind'], string> = {
  news: 'News', bulletin: 'Bulletin', 'station-id': 'Station ID', jingle: 'Jingle',
  advertisement: 'Advertisement', weather: 'Weather', traffic: 'Traffic',
  interview: 'Interview', 'public-service': 'Public service', ambience: 'Ambience', other: 'Other',
}

function friendly(error: unknown): string {
  if (isNetNvnRadioError(error)) return error.message
  return error instanceof Error ? error.message : 'NVN Live Broadcast could not confirm that operation.'
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  return `${minutes}:${String(totalSeconds % 60).padStart(2, '0')}`
}

function formatMegabytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024)
  return `${megabytes >= 100 ? Math.round(megabytes) : megabytes.toFixed(1)} MB`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function clipInputSignature(input: NetNvnGmRadioClipInput): string {
  return JSON.stringify({ ...input, internalLabel: input.internalLabel.trim(), publicLabel: input.publicLabel?.trim() })
}

export function NvnRadioControl({
  enabled,
  realtimeInvalidationVersion,
  beginLocalMutation,
  onDirtyChange,
  onNotice,
  onRadioStateChanged,
}: NvnRadioControlProps) {
  const control = useNetNvnGmRadioControl(enabled, realtimeInvalidationVersion)
  const refreshControl = control.refresh
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [clipDraft, setClipDraft] = useState<NetNvnGmRadioClipInput>(EMPTY_CLIP_INPUT)
  const [baseline, setBaseline] = useState(clipInputSignature(EMPTY_CLIP_INPUT))
  const [baselineUpdatedAt, setBaselineUpdatedAt] = useState<string | null>(null)
  const [uploadDraft, setUploadDraft] = useState<NetNvnGmRadioClipInput>(EMPTY_CLIP_INPUT)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [overrideClipId, setOverrideClipId] = useState('')
  const [stingerClipId, setStingerClipId] = useState('')
  const [stingerBaseline, setStingerBaseline] = useState('')
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null)
  const [elapsedOverrideEnd, setElapsedOverrideEnd] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const selected = control.payload?.clips.find((clip) => clip.id === selectedClipId) ?? null
  const selectedIsBreakingIntro = Boolean(
    selected && selected.id === control.payload?.station.breakingStingerClipId,
  )
  const selectedPendingDelete = Boolean(selected?.pendingDeleteAt)
  const selectedDirty = Boolean(selected) && clipInputSignature(clipDraft) !== baseline
  const uploadDirty = Boolean(uploadFile)
    || clipInputSignature(uploadDraft) !== clipInputSignature(EMPTY_CLIP_INPUT)
  const stingerDirty = stingerClipId !== stingerBaseline
  const dirty = selectedDirty || uploadDirty || stingerDirty
  const activeClips = useMemo(
    () => control.payload?.clips.filter((clip) => clip.status === 'active') ?? [],
    [control.payload?.clips],
  )
  const overrideIsActive = Boolean(
    control.payload?.station.overrideEndsAt !== elapsedOverrideEnd
    &&
    control.payload?.effective.mode !== 'rotation'
    && control.payload?.station.overrideMode
    && control.payload.station.overrideEndsAt
    && Date.parse(control.payload.station.overrideEndsAt) > Date.parse(control.payload.serverNow),
  )

  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    if (!overrideClipId && activeClips[0]) setOverrideClipId(activeClips[0].id)
  }, [activeClips, overrideClipId])

  useEffect(() => {
    const confirmed = control.payload?.station.breakingStingerClipId ?? ''
    if (stingerDirty || confirmed === stingerBaseline) return
    setStingerClipId(confirmed)
    setStingerBaseline(confirmed)
  }, [control.payload?.station.breakingStingerClipId, stingerBaseline, stingerDirty])

  useEffect(() => {
    const payload = control.payload
    if (
      !enabled
      || payload?.effective.mode === 'rotation'
      || !payload?.station.overrideEndsAt
    ) return undefined
    const remainingMs = Date.parse(payload.station.overrideEndsAt)
      - Date.parse(payload.serverNow)
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) return undefined
    const timer = window.setTimeout(() => {
      setElapsedOverrideEnd(payload.station.overrideEndsAt)
      void refreshControl(true)
    }, remainingMs + 75)
    return () => window.clearTimeout(timer)
  }, [control.payload, enabled, refreshControl])

  useEffect(() => {
    if (!selected || selectedDirty || selected.updatedAt === baselineUpdatedAt) return
    const confirmed: NetNvnGmRadioClipInput = {
      internalLabel: selected.internalLabel,
      publicLabel: selected.publicLabel ?? '',
      clipKind: selected.clipKind,
      rotationEnabled: selected.rotationEnabled,
      rotationWeight: selected.rotationWeight,
    }
    setClipDraft(confirmed)
    setBaseline(clipInputSignature(confirmed))
    setBaselineUpdatedAt(selected.updatedAt)
  }, [baselineUpdatedAt, selected, selectedDirty])

  const selectClip = (clipId: string) => {
    const next = control.payload?.clips.find((clip) => clip.id === clipId)
    if (!next) return
    const apply = () => {
      const input: NetNvnGmRadioClipInput = {
        internalLabel: next.internalLabel,
        publicLabel: next.publicLabel ?? '',
        clipKind: next.clipKind,
        rotationEnabled: next.rotationEnabled,
        rotationWeight: next.rotationWeight,
      }
      setSelectedClipId(next.id)
      setClipDraft(input)
      setBaseline(clipInputSignature(input))
      setBaselineUpdatedAt(next.updatedAt)
      setActionError(null)
      setConfirmation(null)
    }
    if (!dirty) apply()
    else setConfirmation({
      title: 'Discard unsaved clip changes?',
      body: 'Switching library records will discard local rotation and label edits.',
      confirmLabel: 'Discard and switch',
      tone: 'danger',
      action: apply,
    })
  }

  const runMutation = async (
    key: string,
    operation: () => Promise<unknown>,
    notice: string,
  ) => {
    const complete = beginLocalMutation()
    setPendingAction(key)
    setActionError(null)
    try {
      await operation()
      complete(true)
      onRadioStateChanged()
      onNotice(notice)
    } catch (error) {
      complete(false)
      setActionError(friendly(error))
      throw error
    } finally {
      setPendingAction(null)
    }
  }

  const upload = async () => {
    if (!uploadFile) {
      setActionError('Choose a compressed LIVE audio file first.')
      return
    }
    try {
      assertNetNvnRadioClipInput(uploadDraft)
      await runMutation(
        'upload',
        () => control.uploadClip(uploadFile, uploadDraft),
        'NVN LIVE // CLIP UPLOADED TO SECURE LIBRARY',
      )
      setUploadFile(null)
      setUploadDraft(EMPTY_CLIP_INPUT)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch {
      // Local feedback is populated by validation/runMutation.
    }
  }

  const saveClip = async () => {
    if (!selected) return
    const confirmedInput = selectedIsBreakingIntro
      ? { ...clipDraft, rotationEnabled: false }
      : clipDraft
    try {
      assertNetNvnRadioClipInput(confirmedInput)
      await runMutation(
        'save',
        async () => {
          const payload = await control.updateClip(selected.id, confirmedInput)
          const saved = payload.clips.find((clip) => clip.id === selected.id)
          if (saved) {
            const confirmed: NetNvnGmRadioClipInput = {
              internalLabel: saved.internalLabel,
              publicLabel: saved.publicLabel ?? '',
              clipKind: saved.clipKind,
              rotationEnabled: saved.rotationEnabled,
              rotationWeight: saved.rotationWeight,
            }
            setClipDraft(confirmed)
            setBaseline(clipInputSignature(confirmed))
            setBaselineUpdatedAt(saved.updatedAt)
          }
        },
        'NVN LIVE // CLIP SETTINGS SAVED',
      )
    } catch (error) {
      if (!isNetNvnRadioError(error)) setActionError(friendly(error))
    }
  }

  const saveBreakingStinger = async () => {
    try {
      await runMutation(
        'stinger',
        async () => {
          const next = await control.setBreakingStinger(stingerClipId || null)
          const confirmed = next.station.breakingStingerClipId ?? ''
          setStingerClipId(confirmed)
          setStingerBaseline(confirmed)
        },
        'NVN LIVE // BREAKING INTRO SAVED',
      )
    } catch {
      // Local feedback remains finite and the unsaved selection is preserved.
    }
  }

  const deleteSelectedPermanently = async () => {
    if (!selected) return
    const clipId = selected.id
    setConfirmation(null)
    try {
      await runMutation(
        'delete',
        () => control.deletePermanently(clipId),
        'NVN LIVE // ARCHIVED AUDIO PERMANENTLY DELETED',
      )
      setSelectedClipId((current) => current === clipId ? null : current)
      setBaselineUpdatedAt(null)
    } catch {
      // Prepare state is retained by the control hook. The finite local error
      // and Retry Delete action remain available without an automatic loop.
    }
  }

  const startOverride = (mode: Exclude<NetNvnRadioMode, 'rotation'>) => {
    if (!overrideClipId || !control.payload?.station.stationEnabled) return
    const label = mode === 'breaking' ? 'Breaking News' : 'Play Now'
    const perform = async (replace: boolean) => {
      setConfirmation(null)
      try {
        await runMutation(
          mode,
          () => control.startOverride(overrideClipId, mode, replace),
          `NVN LIVE // ${label.toUpperCase()} IS ON AIR`,
        )
      } catch {
        // Error remains local and finite.
      }
    }
    setConfirmation({
      title: overrideIsActive ? `Replace active broadcast with ${label}?` : `${label}?`,
      body: overrideIsActive
        ? 'This explicitly interrupts the current override for every tuned listener.'
        : 'Every tuned listener will switch to this clip at the same global station time.',
      confirmLabel: overrideIsActive ? 'Replace broadcast' : label,
      tone: mode === 'breaking' ? 'danger' : 'standard',
      action: () => perform(overrideIsActive),
    })
  }

  const selectedServerChanged = Boolean(
    selectedDirty && selected && baselineUpdatedAt && selected.updatedAt !== baselineUpdatedAt,
  )

  if (control.loading && !control.payload) {
    return <div className="nvn-radio-control__state"><LoaderCircle className="nvn-spin" /> Synchronizing LIVE Broadcast…</div>
  }

  if (!control.payload) {
    return (
      <div className="nvn-radio-control__state">
        <RadioTower size={22} aria-hidden="true" />
        <strong>LIVE Broadcast unavailable</strong>
        <span>{control.error}</span>
        <button type="button" onClick={control.retry}><RefreshCcw size={13} /> Retry</button>
      </div>
    )
  }

  const { payload } = control
  const overrideElapsedLocally = payload.station.overrideEndsAt === elapsedOverrideEnd
    && payload.effective.mode !== 'rotation'
  const displayedMode = overrideElapsedLocally ? 'rotation' : payload.effective.mode
  const current = overrideElapsedLocally ? null : payload.effective.current
  const breakingOverrideActive = overrideIsActive && displayedMode === 'breaking'

  return (
    <section className="nvn-radio-control" aria-label="NVN Live Broadcast Control">
      <header className="nvn-radio-control__header">
        <div>
          <span><RadioTower size={14} aria-hidden="true" /> Broadcast desk</span>
          <h2>NVN Live Broadcast</h2>
          <p>One global station clock. Listener actions never alter the broadcast.</p>
        </div>
        <button
          type="button"
          data-enabled={payload.station.stationEnabled ? 'true' : undefined}
          disabled={Boolean(pendingAction)}
          onClick={() => {
            setConfirmation({
              title: payload.station.stationEnabled ? 'Take LIVE Broadcast off air?' : 'Enable LIVE Broadcast?',
              body: payload.station.stationEnabled
                ? 'Tuned listeners will lose the live carrier immediately.'
                : 'The deterministic normal rotation will resume at the current server time.',
              confirmLabel: payload.station.stationEnabled ? 'Disable station' : 'Enable station',
              tone: payload.station.stationEnabled ? 'danger' : 'standard',
              action: async () => {
                setConfirmation(null)
                try {
                  await runMutation(
                    'station',
                    () => control.setStationEnabled(!payload.station.stationEnabled),
                    `NVN LIVE // BROADCAST ${payload.station.stationEnabled ? 'DISABLED' : 'ENABLED'}`,
                  )
                } catch { /* local feedback */ }
              },
            })
          }}
        >
          <i /> {payload.station.stationEnabled ? 'On air' : 'Station disabled'}
        </button>
      </header>

      {control.refreshing ? <p className="nvn-radio-control__sync">Broadcast library synchronizing…</p> : null}
      {control.error || actionError ? <p className="nvn-radio-control__error" role="alert">{actionError ?? control.error}</p> : null}

      <div className="nvn-radio-control__grid">
        <aside className="nvn-radio-library">
          <header><strong>Audio library</strong><span>{activeClips.length} / 100 active</span></header>
          <div className="nvn-radio-library__budget">
            <span>NVN audio budget</span>
            <strong>{formatMegabytes(payload.libraryByteSize)} / {formatMegabytes(payload.libraryByteBudget)}</strong>
            <i style={{ width: `${Math.min(100, payload.libraryByteSize / payload.libraryByteBudget * 100)}%` }} />
          </div>
          {payload.clips.length === 0 ? <p>No secure broadcast clips uploaded.</p> : (
            <div className="nvn-radio-library__rows">
              {payload.clips.map((clip) => (
                <button
                  key={clip.id}
                  type="button"
                  disabled={pendingAction === 'delete'}
                  data-active={selectedClipId === clip.id ? 'true' : undefined}
                  data-archived={clip.status === 'archived' ? 'true' : undefined}
                  data-pending-delete={clip.pendingDeleteAt ? 'true' : undefined}
                  onClick={() => selectClip(clip.id)}
                >
                  <FileAudio size={14} aria-hidden="true" />
                  <span><strong>{clip.internalLabel}</strong><small>{KIND_LABELS[clip.clipKind]} · {formatDuration(clip.durationMs)}</small></span>
                  {clip.pendingDeleteAt
                    ? <i>Delete pending</i>
                    : clip.rotationEnabled ? <i>FREQ {clip.rotationWeight}</i> : null}
                </button>
              ))}
            </div>
          )}
        </aside>

        <div className="nvn-radio-control__workbench">
          <section className="nvn-radio-now">
            <header><span>Current broadcast</span><strong data-breaking={displayedMode === 'breaking' ? 'true' : undefined}>{payload.effective.stationStatus === 'on-air' ? displayedMode : 'Off air'}</strong></header>
            {current ? <p><Radio size={15} aria-hidden="true" /><span><strong>{current.publicLabel ?? KIND_LABELS[current.clipKind]}</strong><small>{KIND_LABELS[current.clipKind]}</small></span></p> : <p>{overrideElapsedLocally ? 'Normal rotation is synchronizing at the current station time.' : 'No playable clip is currently on air.'}</p>}
            <div className="nvn-radio-now__override">
              <label><span>Override clip</span><select value={overrideClipId} onChange={(event) => setOverrideClipId(event.target.value)} disabled={activeClips.length === 0}>{activeClips.map((clip) => <option key={clip.id} value={clip.id}>{clip.internalLabel}</option>)}</select></label>
              <button type="button" onClick={() => startOverride('play-now')} disabled={!payload.station.stationEnabled || !overrideClipId || Boolean(pendingAction)}><Radio size={13} /> Play now</button>
              <button type="button" className="nvn-radio-breaking" onClick={() => startOverride('breaking')} disabled={!payload.station.stationEnabled || !overrideClipId || Boolean(pendingAction)}><ShieldAlert size={13} /> Breaking news</button>
              {overrideIsActive ? <button type="button" onClick={() => setConfirmation({ title: 'End active override?', body: 'Listeners will immediately return to the current wall-clock position in normal rotation.', confirmLabel: 'End override', tone: 'danger', action: async () => { setConfirmation(null); try { await runMutation('end', control.endOverride, 'NVN LIVE // OVERRIDE ENDED') } catch { /* local feedback */ } } })}><CircleStop size={13} /> End override</button> : null}
            </div>
            {!payload.station.stationEnabled ? <p className="nvn-radio-now__hint">Enable LIVE broadcast first.</p> : null}
          </section>

          <section className="nvn-radio-breaking-setup">
            <header><ShieldAlert size={14} aria-hidden="true" /><strong>Breaking News setup</strong></header>
            <p>Optional global intro. During BREAKING NEWS every listener hears the same live stinger-to-bulletin timeline.</p>
            <div className="nvn-radio-now__override">
              <label>
                <span>Breaking intro</span>
                <select value={stingerClipId} onChange={(event) => setStingerClipId(event.target.value)} disabled={breakingOverrideActive}>
                  <option value="">No intro · start bulletin immediately</option>
                  {activeClips.map((clip) => <option key={clip.id} value={clip.id}>{clip.internalLabel} · {formatDuration(clip.durationMs)}</option>)}
                </select>
              </label>
              <button type="button" className="nvn-radio-primary" onClick={() => void saveBreakingStinger()} disabled={breakingOverrideActive || !stingerDirty || Boolean(pendingAction)}>
                {pendingAction === 'stinger' ? <LoaderCircle className="nvn-spin" /> : <Save size={13} />} Save setup
              </button>
            </div>
            {breakingOverrideActive ? <p>End the current BREAKING NEWS transmission before changing its intro.</p> : null}
          </section>

          <section className="nvn-radio-upload">
            <header><Upload size={14} aria-hidden="true" /><strong>Upload compressed clip</strong></header>
            <p>For bulletins, news, alerts, interviews, station IDs, ambience, and advertisements. MP3/M4A preferred · 2 seconds–15 minutes · maximum 15 MB · WAV/AIFF rejected. The future music catalogue is a separate product.</p>
            <div className="nvn-radio-fields">
              <label><span>Internal GM label</span><input value={uploadDraft.internalLabel} maxLength={120} onChange={(event) => setUploadDraft((value) => ({ ...value, internalLabel: event.target.value }))} /></label>
              <label><span>Public on-air label</span><input value={uploadDraft.publicLabel ?? ''} maxLength={160} onChange={(event) => setUploadDraft((value) => ({ ...value, publicLabel: event.target.value }))} /></label>
              <label><span>Kind</span><select value={uploadDraft.clipKind} onChange={(event) => setUploadDraft((value) => ({ ...value, clipKind: event.target.value as NetNvnGmRadioClipInput['clipKind'] }))}>{netNvnRadioClipKinds.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}</select></label>
              <label><span>Rotation frequency</span><input type="number" min={1} max={5} value={uploadDraft.rotationWeight} onChange={(event) => setUploadDraft((value) => ({ ...value, rotationWeight: Number(event.target.value) }))} /><small>1 = normal · 5 = plays much more often</small></label>
              <label className="nvn-radio-toggle"><input type="checkbox" checked={uploadDraft.rotationEnabled} onChange={(event) => setUploadDraft((value) => ({ ...value, rotationEnabled: event.target.checked }))} /> Include in normal rotation</label>
            </div>
            <input ref={fileInputRef} type="file" accept="audio/mpeg,audio/mp4,audio/m4a,audio/x-m4a,audio/ogg,audio/webm,.mp3,.m4a,.mp4,.ogg,.webm" hidden onChange={(event) => { setUploadFile(event.target.files?.[0] ?? null); setActionError(null); event.currentTarget.value = '' }} />
            <div className="nvn-radio-upload__actions">
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={pendingAction === 'upload'}><FileAudio size={13} /> {uploadFile ? uploadFile.name : 'Choose audio'}</button>
              <button type="button" className="nvn-radio-primary" onClick={() => void upload()} disabled={!uploadFile || pendingAction === 'upload'}>{pendingAction === 'upload' ? <LoaderCircle className="nvn-spin" /> : <Upload size={13} />} Upload clip</button>
            </div>
          </section>

          {selected ? (
            <section className="nvn-radio-clip-editor">
              <header><FileAudio size={14} /><strong>Clip settings</strong><span>{selectedPendingDelete ? 'Pending delete' : selected.status}</span></header>
              {selectedServerChanged ? <p className="nvn-radio-control__warning">The server record changed in another tab. Your local edits were preserved.</p> : null}
              {selectedPendingDelete ? (
                <p className="nvn-radio-delete-pending" role="status">
                  <Trash2 size={14} aria-hidden="true" />
                  <span><strong>Pending permanent delete</strong>The registered size still counts against the NVN audio budget until deletion finishes.</span>
                </p>
              ) : null}
              <div className="nvn-radio-fields">
                <label><span>Internal GM label</span><input value={clipDraft.internalLabel} maxLength={120} disabled={selectedPendingDelete} onChange={(event) => setClipDraft((value) => ({ ...value, internalLabel: event.target.value }))} /></label>
                <label><span>Public on-air label</span><input value={clipDraft.publicLabel ?? ''} maxLength={160} disabled={selectedPendingDelete} onChange={(event) => setClipDraft((value) => ({ ...value, publicLabel: event.target.value }))} /></label>
                <label><span>Kind</span><select value={clipDraft.clipKind} disabled={selectedPendingDelete} onChange={(event) => setClipDraft((value) => ({ ...value, clipKind: event.target.value as NetNvnGmRadioClipInput['clipKind'] }))}>{netNvnRadioClipKinds.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}</select></label>
                <label><span>Rotation frequency</span><input type="number" min={1} max={5} value={clipDraft.rotationWeight} disabled={selectedPendingDelete} onChange={(event) => setClipDraft((value) => ({ ...value, rotationWeight: Number(event.target.value) }))} /><small>1 = normal · 5 = plays much more often</small></label>
                <label className="nvn-radio-toggle" data-reserved={selectedIsBreakingIntro ? 'true' : undefined}>
                  <input
                    type="checkbox"
                    checked={selectedIsBreakingIntro ? false : clipDraft.rotationEnabled}
                    disabled={selected.status === 'archived' || selectedIsBreakingIntro || selectedPendingDelete}
                    onChange={(event) => setClipDraft((value) => ({ ...value, rotationEnabled: event.target.checked }))}
                  />
                  <span>Include in normal rotation</span>
                  {selectedIsBreakingIntro ? <small>Reserved for Breaking Intro</small> : null}
                </label>
              </div>
              <footer>
                <button type="button" className="nvn-radio-primary" disabled={selectedPendingDelete || !selectedDirty || Boolean(pendingAction)} onClick={() => void saveClip()}><Save size={13} /> Save settings</button>
                {selectedPendingDelete ? (
                  <button type="button" className="nvn-radio-danger" disabled={Boolean(pendingAction)} onClick={() => void deleteSelectedPermanently()}>
                    {pendingAction === 'delete' ? <LoaderCircle className="nvn-spin" /> : <Trash2 size={13} />} Retry delete
                  </button>
                ) : (
                  <>
                    <button type="button" disabled={Boolean(pendingAction)} onClick={() => setConfirmation({ title: selected.status === 'archived' ? 'Restore broadcast clip?' : 'Archive broadcast clip?', body: selected.status === 'archived' ? 'The clip returns to the active library but remains outside rotation until explicitly enabled.' : 'The clip leaves rotation and remains recoverable in the GM library.', confirmLabel: selected.status === 'archived' ? 'Restore clip' : 'Archive clip', tone: selected.status === 'archived' ? 'standard' : 'danger', action: async () => { setConfirmation(null); try { await runMutation('archive', () => control.setArchived(selected.id, selected.status !== 'archived'), `NVN LIVE // CLIP ${selected.status === 'archived' ? 'RESTORED' : 'ARCHIVED'}`); setSelectedClipId(null); setBaselineUpdatedAt(null) } catch { /* local feedback */ } } })}>{selected.status === 'archived' ? <RotateCcw size={13} /> : <Archive size={13} />}{selected.status === 'archived' ? 'Restore' : 'Archive'}</button>
                    {selected.status === 'archived' ? (
                      <button type="button" className="nvn-radio-danger" disabled={Boolean(pendingAction)} onClick={() => setConfirmation({
                        title: 'Delete audio permanently?',
                        body: `This permanently removes “${selected.internalLabel}” (${formatFileSize(selected.byteSize)}) from secure NVN Storage and frees its registered audio budget. This action cannot be undone.`,
                        confirmLabel: 'Delete permanently',
                        tone: 'danger',
                        action: deleteSelectedPermanently,
                      })}><Trash2 size={13} /> Delete permanently</button>
                    ) : null}
                  </>
                )}
              </footer>
            </section>
          ) : null}
        </div>
      </div>

      {confirmation ? <NvnNewsroomConfirmation {...confirmation} onCancel={() => setConfirmation(null)} onConfirm={() => void confirmation.action()} /> : null}
    </section>
  )
}
