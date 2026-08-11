import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Plus, Trash2, X, Check, Pencil, ImagePlus, Share2 } from 'lucide-react'
import {
  type RelationNpc,
  type RelationGroup,
  type RelationsData,
  makeNpcId,
  makeGroupId,
} from '../../lib/relationsTypes'
import { ImageCropDialog } from '../shared/ImageCropDialog'
import { SharedMediaImage } from '../shared/SharedMediaImage'
import { resolveSharedMediaUrl, uploadSharedImage } from '../../lib/media/mediaStorage'
import type { SharedMediaScope } from '../../lib/media/mediaTypes'
import { validateImageInput } from '../../lib/media/imageOptimization'

// ─── Tone colour system ───────────────────────────────────────────────────────

export type RelationsTone = 'blue' | 'red' | 'grey'
const RELATIONS_LAST_GROUP_KEY = 'rpgsilver.relations.last-group-id'

interface ToneColors {
  accent: string
  dim: string
  mid: string
  faint: string   // very subtle — for inactive/unhovered states
  glow: string
  bg: string
  bgCard: string
}

const TONE_COLORS: Record<RelationsTone, ToneColors> = {
  // Dark navy + bright cyan — matches blue sheet
  blue: {
    accent:  '#0da7ff',
    dim:     'rgba(13,167,255,0.20)',
    mid:     'rgba(13,167,255,0.40)',
    faint:   'rgba(13,167,255,0.10)',
    glow:    '0 0 12px rgba(13,167,255,0.55)',
    bg:      '#02061a',
    bgCard:  'rgba(4,10,30,0.95)',
  },
  // Dark red-black + vivid red — matches red sheet
  red: {
    accent:  '#cc1111',
    dim:     'rgba(204,17,17,0.22)',
    mid:     'rgba(204,17,17,0.42)',
    faint:   'rgba(204,17,17,0.10)',
    glow:    '0 0 12px rgba(204,17,17,0.6)',
    bg:      '#0f0004',
    bgCard:  'rgba(22,4,8,0.97)',
  },
  // Dark graphite + white — matches grey sheet
  grey: {
    accent:  '#f3f3ed',
    dim:     'rgba(243,243,237,0.16)',
    mid:     'rgba(243,243,237,0.34)',
    faint:   'rgba(243,243,237,0.08)',
    glow:    '0 0 8px rgba(243,243,237,0.22)',
    bg:      '#0d0d0d',
    bgCard:  'rgba(16,16,16,0.97)',
  },
}

// Keep these as module-level vars that get overridden per-render via context
// (we pass C down through props to keep things simple)
let CYAN      = '#0da7ff'
let CYAN_DIM  = 'rgba(13,167,255,0.20)'
let CYAN_MID  = 'rgba(13,167,255,0.40)'
let CYAN_FAINT = 'rgba(13,167,255,0.10)'
let CYAN_GLOW = '0 0 12px rgba(13,167,255,0.55)'
let BG        = '#02061a'
let BG_CARD   = 'rgba(4,10,30,0.95)'
let NEGATIVE_RELATION = '#ff365c'
let NEGATIVE_RELATION_DIM = 'rgba(255,54,92,0.18)'
let NEGATIVE_RELATION_MID = 'rgba(255,54,92,0.38)'
let NEGATIVE_RELATION_GLOW = '0 0 12px rgba(255,54,92,0.55)'

function applyTone(tone: RelationsTone) {
  const c   = TONE_COLORS[tone]
  CYAN       = c.accent
  CYAN_DIM   = c.dim
  CYAN_MID   = c.mid
  CYAN_FAINT = c.faint
  CYAN_GLOW  = c.glow
  BG         = c.bg
  BG_CARD    = c.bgCard
  NEGATIVE_RELATION = tone === 'red' ? '#f3e600' : '#ff365c'
  NEGATIVE_RELATION_DIM = tone === 'red' ? 'rgba(243,230,0,0.18)' : 'rgba(255,54,92,0.18)'
  NEGATIVE_RELATION_MID = tone === 'red' ? 'rgba(243,230,0,0.36)' : 'rgba(255,54,92,0.38)'
  NEGATIVE_RELATION_GLOW = tone === 'red' ? '0 0 12px rgba(243,230,0,0.42)' : '0 0 12px rgba(255,54,92,0.55)'
}

