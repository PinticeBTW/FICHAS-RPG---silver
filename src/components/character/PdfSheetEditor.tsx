import { ChevronDown, ImagePlus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { pdfSheetPageSizes, pdfSheetTemplateFields, type PdfSheetTemplateField } from '../../lib/pdfSheetTemplate'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const TEMPLATE_URLS: Record<string, string> = {
  'blue-m': '/templates/sheet-blue-m.pdf',
  'blue-f': '/templates/sheet-blue-f.pdf',
  'grey-m': '/templates/sheet-grey-m.pdf',
  'grey-f': '/templates/sheet-grey-f.pdf',
  'red-m': '/templates/sheet-red-m.pdf',
  'red-f': '/templates/sheet-red-f.pdf',
}

function karmaToColor(karma: string): 'blue' | 'grey' | 'red' {
  const trimmed = karma.trim()
  if (trimmed.startsWith('+')) return 'blue'
  if (trimmed.startsWith('-')) return 'red'
  return 'grey'
}

function sexoToGender(sexo: string): 'm' | 'f' {
  const v = sexo.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const feminine = ['f', 'feminino', 'mulher', 'femea', 'female']
  return feminine.some((w) => v === w || v.startsWith(w)) ? 'f' : 'm'
}

const centeredFieldNames = new Set([
  'AGILIDADE', 'VIGOR', 'PRESENÇA', 'FORÇA', 'INTELIGENCIA',
  'KARMA', 'CYBERPHYSHOSIS',
  'PV', 'PV-ATUAL', 'PS', 'PS-ATUAL', 'PE', 'PE-ATUAL',
  'DEFESA', 'BLOQUEIO', 'DESL', 'EX', 'EX 1',
  // Ataques: TESTE e DANO centrados
  'TESTE1','TESTE2','TESTE3','TESTE4','TESTE5','TESTE6','TESTE7',
  'TESTE8','TESTE9','TESTE10','TESTE11','TESTE12','TESTE13',
  'DANO1','DANO2','DANO3','DANO4','DANO5','DANO6','DANO7',
  'DANO8','DANO9','DANO10','DANO11','DANO12','DANO13',
  // Inventário: ESPAÇO centrado
  'ESP1','ESP2','ESP3','ESP4','ESP5','ESP6','ESP7','ESP8','ESP9','ESP10','ESP11',
  // Codex: CUSTO centrado
  'CUSTO1','CUSTO2','CUSTO3','CUSTO4','CUSTO5','CUSTO6','CUSTO7','CUSTO8','CUSTO9','CUSTO10',
  'CUSTO11','CUSTO12','CUSTO13','CUSTO14','CUSTO15','CUSTO16','CUSTO17','CUSTO18','CUSTO19','CUSTO20',
])

// Campos muito grandes (atributos principais + cyberpsychosis)
const largeFieldNames = new Set([
  'CIDADE', 'AGILIDADE', 'VIGOR', 'PRESENÇA', 'FORÇA', 'INTELIGENCIA',
  'CYBERPHYSHOSIS',
])

// Karma — tamanho médio
const karmaFieldNames = new Set(['KARMA'])

// Campos de stats numéricos (vida, ram, defesa, etc.)
const statFieldNames = new Set([
  'PV', 'PV-ATUAL', 'PS', 'PS-ATUAL', 'PE', 'PE-ATUAL',
  'DEFESA', 'BLOQUEIO', 'DESL', 'EX', 'EX 1',
])

const infoFieldNames = new Set([
  'NOME',
  'IDADE',
  'ALTURA',
  'SEXO',
  'NACIONALIDADE',
  'TIPOLOGIA',
  'OCUPAÇÃO',
  'OCUPACAO',
])

const skillSelectKeys = new Set([
  'ACROBACIA',
  'ARTES',
  'ATLETISMO',
  'ATUALIDADES',
  'CIENCIAS',
  'CRIME',
  'CONDUCAO',
  'DIPLOMACIA',
  'DOMISTICACAO',
  'FORTITUDE',
  'FURTIVIDADE',
  'INICIATIVA',
  'INTIMIDACAO',
  'INTUICAO',
  'INVESTIGACAO',
  'LUTA',
  'MEDICINA',
  'MENTIRA',
  'PRECEPCAO',
  'PONTARIA',
  'PROFISSAO',
  'REFLEXOS',
  'RELIGIAO',
  'SOBREVIVENCIA',
  'TATICA',
  'TECNOLOGIA',
  'VONTADE',
])

const skillSelectOptions = [
  { label: '', score: '0' },
  { label: 'Bom', score: '5' },
  { label: 'Mestre', score: '10' },
  { label: 'Fudido', score: '15' },
  { label: 'Bom - TEMP', score: '5' },
  { label: 'Mestre - TEMP', score: '10' },
  { label: 'Fudido - TEMP', score: '15' },
] as const

const scoreToOptionLabel = new Map<string, string>([
  ['5', 'Bom'],
  ['10', 'Mestre'],
  ['15', 'Fudido'],
])

const templateCache = new Map<string, Promise<PDFDocumentProxy>>()

function loadTemplateDocument(url: string) {
  if (!templateCache.has(url)) {
    templateCache.set(url, getDocument(url).promise)
  }

  return templateCache.get(url)!
}

function isMultilineField(field: PdfSheetTemplateField) {
  return /^DESC\d+$/i.test(field.name) || /^HAB ?\d+$/i.test(field.name) || /^CUSTO\d+$/i.test(field.name)
}

function normalizeFieldKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+1$/, '')
    .replace(/[^A-Z0-9]/g, '')
}

