import {
  Archive,
  CircleStop,
  FileAudio,
  Headphones,
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

import { NewsPlatformConfirmation } from './NewsPlatformConfirmation'

const newsPlatformBroadcastClipKinds = [
  'news', 'bulletin', 'station-id', 'jingle', 'advertisement', 'weather',
  'traffic', 'interview', 'public-service', 'ambience', 'other',
] as const

export type NewsPlatformBroadcastClipKind = typeof newsPlatformBroadcastClipKinds[number]
export type NewsPlatformBroadcastMode = 'rotation' | 'play-now' | 'breaking'

export interface NewsPlatformBroadcastClipInput {
  readonly internalLabel: string
  readonly publicLabel?: string
  readonly clipKind: NewsPlatformBroadcastClipKind
  readonly rotationEnabled: boolean
  readonly rotationWeight: number
}

export interface NewsPlatformBroadcastAudioMetadata {
  readonly mimeType: string
  readonly byteSize: number
  readonly durationMs: number
}

export interface NewsPlatformBroadcastClip {
  readonly id: string
  readonly internalLabel: string
  readonly publicLabel?: string
  readonly clipKind: NewsPlatformBroadcastClipKind
  readonly status: 'active' | 'archived'
  readonly rotationEnabled: boolean
  readonly rotationWeight: number
  readonly objectPath: string
  readonly mimeType: string
  readonly byteSize: number
  readonly durationMs: number
  readonly pendingDeleteAt: string | null
  readonly updatedAt: string
}

export interface NewsPlatformBroadcastControlPayload {
  readonly serverNow: string
  readonly station: {
    readonly stationEnabled: boolean
    readonly breakingStingerClipId: string | null
    readonly overrideMode: Exclude<NewsPlatformBroadcastMode, 'rotation'> | null
    readonly overrideEndsAt: string | null
  }
  readonly effective: {
    readonly stationStatus: 'off-air' | 'on-air'
    readonly mode: NewsPlatformBroadcastMode
    readonly current: {
      readonly clipId: string
      readonly publicLabel?: string
      readonly clipKind: NewsPlatformBroadcastClipKind
    } | null
  }
  readonly clips: readonly NewsPlatformBroadcastClip[]
  readonly libraryByteSize: number
  readonly libraryByteBudget: number
}

export interface NewsPlatformBroadcastController {
  readonly payload: NewsPlatformBroadcastControlPayload | null
  readonly loading: boolean
  readonly refreshing: boolean
  readonly error: string | null
  readonly refresh: (background?: boolean) => Promise<NewsPlatformBroadcastControlPayload | null>
  readonly retry: () => void
  readonly inspectAudio: (file: File) => Promise<NewsPlatformBroadcastAudioMetadata>
  readonly signClip: (objectPath: string, ttlSeconds: number) => Promise<string>
  readonly uploadClip: (file: File, input: NewsPlatformBroadcastClipInput) => Promise<NewsPlatformBroadcastControlPayload>
  readonly updateClip: (clipId: string, input: NewsPlatformBroadcastClipInput) => Promise<NewsPlatformBroadcastControlPayload>
  readonly setArchived: (clipId: string, archived: boolean) => Promise<NewsPlatformBroadcastControlPayload>
  readonly deletePermanently: (clipId: string) => Promise<NewsPlatformBroadcastControlPayload>
  readonly setStationEnabled: (enabled: boolean) => Promise<NewsPlatformBroadcastControlPayload>
  readonly setBreakingStinger: (clipId: string | null) => Promise<NewsPlatformBroadcastControlPayload>
  readonly startOverride: (
    clipId: string,
    mode: Exclude<NewsPlatformBroadcastMode, 'rotation'>,
    replaceActive: boolean,
  ) => Promise<NewsPlatformBroadcastControlPayload>
  readonly endOverride: () => Promise<NewsPlatformBroadcastControlPayload>
}

export interface NewsPlatformBroadcastControlConfig {
  readonly classNamePrefix: 'nvn' | 'altara-news'
  readonly ariaLabel: string
  readonly eyebrow: string
  readonly title: string
  readonly networkCopy: string
  readonly budgetLabel: string
  readonly noticePrefix: string
  readonly dialogBackdropClassName: string
  readonly dialogClassName: string
  readonly unavailableCopy: string
}

interface ConfirmationState {
  readonly title: string
  readonly body: string
  readonly confirmLabel: string
  readonly tone?: 'default' | 'danger'
  readonly action: () => void | Promise<void>
}

const EMPTY_CLIP_INPUT: NewsPlatformBroadcastClipInput = {
  internalLabel: '',
  publicLabel: '',
  clipKind: 'bulletin',
  rotationEnabled: true,
  rotationWeight: 1,
}

const KIND_LABELS: Record<NewsPlatformBroadcastClipKind, string> = {
  news: 'News', bulletin: 'Bulletin', 'station-id': 'Station ID', jingle: 'Jingle',
  advertisement: 'Advertisement', weather: 'Weather', traffic: 'Traffic',
  interview: 'Interview', 'public-service': 'Public service', ambience: 'Ambience', other: 'Other',
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

function clipInputSignature(input: NewsPlatformBroadcastClipInput): string {
  return JSON.stringify({
    ...input,
    internalLabel: input.internalLabel.trim(),
    publicLabel: input.publicLabel?.trim(),
  })
}

function validateClipInput(input: NewsPlatformBroadcastClipInput): void {
  if (!input.internalLabel.trim() || input.internalLabel.trim().length > 120) {
    throw new Error('Internal label is required and must be 120 characters or fewer.')
  }
  if (input.publicLabel && input.publicLabel.trim().length > 160) {
    throw new Error('Public programme label must be 160 characters or fewer.')
  }
  if (!newsPlatformBroadcastClipKinds.includes(input.clipKind)) {
    throw new Error('Choose a supported broadcast clip type.')
  }
  if (!Number.isInteger(input.rotationWeight) || input.rotationWeight < 1 || input.rotationWeight > 5) {
    throw new Error('Rotation weight must be a whole number from 1 to 5.')
  }
}

function friendly(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export function NewsPlatformBroadcastControl({
  controller,
  config,
  beginMutation,
  onDirtyChange,
  onNotice,
  onBroadcastStateChanged,
}: {
  readonly controller: NewsPlatformBroadcastController
  readonly config: NewsPlatformBroadcastControlConfig
  readonly beginMutation?: () => (succeeded: boolean) => void
  readonly onDirtyChange?: (dirty: boolean) => void
  readonly onNotice: (message: string) => void
  readonly onBroadcastStateChanged?: () => void
}) {
  const prefix = config.classNamePrefix
  const cn = (suffix: string) => `${prefix}-${suffix}`
  const controlPayload = controller.payload
  const refreshControl = controller.refresh
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [clipDraft, setClipDraft] = useState<NewsPlatformBroadcastClipInput>(EMPTY_CLIP_INPUT)
  const [baseline, setBaseline] = useState(clipInputSignature(EMPTY_CLIP_INPUT))
  const [baselineUpdatedAt, setBaselineUpdatedAt] = useState<string | null>(null)
  const [uploadDraft, setUploadDraft] = useState<NewsPlatformBroadcastClipInput>(EMPTY_CLIP_INPUT)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadMetadata, setUploadMetadata] = useState<NewsPlatformBroadcastAudioMetadata | null>(null)
  const [fileState, setFileState] = useState<'idle' | 'checking' | 'ready' | 'invalid'>('idle')
  const [fileError, setFileError] = useState<string | null>(null)
  const [overrideClipId, setOverrideClipId] = useState('')
  const [stingerClipId, setStingerClipId] = useState('')
  const [stingerBaseline, setStingerBaseline] = useState('')
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null)
  const [elapsedOverrideEnd, setElapsedOverrideEnd] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const chooseAudioRef = useRef<HTMLButtonElement | null>(null)
  const uploadSectionRef = useRef<HTMLElement | null>(null)
  const fileGenerationRef = useRef(0)
  const previewRef = useRef<HTMLAudioElement | null>(null)
  const previewObjectUrlRef = useRef<string | null>(null)

  const selected = controller.payload?.clips.find((clip) => clip.id === selectedClipId) ?? null
  const selectedIsBreakingIntro = Boolean(selected && selected.id === controller.payload?.station.breakingStingerClipId)
  const selectedPendingDelete = Boolean(selected?.pendingDeleteAt)
  const selectedDirty = Boolean(selected) && clipInputSignature(clipDraft) !== baseline
  const uploadDirty = Boolean(uploadFile)
    || clipInputSignature(uploadDraft) !== clipInputSignature(EMPTY_CLIP_INPUT)
  const stingerDirty = stingerClipId !== stingerBaseline
  const dirty = selectedDirty || uploadDirty || stingerDirty
  const activeClips = useMemo(
    () => controller.payload?.clips.filter((clip) => clip.status === 'active') ?? [],
    [controller.payload?.clips],
  )
  const overrideIsActive = Boolean(
    controller.payload?.station.overrideEndsAt !== elapsedOverrideEnd
    && controller.payload?.effective.mode !== 'rotation'
    && controller.payload?.station.overrideMode
    && controller.payload.station.overrideEndsAt
    && Date.parse(controller.payload.station.overrideEndsAt) > Date.parse(controller.payload.serverNow),
  )

  useEffect(() => {
    onDirtyChange?.(dirty)
    return () => onDirtyChange?.(false)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    if (!overrideClipId && activeClips[0]) setOverrideClipId(activeClips[0].id)
  }, [activeClips, overrideClipId])

  useEffect(() => {
    const confirmed = controller.payload?.station.breakingStingerClipId ?? ''
    if (stingerDirty || confirmed === stingerBaseline) return
    setStingerClipId(confirmed)
    setStingerBaseline(confirmed)
  }, [controller.payload?.station.breakingStingerClipId, stingerBaseline, stingerDirty])

  useEffect(() => {
    const payload = controlPayload
    if (payload?.effective.mode === 'rotation' || !payload?.station.overrideEndsAt) return undefined
    const remainingMs = Date.parse(payload.station.overrideEndsAt) - Date.parse(payload.serverNow)
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) return undefined
    const timer = window.setTimeout(() => {
      setElapsedOverrideEnd(payload.station.overrideEndsAt)
      void refreshControl(true)
    }, remainingMs + 75)
    return () => window.clearTimeout(timer)
  }, [controlPayload, refreshControl])

  useEffect(() => {
    if (!selected || selectedDirty || selected.updatedAt === baselineUpdatedAt) return
    const confirmed: NewsPlatformBroadcastClipInput = {
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

  useEffect(() => () => {
    fileGenerationRef.current += 1
    previewRef.current?.pause()
    if (previewObjectUrlRef.current) URL.revokeObjectURL(previewObjectUrlRef.current)
  }, [])

  const resetUploadDraft = () => {
    fileGenerationRef.current += 1
    setUploadFile(null)
    setUploadMetadata(null)
    setFileState('idle')
    setFileError(null)
    setUploadDraft(EMPTY_CLIP_INPUT)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const focusNewClip = () => {
    uploadSectionRef.current?.scrollIntoView({ block: 'nearest' })
    window.requestAnimationFrame(() => chooseAudioRef.current?.focus())
  }

  const enterNewClip = () => {
    const apply = () => {
      setSelectedClipId(null)
      setBaselineUpdatedAt(null)
      resetUploadDraft()
      setActionError(null)
      setConfirmation(null)
      focusNewClip()
    }
    if (!selectedDirty && !uploadDirty) {
      apply()
      return
    }
    setConfirmation({
      title: 'Start a new clip?',
      body: 'Your unsaved clip labels, rotation settings, or selected audio will be discarded.',
      confirmLabel: 'Discard and start new',
      tone: 'danger',
      action: apply,
    })
  }

  const selectClip = (clipId: string) => {
    const next = controller.payload?.clips.find((clip) => clip.id === clipId)
    if (!next) return
    const apply = () => {
      const input: NewsPlatformBroadcastClipInput = {
        internalLabel: next.internalLabel,
        publicLabel: next.publicLabel ?? '',
        clipKind: next.clipKind,
        rotationEnabled: next.rotationEnabled,
        rotationWeight: next.rotationWeight,
      }
      resetUploadDraft()
      setSelectedClipId(next.id)
      setClipDraft(input)
      setBaseline(clipInputSignature(input))
      setBaselineUpdatedAt(next.updatedAt)
      setActionError(null)
      setConfirmation(null)
    }
    if (!selectedDirty && !uploadDirty) apply()
    else setConfirmation({
      title: 'Discard unsaved clip changes?',
      body: 'Switching library records will discard the current local clip draft.',
      confirmLabel: 'Discard and switch',
      tone: 'danger',
      action: apply,
    })
  }

  const runMutation = async (key: string, operation: () => Promise<unknown>, notice: string) => {
    const complete = beginMutation?.()
    setPendingAction(key)
    setActionError(null)
    try {
      await operation()
      complete?.(true)
      onBroadcastStateChanged?.()
      onNotice(`${config.noticePrefix} // ${notice}`)
      return true
    } catch (error) {
      complete?.(false)
      setActionError(friendly(error, `${config.title} could not confirm that operation.`))
      return false
    } finally {
      setPendingAction(null)
    }
  }

  const inspectSelectedFile = async (file: File | null) => {
    const generation = ++fileGenerationRef.current
    setUploadFile(file)
    setUploadMetadata(null)
    setFileError(null)
    if (!file) {
      setFileState('idle')
      return
    }
    setFileState('checking')
    try {
      const metadata = await controller.inspectAudio(file)
      if (generation !== fileGenerationRef.current) return
      setUploadMetadata(metadata)
      setFileState('ready')
    } catch (error) {
      if (generation !== fileGenerationRef.current) return
      setFileState('invalid')
      setFileError(friendly(error, 'The selected audio file could not be decoded.'))
    }
  }

  const stopPreview = () => {
    previewRef.current?.pause()
    previewRef.current = null
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current)
      previewObjectUrlRef.current = null
    }
    setPreviewing(null)
  }

  const playPreview = async (source: NewsPlatformBroadcastClip | File) => {
    const key = source instanceof File ? 'draft' : source.id
    if (previewing === key) {
      stopPreview()
      return
    }
    stopPreview()
    try {
      const url = source instanceof File
        ? URL.createObjectURL(source)
        : await controller.signClip(source.objectPath, 16 * 60)
      if (source instanceof File) previewObjectUrlRef.current = url
      const audio = new Audio(url)
      previewRef.current = audio
      audio.onended = stopPreview
      audio.onerror = () => {
        stopPreview()
        setActionError('Audio preview could not be played.')
      }
      await audio.play()
      setPreviewing(key)
    } catch (error) {
      stopPreview()
      setActionError(friendly(error, 'Audio preview could not be played.'))
    }
  }

  const upload = async () => {
    if (!uploadFile || !uploadMetadata || fileState !== 'ready') {
      setActionError('Choose a supported audio file and wait for validation first.')
      return
    }
    try {
      validateClipInput(uploadDraft)
    } catch (error) {
      setActionError(friendly(error, 'Check the new clip fields.'))
      return
    }
    const succeeded = await runMutation(
      'upload',
      () => controller.uploadClip(uploadFile, uploadDraft),
      'CLIP UPLOADED TO SECURE LIBRARY',
    )
    if (succeeded) resetUploadDraft()
  }

  const saveClip = async () => {
    if (!selected) return
    const confirmedInput = selectedIsBreakingIntro ? { ...clipDraft, rotationEnabled: false } : clipDraft
    try {
      validateClipInput(confirmedInput)
    } catch (error) {
      setActionError(friendly(error, 'Check the clip settings.'))
      return
    }
    await runMutation('save', async () => {
      const payload = await controller.updateClip(selected.id, confirmedInput)
      const saved = payload.clips.find((clip) => clip.id === selected.id)
      if (saved) {
        const confirmed: NewsPlatformBroadcastClipInput = {
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
    }, 'CLIP SETTINGS SAVED')
  }

  const saveBreakingStinger = async () => {
    await runMutation('stinger', async () => {
      const next = await controller.setBreakingStinger(stingerClipId || null)
      const confirmed = next.station.breakingStingerClipId ?? ''
      setStingerClipId(confirmed)
      setStingerBaseline(confirmed)
    }, 'BREAKING INTRO SAVED')
  }

  const deleteSelectedPermanently = async () => {
    if (!selected) return
    const clipId = selected.id
    setConfirmation(null)
    const succeeded = await runMutation(
      'delete',
      () => controller.deletePermanently(clipId),
      'ARCHIVED AUDIO PERMANENTLY DELETED',
    )
    if (succeeded) {
      setSelectedClipId((current) => current === clipId ? null : current)
      setBaselineUpdatedAt(null)
    }
  }

  const startOverride = (mode: Exclude<NewsPlatformBroadcastMode, 'rotation'>) => {
    if (!overrideClipId || !controller.payload?.station.stationEnabled) return
    const label = mode === 'breaking' ? 'Breaking' : 'Play Now'
    const perform = async (replace: boolean) => {
      setConfirmation(null)
      await runMutation(
        mode,
        () => controller.startOverride(overrideClipId, mode, replace),
        `${label.toUpperCase()} IS ON AIR`,
      )
    }
    setConfirmation({
      title: overrideIsActive ? `Replace active broadcast with ${label}?` : `${label}?`,
      body: overrideIsActive
        ? 'This explicitly interrupts the current override for every tuned listener.'
        : 'Every tuned listener will switch to this clip at the same global station time.',
      confirmLabel: overrideIsActive ? 'Replace broadcast' : label,
      tone: mode === 'breaking' ? 'danger' : 'default',
      action: () => perform(overrideIsActive),
    })
  }

  const selectedServerChanged = Boolean(
    selectedDirty && selected && baselineUpdatedAt && selected.updatedAt !== baselineUpdatedAt,
  )

  if (controller.loading && !controller.payload) {
    return <div className={cn('radio-control__state')}><LoaderCircle className={cn('spin')} /> Synchronizing broadcast…</div>
  }
  if (!controller.payload) {
    return (
      <div className={cn('radio-control__state')}>
        <RadioTower size={22} aria-hidden="true" />
        <strong>{config.title} unavailable</strong>
        <span>{controller.error ?? config.unavailableCopy}</span>
        <button type="button" onClick={controller.retry}><RefreshCcw size={13} /> Retry</button>
      </div>
    )
  }

  const { payload } = controller
  const overrideElapsedLocally = payload.station.overrideEndsAt === elapsedOverrideEnd
    && payload.effective.mode !== 'rotation'
  const displayedMode = overrideElapsedLocally ? 'rotation' : payload.effective.mode
  const current = overrideElapsedLocally ? null : payload.effective.current
  const breakingOverrideActive = overrideIsActive && displayedMode === 'breaking'

  return (
    <section className={cn('radio-control')} aria-label={config.ariaLabel}>
      <header className={cn('radio-control__header')}>
        <div>
          <span><RadioTower size={14} aria-hidden="true" /> {config.eyebrow}</span>
          <h2>{config.title}</h2>
          <p>{config.networkCopy}</p>
        </div>
        <button type="button" data-enabled={payload.station.stationEnabled ? 'true' : undefined} disabled={Boolean(pendingAction)} onClick={() => setConfirmation({
          title: payload.station.stationEnabled ? 'Take broadcast off air?' : 'Enable broadcast?',
          body: payload.station.stationEnabled
            ? 'Tuned listeners will lose the live carrier immediately.'
            : 'The deterministic global rotation will resume at the current server time.',
          confirmLabel: payload.station.stationEnabled ? 'Disable station' : 'Enable station',
          tone: payload.station.stationEnabled ? 'danger' : 'default',
          action: async () => {
            setConfirmation(null)
            await runMutation(
              'station',
              () => controller.setStationEnabled(!payload.station.stationEnabled),
              `BROADCAST ${payload.station.stationEnabled ? 'DISABLED' : 'ENABLED'}`,
            )
          },
        })}><i /> {payload.station.stationEnabled ? 'On air' : 'Station disabled'}</button>
      </header>

      {controller.refreshing ? <p className={cn('radio-control__sync')}>Broadcast library synchronizing…</p> : null}
      {controller.error || actionError ? <p className={cn('radio-control__error')} role="alert">{actionError ?? controller.error}</p> : null}

      <div className={cn('radio-control__grid')}>
        <aside className={cn('radio-library')}>
          <header>
            <span><strong>Audio library</strong><small>{activeClips.length} / 100 active</small></span>
            <button type="button" className={cn('radio-new')} onClick={enterNewClip} disabled={pendingAction === 'delete'}><Upload size={13} /> New clip</button>
          </header>
          <div className={cn('radio-library__budget')}>
            <span>{config.budgetLabel}</span>
            <strong>{formatMegabytes(payload.libraryByteSize)} / {formatMegabytes(payload.libraryByteBudget)}</strong>
            <i style={{ width: `${Math.min(100, payload.libraryByteSize / payload.libraryByteBudget * 100)}%` }} />
          </div>
          {payload.clips.length === 0 ? (
            <div className={cn('radio-library__empty')}>
              <FileAudio size={22} aria-hidden="true" />
              <strong>No broadcast clips yet</strong>
              <span>Register the first secured audio programme for this network.</span>
              <button type="button" onClick={enterNewClip}>Add first clip</button>
            </div>
          ) : (
            <div className={cn('radio-library__rows')}>
              {payload.clips.map((clip) => (
                <button key={clip.id} type="button" disabled={pendingAction === 'delete'} data-active={selectedClipId === clip.id ? 'true' : undefined} data-archived={clip.status === 'archived' ? 'true' : undefined} data-pending-delete={clip.pendingDeleteAt ? 'true' : undefined} onClick={() => selectClip(clip.id)}>
                  <FileAudio size={14} aria-hidden="true" />
                  <span><strong>{clip.internalLabel}</strong><small>{KIND_LABELS[clip.clipKind]} · {formatDuration(clip.durationMs)} · {clip.status}</small></span>
                  {clip.pendingDeleteAt ? <i>Delete pending</i> : clip.rotationEnabled ? <i>WEIGHT {clip.rotationWeight}</i> : <i>Off rotation</i>}
                </button>
              ))}
            </div>
          )}
        </aside>

        <div className={cn('radio-control__workbench')}>
          <section className={cn('radio-now')}>
            <header><span>Current broadcast</span><strong data-breaking={displayedMode === 'breaking' ? 'true' : undefined}>{payload.effective.stationStatus === 'on-air' ? displayedMode : 'Off air'}</strong></header>
            {current ? <p><Radio size={15} aria-hidden="true" /><span><strong>{current.publicLabel ?? KIND_LABELS[current.clipKind]}</strong><small>{KIND_LABELS[current.clipKind]}</small></span></p> : <p>{overrideElapsedLocally ? 'Normal rotation is synchronizing at the current station time.' : 'No playable clip is currently on air.'}</p>}
            <div className={cn('radio-now__override')}>
              <label><span>Programme clip</span><select value={overrideClipId} onChange={(event) => setOverrideClipId(event.target.value)} disabled={activeClips.length === 0}>{activeClips.map((clip) => <option key={clip.id} value={clip.id}>{clip.internalLabel}</option>)}</select></label>
              <button type="button" onClick={() => startOverride('play-now')} disabled={!payload.station.stationEnabled || !overrideClipId || Boolean(pendingAction)}><Radio size={13} /> Play now</button>
              <button type="button" className={cn('radio-breaking')} onClick={() => startOverride('breaking')} disabled={!payload.station.stationEnabled || !overrideClipId || Boolean(pendingAction)}><ShieldAlert size={13} /> Breaking</button>
              {overrideIsActive ? <button type="button" onClick={() => setConfirmation({ title: 'End active override?', body: 'Listeners will immediately return to the current wall-clock position in normal rotation.', confirmLabel: 'End override', tone: 'danger', action: async () => { setConfirmation(null); await runMutation('end', controller.endOverride, 'OVERRIDE ENDED') } })}><CircleStop size={13} /> End override</button> : null}
            </div>
            {!payload.station.stationEnabled ? <p className={cn('radio-now__hint')}>Enable the station before starting Play Now or Breaking.</p> : null}
          </section>

          <section className={cn('radio-breaking-setup')}>
            <header><ShieldAlert size={14} aria-hidden="true" /><strong>Breaking setup</strong></header>
            <p>Choose an optional global stinger. Every listener then hears the same stinger-to-programme timeline.</p>
            <div className={cn('radio-now__override')}>
              <label><span>Breaking stinger</span><select value={stingerClipId} onChange={(event) => setStingerClipId(event.target.value)} disabled={breakingOverrideActive}><option value="">No stinger · start programme immediately</option>{activeClips.map((clip) => <option key={clip.id} value={clip.id}>{clip.internalLabel} · {formatDuration(clip.durationMs)}</option>)}</select></label>
              <button type="button" className={cn('radio-primary')} onClick={() => void saveBreakingStinger()} disabled={breakingOverrideActive || !stingerDirty || Boolean(pendingAction)}>{pendingAction === 'stinger' ? <LoaderCircle className={cn('spin')} /> : <Save size={13} />} Save setup</button>
            </div>
            {breakingOverrideActive ? <p>End the active Breaking transmission before changing its stinger.</p> : null}
          </section>

          <section ref={uploadSectionRef} className={cn('radio-upload')} data-editor-mode={selected ? undefined : 'new'}>
            <header><Upload size={14} aria-hidden="true" /><strong>Register new clip</strong><span>New clip</span></header>
            <p>Choose compressed audio, verify its decoded metadata, then register it separately. MP3/M4A preferred · 2 seconds–15 minutes · maximum 15 MB · WAV/AIFF rejected.</p>
            <div className={cn('radio-fields')}>
              <label><span>Internal label</span><input value={uploadDraft.internalLabel} maxLength={120} placeholder="Visible only in the newsroom" onChange={(event) => setUploadDraft((value) => ({ ...value, internalLabel: event.target.value }))} /></label>
              <label><span>Public programme label</span><input value={uploadDraft.publicLabel ?? ''} maxLength={160} placeholder="Shown to tuned listeners" onChange={(event) => setUploadDraft((value) => ({ ...value, publicLabel: event.target.value }))} /></label>
              <label><span>Clip type</span><select value={uploadDraft.clipKind} onChange={(event) => setUploadDraft((value) => ({ ...value, clipKind: event.target.value as NewsPlatformBroadcastClipKind }))}>{newsPlatformBroadcastClipKinds.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}</select></label>
              <label><span>Rotation weight</span><input type="number" min={1} max={5} value={uploadDraft.rotationWeight} onChange={(event) => setUploadDraft((value) => ({ ...value, rotationWeight: Number(event.target.value) }))} /><small>Higher weight = plays more often · valid range 1–5</small></label>
              <label className={cn('radio-toggle')}><input type="checkbox" checked={uploadDraft.rotationEnabled} onChange={(event) => setUploadDraft((value) => ({ ...value, rotationEnabled: event.target.checked }))} /><span>Include in global rotation</span></label>
            </div>
            <input ref={fileInputRef} type="file" accept="audio/mpeg,audio/mp4,audio/m4a,audio/x-m4a,audio/ogg,audio/webm,.mp3,.m4a,.mp4,.ogg,.webm" hidden onChange={(event) => { const next = event.target.files?.[0] ?? null; event.currentTarget.value = ''; void inspectSelectedFile(next) }} />
            <div className={cn('radio-file')} data-state={fileState}>
              <FileAudio size={18} aria-hidden="true" />
              <div>
                <strong>{uploadFile?.name ?? 'No audio selected'}</strong>
                {fileState === 'checking' ? <span><LoaderCircle className={cn('spin')} /> Inspecting audio metadata…</span> : null}
                {fileState === 'ready' && uploadMetadata ? <span>{uploadMetadata.mimeType} · {formatFileSize(uploadMetadata.byteSize)} · {formatDuration(uploadMetadata.durationMs)} · Ready</span> : null}
                {fileState === 'invalid' ? <span role="alert">{fileError}</span> : null}
                {fileState === 'idle' ? <span>Supported: MP3, M4A/MP4, OGG, WebM</span> : null}
              </div>
            </div>
            <div className={cn('radio-upload__actions')}>
              <button ref={chooseAudioRef} type="button" onClick={() => fileInputRef.current?.click()} disabled={pendingAction === 'upload'}><FileAudio size={13} /> {uploadFile ? 'Replace audio' : 'Choose audio'}</button>
              {uploadFile && fileState === 'ready' ? <button type="button" onClick={() => void playPreview(uploadFile)}><Headphones size={13} /> {previewing === 'draft' ? 'Stop preview' : 'Preview file'}</button> : null}
              <button type="button" className={cn('radio-primary')} onClick={() => void upload()} disabled={!uploadFile || fileState !== 'ready' || !uploadDraft.internalLabel.trim() || pendingAction === 'upload'}>{pendingAction === 'upload' ? <LoaderCircle className={cn('spin')} /> : <Upload size={13} />} Upload &amp; register</button>
            </div>
          </section>

          {selected ? (
            <section className={cn('radio-clip-editor')} data-editor-mode="edit">
              <header><FileAudio size={14} /><strong>Edit clip</strong><span>{selectedPendingDelete ? 'Pending delete' : selected.status}</span></header>
              <div className={cn('radio-editor-summary')}><strong>{selected.internalLabel}</strong><span>{selected.mimeType} · {formatFileSize(selected.byteSize)} · {formatDuration(selected.durationMs)}</span></div>
              {selectedServerChanged ? <p className={cn('radio-control__warning')}>The server record changed in another tab. Your local edits were preserved.</p> : null}
              {selectedPendingDelete ? <p className={cn('radio-delete-pending')} role="status"><Trash2 size={14} aria-hidden="true" /><span><strong>Pending permanent delete</strong>The registered size still counts against the secure audio budget until deletion finishes.</span></p> : null}
              <div className={cn('radio-fields')}>
                <label><span>Internal label</span><input value={clipDraft.internalLabel} maxLength={120} disabled={selectedPendingDelete} onChange={(event) => setClipDraft((value) => ({ ...value, internalLabel: event.target.value }))} /></label>
                <label><span>Public programme label</span><input value={clipDraft.publicLabel ?? ''} maxLength={160} disabled={selectedPendingDelete} onChange={(event) => setClipDraft((value) => ({ ...value, publicLabel: event.target.value }))} /></label>
                <label><span>Clip type</span><select value={clipDraft.clipKind} disabled={selectedPendingDelete} onChange={(event) => setClipDraft((value) => ({ ...value, clipKind: event.target.value as NewsPlatformBroadcastClipKind }))}>{newsPlatformBroadcastClipKinds.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}</select></label>
                <label><span>Rotation weight</span><input type="number" min={1} max={5} value={clipDraft.rotationWeight} disabled={selectedPendingDelete} onChange={(event) => setClipDraft((value) => ({ ...value, rotationWeight: Number(event.target.value) }))} /><small>Higher weight = plays more often · valid range 1–5</small></label>
                <label className={cn('radio-toggle')} data-reserved={selectedIsBreakingIntro ? 'true' : undefined}><input type="checkbox" checked={selectedIsBreakingIntro ? false : clipDraft.rotationEnabled} disabled={selected.status === 'archived' || selectedIsBreakingIntro || selectedPendingDelete} onChange={(event) => setClipDraft((value) => ({ ...value, rotationEnabled: event.target.checked }))} /><span>Include in global rotation</span>{selectedIsBreakingIntro ? <small>Reserved as the Breaking stinger</small> : null}</label>
              </div>
              <footer>
                <button type="button" onClick={() => void playPreview(selected)} disabled={selectedPendingDelete}><Headphones size={13} /> {previewing === selected.id ? 'Stop preview' : 'Preview'}</button>
                <button type="button" className={cn('radio-primary')} disabled={selectedPendingDelete || !selectedDirty || Boolean(pendingAction)} onClick={() => void saveClip()}><Save size={13} /> Save settings</button>
                {selectedPendingDelete ? <button type="button" className={cn('radio-danger')} disabled={Boolean(pendingAction)} onClick={() => void deleteSelectedPermanently()}>{pendingAction === 'delete' ? <LoaderCircle className={cn('spin')} /> : <Trash2 size={13} />} Retry delete</button> : (
                  <>
                    <button type="button" disabled={Boolean(pendingAction)} onClick={() => setConfirmation({ title: selected.status === 'archived' ? 'Restore broadcast clip?' : 'Archive broadcast clip?', body: selected.status === 'archived' ? 'The clip returns to the active library but stays outside rotation until explicitly enabled.' : 'The clip leaves future rotation and remains recoverable in the newsroom.', confirmLabel: selected.status === 'archived' ? 'Restore clip' : 'Archive clip', tone: selected.status === 'archived' ? 'default' : 'danger', action: async () => { setConfirmation(null); const succeeded = await runMutation('archive', () => controller.setArchived(selected.id, selected.status !== 'archived'), `CLIP ${selected.status === 'archived' ? 'RESTORED' : 'ARCHIVED'}`); if (succeeded) { setSelectedClipId(null); setBaselineUpdatedAt(null) } } })}>{selected.status === 'archived' ? <RotateCcw size={13} /> : <Archive size={13} />}{selected.status === 'archived' ? 'Restore' : 'Archive'}</button>
                    {selected.status === 'archived' ? <button type="button" className={cn('radio-danger')} disabled={Boolean(pendingAction)} onClick={() => setConfirmation({ title: 'Delete audio permanently?', body: `This removes “${selected.internalLabel}” (${formatFileSize(selected.byteSize)}) from private Storage and frees its registered audio budget. This cannot be undone.`, confirmLabel: 'Delete permanently', tone: 'danger', action: deleteSelectedPermanently })}><Trash2 size={13} /> Delete permanently</button> : null}
                  </>
                )}
              </footer>
            </section>
          ) : null}
        </div>
      </div>

      {confirmation ? <NewsPlatformConfirmation className={config.dialogBackdropClassName} dialogClassName={config.dialogClassName} title={confirmation.title} body={confirmation.body} confirmLabel={confirmation.confirmLabel} tone={confirmation.tone} onCancel={() => setConfirmation(null)} onConfirm={() => void confirmation.action()} /> : null}
    </section>
  )
}