// ─── Octagon Status Indicators ───────────────────────────────────────────────

const NEGATIVE_RELATION_VALUES = [-5, -4, -3, -2, -1] as const
const POSITIVE_RELATION_VALUES = [1, 2, 3, 4, 5] as const

function normalizeRelationValue(value: number) {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.max(-5, Math.min(5, Math.round(value)))
}

function getNextRelationValue(currentValue: number, clickedValue: number) {
  const current = normalizeRelationValue(currentValue)

  if (current !== clickedValue) {
    return clickedValue
  }

  return clickedValue > 0 ? clickedValue - 1 : clickedValue + 1
}

function OctagonIndicator({
  filled,
  sentiment = 'positive',
}: {
  filled: boolean
  sentiment?: 'positive' | 'negative'
}) {
  const accent = sentiment === 'negative' ? NEGATIVE_RELATION : CYAN
  const dim = sentiment === 'negative' ? NEGATIVE_RELATION_DIM : CYAN_DIM
  const mid = sentiment === 'negative' ? NEGATIVE_RELATION_MID : CYAN_MID
  const glow = sentiment === 'negative' ? NEGATIVE_RELATION_GLOW : CYAN_GLOW

  return (
    <svg width="42" height="42" viewBox="0 0 42 42">
      <polygon
        points="13,3 29,3 39,13 39,29 29,39 13,39 3,29 3,13"
        fill={filled ? dim : 'none'}
        stroke={filled ? accent : dim}
        strokeWidth="1.5"
        style={{ filter: filled ? glow : 'none' }}
      />
      {filled && (
        <polygon
          points="17,9 25,9 33,17 33,25 25,33 17,33 9,25 9,17"
          fill={mid}
          stroke="none"
          style={{ filter: glow }}
        />
      )}
    </svg>
  )
}

function RelationScale({
  value,
  editing,
  onChange,
}: {
  value: number
  editing: boolean
  onChange: (value: number) => void
}) {
  const relation = normalizeRelationValue(value)

  const renderStep = (step: number) => {
    const negative = step < 0
    const filled = negative ? relation <= step : relation >= step

    if (!editing) {
      return (
        <OctagonIndicator
          key={step}
          filled={filled}
          sentiment={negative ? 'negative' : 'positive'}
        />
      )
    }

    return (
      <button
        key={step}
        type="button"
        onClick={() => onChange(getNextRelationValue(relation, step))}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        title={`Relacao ${step > 0 ? '+' : ''}${step}`}
      >
        <OctagonIndicator
          filled={filled}
          sentiment={negative ? 'negative' : 'positive'}
        />
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
      {NEGATIVE_RELATION_VALUES.map(renderStep)}
      <button
        type="button"
        disabled={!editing}
        onClick={() => onChange(0)}
        style={{
          width: '12px',
          height: '36px',
          border: 'none',
          borderLeft: `1px solid ${CYAN_DIM}`,
          borderRight: `1px solid ${CYAN_DIM}`,
          background: relation === 0 ? CYAN_FAINT : 'transparent',
          cursor: editing ? 'pointer' : 'default',
          padding: 0,
        }}
        title="Relacao 0"
      />
      {POSITIVE_RELATION_VALUES.map(renderStep)}
    </div>
  )
}

function RelationPips({ value }: { value: number }) {
  const relation = normalizeRelationValue(value)
  const renderPip = (step: number) => {
    const negative = step < 0
    const filled = negative ? relation <= step : relation >= step
    const color = negative ? NEGATIVE_RELATION : CYAN
    const dim = negative ? NEGATIVE_RELATION_DIM : CYAN_DIM
    const glow = negative ? NEGATIVE_RELATION_GLOW : CYAN_GLOW

    return (
      <div
        key={step}
        style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: filled ? color : dim,
          boxShadow: filled ? glow : 'none',
        }}
      />
    )
  }

  return (
    <div style={{ display: 'flex', gap: '2px', justifyContent: 'center', alignItems: 'center' }}>
      {NEGATIVE_RELATION_VALUES.map(renderPip)}
      <span
        style={{
          width: 4,
          height: 8,
          borderLeft: `1px solid ${CYAN_DIM}`,
          borderRight: `1px solid ${CYAN_DIM}`,
        }}
      />
      {POSITIVE_RELATION_VALUES.map(renderPip)}
    </div>
  )
}