function isSkillSelectField(field: PdfSheetTemplateField) {
  return field.page === 2 && skillSelectKeys.has(normalizeFieldKey(field.name))
}

function isSkillScoreField(field: PdfSheetTemplateField) {
  return field.page === 2 && /\s1$/i.test(field.name) && skillSelectKeys.has(normalizeFieldKey(field.name))
}

function getSkillScoreFieldName(fieldName: string) {
  const field = pdfSheetTemplateFields.find(
    (entry) =>
      entry.page === 2 &&
      /\s1$/i.test(entry.name) &&
      normalizeFieldKey(entry.name) === normalizeFieldKey(fieldName),
  )

  return field?.name ?? null
}

function resolveSkillSelectValue(fieldName: string, fieldData: Record<string, string>) {
  const explicitValue = fieldData[fieldName] ?? ''

  if (skillSelectOptions.some((option) => option.label === explicitValue)) {
    return explicitValue
  }

  const numericFieldName = getSkillScoreFieldName(fieldName)

  if (!numericFieldName) {
    return explicitValue
  }

  const score = (fieldData[numericFieldName] ?? '').trim()

  return scoreToOptionLabel.get(score) ?? explicitValue
}

function getFieldClassName(field: PdfSheetTemplateField, canEdit: boolean) {
  const isCentered = centeredFieldNames.has(field.name)
  const isLarge = largeFieldNames.has(field.name)
  const isKarma = karmaFieldNames.has(field.name)
  const isStat = statFieldNames.has(field.name)
  const isMultiline = isMultilineField(field)
  const isInfoField = infoFieldNames.has(field.name)

  return [
    'absolute border-none bg-transparent text-[#f8f8f4] shadow-none outline-none',
    'appearance-none font-display tracking-[0.04em] caret-white',
    isCentered ? 'text-center' : 'text-left',
    canEdit ? '' : 'pointer-events-none',
    isLarge
      ? 'text-[clamp(1.6rem,3vw,3.6rem)] leading-[0.88]'
      : isKarma
        ? 'text-[clamp(1.1rem,2vw,2.6rem)] leading-[0.88]'
        : isStat
          ? 'text-[clamp(1.1rem,1.9vw,2.2rem)] leading-none'
          : isInfoField
            ? 'font-body text-[clamp(1.1rem,1.35vw,1.55rem)] font-semibold italic leading-none tracking-normal'
            : isMultiline
              ? 'text-[1.3rem] leading-[1.15]'
              : field.height > 24
                ? 'text-[1rem] leading-none'
                : 'text-[0.82rem] leading-none',
  ].join(' ')
}

function buildFieldStyle(field: PdfSheetTemplateField) {
  const pageSize = pdfSheetPageSizes[field.page - 1]
  const top = pageSize.height - (field.y + field.height)

  return {
    left: `${(field.x / pageSize.width) * 100}%`,
    top: `${(top / pageSize.height) * 100}%`,
    width: `${(field.width / pageSize.width) * 100}%`,
    height: `${(field.height / pageSize.height) * 100}%`,
    padding: largeFieldNames.has(field.name) || karmaFieldNames.has(field.name)
      ? '0.18rem 0.35rem'
      : isMultilineField(field)
        ? '0.32rem 0.42rem'
        : '0.18rem 0.28rem',
  } satisfies React.CSSProperties
}