// ─── Portrait Image Upload ────────────────────────────────────────────────────

function PortraitUpload({
  value,
  canEdit,
  mediaScope,
  slot,
  onChange,
  size = 'full',
}: {
  value?: string
  canEdit: boolean
  mediaScope: Pick<SharedMediaScope, 'subjectKind' | 'subjectId'>
  slot: string
  onChange: (reference: string) => void
  size?: 'full' | 'thumb'
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [cropSource, setCropSource] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const closeCrop = () => {
    if (cropSource?.startsWith('blob:')) URL.revokeObjectURL(cropSource)
    setCropSource(null)
  }
  const handleFile = (file: File) => {
    setUploadError(null)
    const validationError = validateImageInput(file, 'avatar')
    if (validationError) {
      setUploadError(validationError)
      return
    }
    setCropSource(URL.createObjectURL(file))
  }
  const editCurrent = async () => {
    setUploadError(null)
    try {
      setCropSource(await resolveSharedMediaUrl(value, 'display') ?? value ?? null)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'A imagem não pôde ser aberta.')
    }
  }

  return (
    <div className="group/portrait relative h-full w-full overflow-hidden" style={{ background: BG_CARD }}>
      {value ? (
        <>
          <SharedMediaImage source={value} className="absolute inset-0 h-full w-full object-cover" alt="" />
          {canEdit && (
            <div
              className="absolute right-1 top-1 flex gap-1 opacity-0 transition group-hover/portrait:opacity-100"
            >
              <button
                type="button"
                onClick={() => void editCurrent()}
                className="rounded p-1"
                style={{ background: 'rgba(0,0,0,0.7)' }}
                title="Ajustar foto"
              >
                <Pencil size={12} color={CYAN} />
              </button>
              <button
                type="button"
                onClick={() => onChange('')}
                className="rounded p-1"
                style={{ background: 'rgba(0,0,0,0.7)' }}
                title="Remover foto"
              >
                <X size={12} color={CYAN} />
              </button>
            </div>
          )}
        </>
      ) : canEdit ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 transition"
          style={{ color: CYAN_MID }}
          onMouseEnter={(e) => (e.currentTarget.style.color = CYAN)}
          onMouseLeave={(e) => (e.currentTarget.style.color = CYAN_MID)}
        >
          <ImagePlus size={size === 'full' ? 28 : 16} />
          {size === 'full' && (
            <span className="font-display uppercase" style={{ fontSize: '0.6rem', letterSpacing: '0.2em' }}>
              Foto
            </span>
          )}
        </button>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center" style={{ color: CYAN_DIM }}>
          <ImagePlus size={20} />
        </div>
      )}
      {canEdit && (
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) {
              void handleFile(file)
            }
            e.target.value = ''
          }}
        />
      )}
      {uploadError ? <span role="alert" className="absolute bottom-1 left-1 right-1 bg-black/80 px-2 py-1 text-[10px] text-rose-300">{uploadError}</span> : null}
      {cropSource ? (
        <ImageCropDialog
          source={cropSource}
          title="Ajustar retrato"
          description="Enquadra o retrato antes de o guardar no cartao da relacao."
          aspectRatio={4 / 5}
          outputWidth={960}
          outputHeight={1200}
          accentColor={CYAN}
          onCancel={closeCrop}
          onConfirm={async (blob) => {
            const uploaded = await uploadSharedImage({ ...mediaScope, mediaKind: 'relation', slot }, blob, 'avatar')
            onChange(uploaded.reference)
            closeCrop()
          }}
        />
      ) : null}
    </div>
  )
}

// ─── Cyber Field (label + value or input) ────────────────────────────────────

function CyberField({
  label,
  value,
  editing,
  onChange,
  multiline,
}: {
  label: string
  value?: string
  editing: boolean
  onChange: (v: string) => void
  multiline?: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <span
        className="font-mono uppercase"
        style={{ fontSize: '0.52rem', letterSpacing: '0.22em', color: CYAN_MID }}
      >
        {label}
      </span>
      {editing ? (
        multiline ? (
          <textarea
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            rows={5}
            className="resize-none bg-transparent outline-none"
            style={{
              border: `1px solid ${CYAN_MID}`,
              borderRadius: '2px',
              color: '#c8e8ff',
              fontSize: '0.72rem',
              padding: '4px 6px',
              fontFamily: 'inherit',
              lineHeight: 1.5,
            }}
          />
        ) : (
          <input
            type="text"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            className="bg-transparent outline-none"
            style={{
              border: `1px solid ${CYAN_MID}`,
              borderBottom: `1px solid ${CYAN}`,
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              color: '#c8e8ff',
              fontSize: '0.78rem',
              padding: '2px 0',
            }}
          />
        )
      ) : (
        <span
          className="font-display uppercase"
          style={{
            fontSize: '0.8rem',
            color: value ? '#c8e8ff' : CYAN_DIM,
            letterSpacing: '0.06em',
            borderBottom: `1px solid ${CYAN_DIM}`,
            paddingBottom: '2px',
            minHeight: '1.2rem',
          }}
        >
          {value || '—'}
        </span>
      )}
    </div>
  )
}

// ─── NPC Card View ───────────────────────────────────────────────────────────