// Zonas de imagem na página 1 (coordenadas em % da página)
const portraitZone: {
  style: React.CSSProperties
  cropW: number
  cropH: number
  imagePosition?: string
} = {
  style: { left: '65.3%', top: '43.7%', width: '31.8%', height: '15.2%' },
  cropW: 320,
  cropH: 180,
  imagePosition: 'center center',
}

const infoPhotoZone: {
  style: React.CSSProperties
  cropW: number
  cropH: number
  imagePosition?: string
} = {
  style: { left: '3.6%', top: '11.1%', width: '46.2%', height: '31.25%' },
  cropW: 360,
  cropH: 300,
  imagePosition: 'center center',
}

function ImageUploadZone({
  value,
  canEdit,
  onChange,
  cropW,
  cropH,
  imagePosition,
  imageInset,
}: {
  value: string
  canEdit: boolean
  onChange: (dataUrl: string) => void
  cropW: number
  cropH: number
  imagePosition?: string
  imageInset?: React.CSSProperties
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = (file: File) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const W = cropW
      const H = cropH
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d')!
      // crop ao centro mantendo proporção
      const scale = Math.max(W / img.width, H / img.height)
      const sw = W / scale
      const sh = H / scale
      const sx = (img.width - sw) / 2
      const sy = (img.height - sh) / 2
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H)
      URL.revokeObjectURL(url)
      onChange(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.src = url
  }

  return (
    <>
      {value ? (
        <>
          <img
            src={value}
            className="absolute object-cover"
            style={{
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              ...(imagePosition ? { objectPosition: imagePosition } : {}),
              ...(imageInset ?? {}),
            }}
          />
          {canEdit && (
            <button
              type="button"
              onClick={() => onChange('')}
              className="absolute right-1 top-1 rounded bg-black/60 p-1 text-white opacity-0 transition hover:bg-black/80 hover:opacity-100 group-hover/img:opacity-100"
              title="Remover foto"
            >
              <X size={12} />
            </button>
          )}
        </>
      ) : canEdit ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="absolute inset-0 flex items-center justify-center gap-2 text-stone-500 transition hover:text-stone-300 hover:bg-white/5"
        >
          <ImagePlus size={20} />
          <span className="text-xs">Adicionar foto</span>
        </button>
      ) : null}
      {canEdit && (
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      )}
    </>
  )
}