function NpcCardView({
  npc,
  canEdit,
  canShare,
  selectedForShare,
  mediaScope,
  onBack,
  onSave,
  onDelete,
  onShare,
}: {
  npc: RelationNpc
  canEdit: boolean
  canShare: boolean
  selectedForShare: boolean
  mediaScope: Pick<SharedMediaScope, 'subjectKind' | 'subjectId'>
  onBack: () => void
  onSave: (updated: RelationNpc) => void
  onDelete: () => void
  onShare: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<RelationNpc>(npc)

  const set = <K extends keyof RelationNpc>(k: K, v: RelationNpc[K]) =>
    setDraft((prev) => ({ ...prev, [k]: v }))

  const handleSave = () => {
    onSave(draft)
    setEditing(false)
  }

  const handleCancel = () => {
    setDraft(npc)
    setEditing(false)
  }

  const d = editing ? draft : npc

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '0' }}>

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <button
          type="button"
          onClick={onBack}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', color: CYAN, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          <ArrowLeft size={14} />
          <span className="font-display uppercase" style={{ fontSize: '0.65rem', letterSpacing: '0.22em' }}>
            Voltar
          </span>
        </button>

        {(canEdit || canShare) && (
          <div style={{ display: 'flex', gap: '8px' }}>
            {canShare && (
              <button
                type="button"
                onClick={onShare}
                style={actionBtnStyle(selectedForShare ? '#f3e600' : CYAN)}
                title="Escolher esta amizade para enviar"
              >
                <Share2 size={13} />
                <span>{selectedForShare ? 'Escolhida' : 'Enviar'}</span>
              </button>
            )}
            {editing ? (
              <>
                <button type="button" onClick={handleSave} style={actionBtnStyle('#10ff8a')}>
                  <Check size={13} />
                  <span>Guardar</span>
                </button>
                <button type="button" onClick={handleCancel} style={actionBtnStyle(CYAN_MID)}>
                  <X size={13} />
                  <span>Cancelar</span>
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setEditing(true)} style={actionBtnStyle(CYAN)}>
                  <Pencil size={13} />
                  <span>Editar</span>
                </button>
                <button type="button" onClick={onDelete} style={actionBtnStyle('rgba(255,80,80,0.7)')}>
                  <Trash2 size={13} />
                  <span>Apagar</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', gap: '16px', minHeight: 0 }}>

        {/* Portrait */}
        <div
          style={{
            width: '34%',
            flexShrink: 0,
            border: `1px solid ${CYAN_MID}`,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <PortraitUpload
            value={d.image}
            canEdit={editing}
            mediaScope={mediaScope}
            slot={d.id}
            onChange={(img) => set('image', img)}
            size="full"
          />
        </div>

        {/* Info + status + acerca */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px', overflow: 'hidden' }}>

          {/* INFORMAÇÕES */}
          <div>
            <p className="font-display uppercase" style={{ fontSize: '0.58rem', letterSpacing: '0.3em', color: CYAN, marginBottom: '8px' }}>
              Informações
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
              <CyberField label="Nome" value={d.name} editing={editing} onChange={(v) => set('name', v)} />
              <CyberField label="Idade" value={d.idade} editing={editing} onChange={(v) => set('idade', v)} />
              <CyberField label="Altura" value={d.altura} editing={editing} onChange={(v) => set('altura', v)} />
              <CyberField label="Sexo" value={d.sexo} editing={editing} onChange={(v) => set('sexo', v)} />
              <CyberField label="Tipo de Sangue" value={d.tipoSangue} editing={editing} onChange={(v) => set('tipoSangue', v)} />
              <CyberField label="Tipologia" value={d.tipologia} editing={editing} onChange={(v) => set('tipologia', v)} />
              <CyberField label="Ocupação" value={d.ocupacao} editing={editing} onChange={(v) => set('ocupacao', v)} />
              <CyberField label="Karma" value={d.karma} editing={editing} onChange={(v) => set('karma', v)} />
            </div>
          </div>

          {/* STATUS DE RELAÇÕES */}
          <div>
            <p className="font-display uppercase" style={{ fontSize: '0.58rem', letterSpacing: '0.3em', color: CYAN, marginBottom: '8px' }}>
              Status de Relações
            </p>
            <RelationScale
              value={d.relacao}
              editing={editing}
              onChange={(value) => set('relacao', value)}
            />
          </div>

          {/* ACERCA DE */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <p className="font-display uppercase" style={{ fontSize: '0.58rem', letterSpacing: '0.3em', color: CYAN, marginBottom: '8px' }}>
              Acerca De
            </p>
            <div style={{ flex: 1, border: `1px solid ${CYAN_DIM}`, padding: '8px', overflow: 'hidden' }}>
              {editing ? (
                <textarea
                  value={d.acercaDe ?? ''}
                  onChange={(e) => set('acercaDe', e.target.value)}
                  className="resize-none bg-transparent outline-none"
                  style={{
                    width: '100%',
                    height: '100%',
                    color: '#c8e8ff',
                    fontSize: '0.72rem',
                    fontFamily: 'inherit',
                    lineHeight: 1.6,
                    border: 'none',
                  }}
                />
              ) : (
                <p
                  style={{
                    color: d.acercaDe ? '#c8e8ff' : CYAN_DIM,
                    fontSize: '0.72rem',
                    lineHeight: 1.6,
                    overflow: 'auto',
                    maxHeight: '100%',
                  }}
                >
                  {d.acercaDe || 'Sem informação.'}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── NPC Grid (character list for a group) ───────────────────────────────────

function NpcGrid({
  npcs,
  canEdit,
  canShare,
  selectedShareNpcId,
  onSelect,
  onAdd,
  onDelete,
  onShare,
}: {
  npcs: RelationNpc[]
  canEdit: boolean
  canShare: boolean
  selectedShareNpcId?: string | null
  onSelect: (id: string) => void
  onAdd: () => void
  onDelete: (id: string) => void
  onShare?: (npc: RelationNpc) => void
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '12px',
        padding: '4px 0',
      }}
    >
      {npcs.map((npc) => (
        <NpcSlot
          key={npc.id}
          npc={npc}
          canEdit={canEdit}
          canShare={canShare}
          selectedForShare={selectedShareNpcId === npc.id}
          onSelect={onSelect}
          onDelete={onDelete}
          onShare={() => onShare?.(npc)}
        />
      ))}

      {canEdit && (
        <button
          type="button"
          onClick={onAdd}
          style={{
            aspectRatio: '3/4',
            border: `1px dashed ${CYAN_DIM}`,
            background: 'none',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            color: CYAN_DIM,
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = CYAN
            e.currentTarget.style.color = CYAN
            e.currentTarget.style.boxShadow = CYAN_GLOW
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = CYAN_DIM
            e.currentTarget.style.color = CYAN_DIM
            e.currentTarget.style.boxShadow = 'none'
          }}
        >
          <Plus size={22} />
          <span className="font-display uppercase" style={{ fontSize: '0.6rem', letterSpacing: '0.2em' }}>
            Novo NPC
          </span>
        </button>
      )}
    </div>
  )
}

function NpcSlot({
  npc,
  canEdit,
  canShare,
  selectedForShare,
  onSelect,
  onDelete,
  onShare,
}: {
  npc: RelationNpc
  canEdit: boolean
  canShare: boolean
  selectedForShare: boolean
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onShare: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '5px' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Portrait */}
      <button
        type="button"
        onClick={() => onSelect(npc.id)}
        style={{
          aspectRatio: '3/4',
          border: `1px solid ${selectedForShare ? '#f3e600' : hovered ? CYAN : CYAN_DIM}`,
          background: BG_CARD,
          overflow: 'hidden',
          position: 'relative',
          cursor: 'pointer',
          boxShadow: selectedForShare ? '0 0 18px rgba(243,230,0,0.35)' : hovered ? CYAN_GLOW : 'none',
          transition: 'all 0.15s',
          padding: 0,
        }}
      >
        {npc.image ? (
          <SharedMediaImage source={npc.image} variant="thumbnail" className="absolute inset-0 h-full w-full object-cover" alt={npc.name} loading="lazy" decoding="async" />
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: CYAN_DIM,
            }}
          >
            <ImagePlus size={20} />
          </div>
        )}
        {/* Hover overlay */}
        {hovered && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: CYAN_DIM,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          />
        )}
      </button>

      {canShare && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onShare()
          }}
          style={{
            position: 'absolute',
            top: 4,
            left: 4,
            zIndex: 2,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: selectedForShare ? 'rgba(243,230,0,0.95)' : 'rgba(0,0,0,0.78)',
            border: selectedForShare ? '1px solid #f3e600' : `1px solid ${CYAN_MID}`,
            color: selectedForShare ? '#111' : CYAN,
            cursor: 'pointer',
            padding: '3px 6px',
            fontFamily: 'var(--font-display)',
            fontSize: '0.5rem',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
          }}
          title="Escolher esta amizade para enviar"
        >
          <Share2 size={10} />
          <span>{selectedForShare ? 'Ok' : 'Enviar'}</span>
        </button>
      )}

      {/* Name */}
      <span
        className="font-display uppercase text-center"
        style={{
          fontSize: '0.6rem',
          letterSpacing: '0.14em',
          color: hovered ? CYAN : 'rgba(200,232,255,0.7)',
          transition: 'color 0.15s',
          lineHeight: 1.2,
        }}
      >
        {npc.name || 'SEM NOME'}
      </span>

      {/* Relation dots */}
      <RelationPips value={npc.relacao} />

      {/* Delete button */}
      {canEdit && hovered && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(npc.id)
          }}
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            background: 'rgba(0,0,0,0.75)',
            border: '1px solid rgba(255,80,80,0.4)',
            borderRadius: '2px',
            cursor: 'pointer',
            padding: '2px',
            display: 'flex',
          }}
        >
          <Trash2 size={11} color="rgba(255,80,80,0.9)" />
        </button>
      )}
    </div>
  )
}

// ─── Add Group Input ──────────────────────────────────────────────────────────

function AddGroupInput({
  onConfirm,
  onCancel,
}: {
  onConfirm: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <input
        autoFocus
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value.toUpperCase())}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) onConfirm(value.trim())
          if (e.key === 'Escape') onCancel()
        }}
        placeholder="NOME DO GRUPO"
        style={{
          background: 'none',
          border: 'none',
          borderBottom: `1px solid ${CYAN}`,
          color: CYAN,
          fontSize: '0.68rem',
          fontFamily: 'var(--font-display)',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          outline: 'none',
          width: '120px',
          padding: '2px 0',
        }}
      />
      <button
        type="button"
        onClick={() => value.trim() && onConfirm(value.trim())}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}
      >
        <Check size={13} color="#10ff8a" />
      </button>
      <button
        type="button"
        onClick={onCancel}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}
      >
        <X size={13} color={CYAN_MID} />
      </button>
    </div>
  )
}

// ─── Shared button style helper ───────────────────────────────────────────────

function actionBtnStyle(color: string): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    background: 'none',
    border: `1px solid ${color}`,
    color: color,
    cursor: 'pointer',
    padding: '3px 8px',
    fontSize: '0.6rem',
    fontFamily: 'var(--font-display)',
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
  }
}