function TemplatePdfPage({
  pageNumber,
  templateUrl,
  fieldData,
  onFieldChange,
  canEdit,
}: {
  pageNumber: number
  templateUrl: string
  fieldData: Record<string, string>
  onFieldChange: (fieldName: string, value: string) => void
  canEdit: boolean
}) {
  const pageSize = pdfSheetPageSizes[pageNumber - 1]
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [renderError, setRenderError] = useState(false)

  useEffect(() => {
    let cancelled = false

    const render = async () => {
      try {
        setRenderError(false)
        const document = await loadTemplateDocument(templateUrl)
        const page = await document.getPage(pageNumber)
        const viewport = page.getViewport({ scale: 2 })
        const canvas = canvasRef.current

        if (!canvas || cancelled) {
          return
        }

        const context = canvas.getContext('2d')

        if (!context) {
          return
        }

        canvas.width = viewport.width
        canvas.height = viewport.height

        await page.render({
          canvas,
          canvasContext: context,
          viewport,
        }).promise
      } catch {
        if (!cancelled) {
          setRenderError(true)
        }
      }
    }

    void render()

    return () => {
      cancelled = true
    }
  }, [pageNumber, templateUrl])

  const pageFields = pdfSheetTemplateFields.filter((field) => field.page === pageNumber)
  const pageStyle = useMemo(
    () => ({
      aspectRatio: `${pageSize.width} / ${pageSize.height}`,
    }),
    [pageSize.height, pageSize.width],
  )

  return (
    <section
      className="relative overflow-hidden border-2 border-white/70 bg-[#a7a7a6] shadow-[0_18px_50px_rgba(0,0,0,0.35)]"
      style={pageStyle}
    >
      {renderError ? (
        <div className="absolute inset-0 bg-[#a7a7a6]" />
      ) : (
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      )}

      {pageNumber === 1 ? (
        <>
          <div className="group/img absolute overflow-hidden" style={infoPhotoZone.style}>
          <ImageUploadZone
            value={fieldData.FOTO2 ?? ''}
            canEdit={canEdit}
              onChange={(dataUrl) => onFieldChange('FOTO2', dataUrl)}
              cropW={infoPhotoZone.cropW}
              cropH={infoPhotoZone.cropH}
              imagePosition={infoPhotoZone.imagePosition}
            />
          </div>

          <div className="group/img absolute overflow-hidden" style={portraitZone.style}>
          <ImageUploadZone
            value={fieldData.FOTO ?? ''}
            canEdit={canEdit}
              onChange={(dataUrl) => onFieldChange('FOTO', dataUrl)}
              cropW={portraitZone.cropW}
              cropH={portraitZone.cropH}
              imagePosition={portraitZone.imagePosition}
            />
          </div>
        </>
      ) : null}

      {pageFields.map((field) => {
        const style = buildFieldStyle(field)
        const className = getFieldClassName(field, canEdit)

        if (field.name === 'SEXO') {
          const value = fieldData['SEXO'] ?? ''
          return (
            <select
              key={`${field.page}-${field.name}-${field.widgetIndex}`}
              value={value}
              disabled={!canEdit}
              onChange={(e) => onFieldChange('SEXO', e.target.value)}
              className={`${className} cursor-pointer`}
              style={style}
            >
              <option value="">—</option>
              <option value="Masculino">Masculino</option>
              <option value="Feminino">Feminino</option>
            </select>
          )
        }

        if (isSkillScoreField(field)) {
          const value = fieldData[field.name] ?? '0'

          return (
            <div
              key={`${field.page}-${field.name}-${field.widgetIndex}`}
              className="absolute flex items-center justify-center"
              style={style}
            >
              <span className="font-display text-[0.82rem] leading-none tracking-[0.04em] text-[#f8f8f4]">
                {value || '0'}
              </span>
            </div>
          )
        }

        if (isSkillSelectField(field)) {
          const value = resolveSkillSelectValue(field.name, fieldData)
          const scoreFieldName = getSkillScoreFieldName(field.name)

          return (
            <div
              key={`${field.page}-${field.name}-${field.widgetIndex}`}
              className="absolute"
              style={style}
            >
              <select
                value={value}
                disabled={!canEdit}
                onChange={(event) => {
                  const nextValue = event.target.value
                  const option = skillSelectOptions.find((entry) => entry.label === nextValue)

                  onFieldChange(field.name, nextValue)

                  if (scoreFieldName && option) {
                    onFieldChange(scoreFieldName, option.score)
                  }
                }}
                className={`${className} h-full w-full pr-6 italic`}
                style={{ inset: 0, padding: '0.08rem 1.15rem 0.08rem 0.2rem' }}
              >
                {skillSelectOptions.map((option) => (
                  <option key={option.label || 'empty'} value={option.label}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="pointer-events-none absolute right-[0.14rem] top-1/2 -translate-y-1/2 text-[#2d2d2d]"
              />
            </div>
          )
        }

        const value = fieldData[field.name] ?? ''

        if (isMultilineField(field)) {
          return (
            <textarea
              key={`${field.page}-${field.name}-${field.widgetIndex}`}
              value={value}
              readOnly={!canEdit}
              onChange={(event) => onFieldChange(field.name, event.target.value)}
              className={`${className} resize-none`}
              style={style}
            />
          )
        }

        return (
          <input
            key={`${field.page}-${field.name}-${field.widgetIndex}`}
            value={value}
            readOnly={!canEdit}
            onChange={(event) => onFieldChange(field.name, event.target.value)}
            className={className}
            style={field.name === 'CIDADE' ? { ...style, fontFamily: 'CyberwayRiders, sans-serif' } : style}
          />
        )
      })}
    </section>
  )
}

export function PdfSheetEditor({
  fieldData,
  onFieldChange,
  canEdit,
}: {
  fieldData: Record<string, string>
  onFieldChange: (fieldName: string, value: string) => void
  canEdit: boolean
}) {
  const color = karmaToColor(fieldData['KARMA'] ?? '')
  const gender = sexoToGender(fieldData['SEXO'] ?? '')
  const templateUrl = TEMPLATE_URLS[`${color}-${gender}`] ?? TEMPLATE_URLS['grey-m']

  return (
    <div className="grid grid-cols-2 gap-4">
      {[1, 2, 3, 4].map((pageNumber) => (
        <TemplatePdfPage
          key={pageNumber}
          pageNumber={pageNumber}
          templateUrl={templateUrl}
          fieldData={fieldData}
          onFieldChange={onFieldChange}
          canEdit={canEdit}
        />
      ))}
    </div>
  )
}