// ─── Main RelationsBoard ──────────────────────────────────────────────────────

interface RelationsBoardProps {
  data: RelationsData
  canEdit: boolean
  mediaScope: Pick<SharedMediaScope, 'subjectKind' | 'subjectId'>
  tone?: RelationsTone
  canShare?: boolean
  selectedShareNpcId?: string | null
  onChange: (updated: RelationsData) => void
  onShareNpc?: (npc: RelationNpc) => void
}

type BoardView = 'grid' | 'card'

export function RelationsBoard({
  data,
  canEdit,
  mediaScope,
  tone = 'blue',
  canShare = false,
  selectedShareNpcId = null,
  onChange,
  onShareNpc,
}: RelationsBoardProps) {
  applyTone(tone)
  const [selectedGroupId, setSelectedGroupId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const rememberedGroupId = window.localStorage.getItem(RELATIONS_LAST_GROUP_KEY)
      if (rememberedGroupId && data.groups.some((group) => group.id === rememberedGroupId)) {
        return rememberedGroupId
      }
    }

    return data.groups[0]?.id ?? ''
  })
  const [selectedNpcId, setSelectedNpcId] = useState<string | null>(null)
  const [view, setView] = useState<BoardView>('grid')
  const [addingGroup, setAddingGroup] = useState(false)

  const activeGroupId = data.groups.some((group) => group.id === selectedGroupId)
    ? selectedGroupId
    : data.groups[0]?.id ?? ''
  const selectedGroup = data.groups.find((g) => g.id === activeGroupId)
  const groupNpcs = data.npcs.filter((n) => n.groupId === activeGroupId)
  const selectedNpc = selectedNpcId
    ? data.npcs.find((n) => n.id === selectedNpcId && n.groupId === activeGroupId)
    : null

  useEffect(() => {
    if (typeof window === 'undefined' || !activeGroupId) {
      return
    }

    window.localStorage.setItem(RELATIONS_LAST_GROUP_KEY, activeGroupId)
  }, [activeGroupId])

  // ── Group operations ──

  const addGroup = (name: string) => {
    const group: RelationGroup = { id: makeGroupId(), name }
    const updated = { ...data, groups: [...data.groups, group] }
    onChange(updated)
    setSelectedGroupId(group.id)
    setAddingGroup(false)
    setView('grid')
  }

  const deleteGroup = (id: string) => {
    const updated: RelationsData = {
      groups: data.groups.filter((g) => g.id !== id),
      npcs: data.npcs.filter((n) => n.groupId !== id),
    }
    onChange(updated)
    if (activeGroupId === id) {
      setSelectedGroupId(updated.groups[0]?.id ?? '')
      setView('grid')
      setSelectedNpcId(null)
    }
  }

  // ── NPC operations ──

  const addNpc = () => {
    const npc: RelationNpc = {
      id: makeNpcId(),
      groupId: activeGroupId,
      name: '',
      relacao: 0,
    }
    const updated = { ...data, npcs: [...data.npcs, npc] }
    onChange(updated)
    setSelectedNpcId(npc.id)
    setView('card')
  }

  const saveNpc = (updated: RelationNpc) => {
    onChange({
      ...data,
      npcs: data.npcs.map((n) => (n.id === updated.id ? updated : n)),
    })
  }

  const deleteNpc = (id: string) => {
    onChange({ ...data, npcs: data.npcs.filter((n) => n.id !== id) })
    setSelectedNpcId(null)
    setView('grid')
  }

  const openCard = (id: string) => {
    setSelectedNpcId(id)
    setView('card')
  }

  const backToGrid = () => {
    setSelectedNpcId(null)
    setView('grid')
  }

  // ── Render ──

  return (
    <div
      style={{
        background: BG,
        border: `1px solid ${CYAN_MID}`,
        boxShadow: `inset 0 0 60px ${CYAN_DIM}, 0 0 0 1px ${CYAN_DIM}`,
        padding: '20px 24px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        minHeight: '520px',
      }}
    >
      {/* ── Header: group tabs ─────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0',
          borderBottom: `1px solid ${CYAN_DIM}`,
          paddingBottom: '0',
        }}
      >
        {data.groups.map((group) => (
          <GroupTab
            key={group.id}
            group={group}
            active={group.id === activeGroupId}
            canEdit={canEdit}
            onSelect={() => {
              setSelectedGroupId(group.id)
              setView('grid')
              setSelectedNpcId(null)
            }}
            onDelete={() => deleteGroup(group.id)}
          />
        ))}

        {/* Separator + Add group */}
        {canEdit && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '8px' }}>
            {addingGroup ? (
              <AddGroupInput
                onConfirm={addGroup}
                onCancel={() => setAddingGroup(false)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setAddingGroup(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  background: 'none',
                  border: `1px solid ${CYAN_DIM}`,
                  color: CYAN_DIM,
                  cursor: 'pointer',
                  padding: '3px 8px',
                  fontSize: '0.58rem',
                  fontFamily: 'var(--font-display)',
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = CYAN
                  e.currentTarget.style.color = CYAN
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = CYAN_DIM
                  e.currentTarget.style.color = CYAN_DIM
                }}
              >
                <Plus size={11} />
                Grupo
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Breadcrumb ──────────────────────────────────────────── */}
      {view === 'card' && selectedNpc && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className="font-display uppercase" style={{ fontSize: '0.58rem', letterSpacing: '0.2em', color: CYAN_MID }}>
            {selectedGroup?.name}
          </span>
          <span style={{ color: CYAN_DIM, fontSize: '0.65rem' }}>›</span>
          <span className="font-display uppercase" style={{ fontSize: '0.58rem', letterSpacing: '0.2em', color: CYAN }}>
            {selectedNpc.name || 'SEM NOME'}
          </span>
        </div>
      )}

      {/* ── Content ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {view === 'grid' ? (
          <NpcGrid
            npcs={groupNpcs}
            canEdit={canEdit}
            canShare={canShare}
            selectedShareNpcId={selectedShareNpcId}
            onSelect={openCard}
            onAdd={addNpc}
            onDelete={deleteNpc}
            onShare={onShareNpc}
          />
        ) : selectedNpc ? (
          <NpcCardView
            npc={selectedNpc}
            canEdit={canEdit}
            mediaScope={mediaScope}
            canShare={canShare}
            selectedForShare={selectedShareNpcId === selectedNpc.id}
            onBack={backToGrid}
            onSave={saveNpc}
            onDelete={() => deleteNpc(selectedNpc.id)}
            onShare={() => onShareNpc?.(selectedNpc)}
          />
        ) : null}
      </div>
    </div>
  )
}

// ─── Group Tab ────────────────────────────────────────────────────────────────

function GroupTab({
  group,
  active,
  canEdit,
  onSelect,
  onDelete,
}: {
  group: RelationGroup
  active: boolean
  canEdit: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      style={{ position: 'relative', display: 'flex', alignItems: 'stretch' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        onClick={onSelect}
        className="font-display uppercase"
        style={{
          padding: '6px 16px 10px',
          background: active ? CYAN_DIM : hovered ? CYAN_FAINT : 'none',
          border: active ? `1px solid ${CYAN_MID}` : `1px solid transparent`,
          borderBottom: active ? '1px solid ' + BG : `1px solid transparent`,
          color: active ? CYAN : hovered ? CYAN_MID : CYAN_FAINT,
          cursor: 'pointer',
          fontSize: '0.68rem',
          letterSpacing: '0.22em',
          transition: 'all 0.15s',
          textShadow: active ? CYAN_GLOW : 'none',
          marginBottom: '-1px',
        }}
      >
        {group.name}
      </button>

      {/* Delete group */}
      {canEdit && hovered && !active && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          style={{
            position: 'absolute',
            top: 2,
            right: 2,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '1px',
          }}
        >
          <X size={9} color="rgba(255,80,80,0.7)" />
        </button>
      )}
    </div>
  )
}
