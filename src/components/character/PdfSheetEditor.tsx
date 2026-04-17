import { ChevronDown, ImagePlus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { CyberwareBoard } from './CyberwareBoard'
import { RelationsBoard } from './RelationsBoard'
import {
  DEBUG_INPUTS_ONLY,
  type SheetFieldVisualPreset,
  sheetFieldVisualPresets,
  sheetImageZoneConfigs,
  sheetPageSectionConfigs,
  type SheetLayoutBox,
} from '../../lib/pdfSheetLayoutConfig'
import { parseRelationsData, stringifyRelationsData } from '../../lib/relationsTypes'
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

const statFieldNames = new Set([
  'PV', 'PV-ATUAL', 'PS', 'PS-ATUAL', 'PE', 'PE-ATUAL',
  'DEFESA', 'BLOQUEIO', 'DESL', 'EX', 'EX 1',
])

const infoFieldKeys = new Set([
  'NOME',
  'IDADE',
  'ALTURA',
  'SEXO',
  'NACIONALIDADE',
  'TIPOLOGIA',
  'OCUPACAO',

])

const page2AttributeKeys = new Set([
  'AGILIDADE',
  'VIGOR',
  'PRESENCA',
  'FORCA',
  'INTELIGENCIA',
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

function isCodexValueField(field: PdfSheetTemplateField) {
  return field.page === 3 && /^CUSTO\d+$/i.test(field.name)
}

function isCodexTextField(field: PdfSheetTemplateField) {
  return field.page === 3 && (/^HAB ?\d+$/i.test(field.name) || /^DESC\d+$/i.test(field.name))
}

function isCodexSingleLineTextField(field: PdfSheetTemplateField) {
  return isCodexTextField(field)
}

function isPage2AttributeField(field: PdfSheetTemplateField) {
  return field.page === 2 && page2AttributeKeys.has(normalizeFieldKey(field.name))
}

function isPage2AttributeTopField(field: PdfSheetTemplateField) {
  return field.page === 2 && /-TOP$/i.test(field.name)
}

function isPage2ResourceField(field: PdfSheetTemplateField) {
  return field.page === 2 && ['PV', 'PV-ATUAL', 'PS', 'PS-ATUAL', 'PE', 'PE-ATUAL', 'DEFESA', 'BLOQUEIO', 'DESL', 'EX', 'EX 1'].includes(field.name)
}

function isNumericField(field: PdfSheetTemplateField) {
  return hasNormalizedPage2Attribute(field) || isPage2AttributeTopField(field) || isPage2ResourceField(field) || isCodexValueField(field) || isSkillBonusBox2(field) || field.name === 'CYBERPHYSHOSIS'
}

function isRamField(field: PdfSheetTemplateField) {
  return field.page === 2 && field.name === 'DESL'
}

function normalizeFieldKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+1$/, '')
    .replace(/[^A-Z0-9]/g, '')
}

function hasNormalizedPage2Attribute(field: PdfSheetTemplateField) {
  return isPage2AttributeField(field)
}

function isInfoField(field: PdfSheetTemplateField) {
  return field.page === 1 && infoFieldKeys.has(normalizeFieldKey(field.name))
}

function isSkillBonusBox2(field: PdfSheetTemplateField) {
  return field.page === 2 && / 2$/i.test(field.name) && skillSelectKeys.has(normalizeFieldKey(field.name.replace(/ 2$/i, ' 1')))
}

function isSkillSelectField(field: PdfSheetTemplateField) {
  return field.page === 2 && !/ 2$/i.test(field.name) && skillSelectKeys.has(normalizeFieldKey(field.name))
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

type FieldVisualPresetKey = keyof typeof sheetFieldVisualPresets

function resolveFieldSectionId(field: PdfSheetTemplateField) {
  if (field.page === 1) {
    if (field.name === 'CIDADE') return 'page1-city'
    if (isInfoField(field)) return 'page1-info'
    if (/^(ATAQUES|TESTE|DANO)\d+$/i.test(field.name)) return 'page1-attacks'
    if (field.name === 'KARMA') return 'page1-karma'
    if (/^INV \d+$/i.test(field.name) || /^ESP\d+$/i.test(field.name)) return 'page1-inventory'
    if (field.name === 'CYBERPHYSHOSIS') return 'page1-cyberpsychosis'
  }

  if (field.page === 2) {
    if (hasNormalizedPage2Attribute(field) || isPage2AttributeTopField(field)) return 'page2-attributes'
    if (isSkillSelectField(field) || isSkillScoreField(field) || isSkillBonusBox2(field)) return 'page2-skills'
    if (['PV', 'PV-ATUAL', 'PS', 'PS-ATUAL', 'PE', 'PE-ATUAL'].includes(field.name)) return 'page2-vitals'
    if (['DESL', 'EX', 'EX 1', 'DEFESA', 'BLOQUEIO'].includes(field.name)) return 'page2-combat'
  }

  if (field.page === 3) {
    const codexIndex = Number(field.name.replace(/^\D+/g, ''))
    return codexIndex > 11 ? 'page3-codex-bottom' : 'page3-codex-top'
  }

  return null
}

function resolveFieldVisualPreset(field: PdfSheetTemplateField): FieldVisualPresetKey {
  if (field.name === 'CIDADE') return 'city'
  if (isInfoField(field)) return 'info'
  if (field.name === 'KARMA') return 'page1Karma'
  if (field.name === 'CYBERPHYSHOSIS') return 'page1Cyberpsychosis'
  if (/^INV \d+$/i.test(field.name)) return 'inventoryCell'
  if (/^ESP\d+$/i.test(field.name)) return 'inventoryCellCentered'
  if (/^ATAQUES\d+$/i.test(field.name)) return 'attackCell'
  if (/^TESTE\d+$/i.test(field.name) || /^DANO\d+$/i.test(field.name)) return 'attackCellCentered'
  if (hasNormalizedPage2Attribute(field)) return 'page2Attribute'
  if (isPage2AttributeTopField(field)) return 'page2AttributeTop'
  if (isSkillSelectField(field)) return 'skillSelect'
  if (isSkillBonusBox2(field)) return 'skillBonus'
  if (isSkillScoreField(field)) return 'skillScore'
  if (isRamField(field)) return 'page2Ram'
  if (['DEFESA', 'BLOQUEIO', 'EX', 'EX 1'].includes(field.name)) return 'page2CombatStat'
  if (statFieldNames.has(field.name)) return 'page2Stat'
  if (isCodexValueField(field)) return 'codexValue'
  if (isCodexTextField(field)) return 'codexText'
  if (isMultilineField(field)) return 'multiline'
  return field.height > 24 ? 'tallCell' : 'compactCell'
}

function getFieldInputClassName(field: PdfSheetTemplateField, canEdit: boolean) {
  const preset = sheetFieldVisualPresets[resolveFieldVisualPreset(field)] as SheetFieldVisualPreset

  return [
    'absolute inset-0 h-full w-full border-none bg-transparent text-[#f8f8f4] shadow-none outline-none box-border',
    'appearance-none caret-white',
    preset.fontClass,
    canEdit ? '' : 'pointer-events-none',
  ].join(' ')
}

function buildFieldInputStyle(field: PdfSheetTemplateField) {
  const preset = sheetFieldVisualPresets[resolveFieldVisualPreset(field)] as SheetFieldVisualPreset

  return {
    padding: preset.padding,
    fontSize: preset.fontSize,
    lineHeight: preset.lineHeight,
    textAlign: preset.textAlign,
    letterSpacing: preset.letterSpacing ?? '0.04em',
    fontStyle: preset.italic ? 'italic' : 'normal',
    fontWeight: preset.fontWeight ?? '400',
    overflow: 'hidden',
    textOverflow: 'clip',
    whiteSpace: isMultilineField(field) ? 'pre-wrap' : 'nowrap',
    overflowWrap: 'anywhere',
  } satisfies React.CSSProperties
}

function buildBoxStyle(
  box: SheetLayoutBox,
  pageSize: (typeof pdfSheetPageSizes)[number],
  referenceBox?: SheetLayoutBox,
) {
  const top = pageSize.height - (box.y + box.height)

  if (!referenceBox) {
    return {
      left: `${(box.x / pageSize.width) * 100}%`,
      top: `${(top / pageSize.height) * 100}%`,
      width: `${(box.width / pageSize.width) * 100}%`,
      height: `${(box.height / pageSize.height) * 100}%`,
    } satisfies React.CSSProperties
  }

  const referenceTop = pageSize.height - (referenceBox.y + referenceBox.height)

  return {
    left: `${((box.x - referenceBox.x) / referenceBox.width) * 100}%`,
    top: `${((top - referenceTop) / referenceBox.height) * 100}%`,
    width: `${(box.width / referenceBox.width) * 100}%`,
    height: `${(box.height / referenceBox.height) * 100}%`,
  } satisfies React.CSSProperties
}

function buildDebugInputStyle(): React.CSSProperties {
  return DEBUG_INPUTS_ONLY
    ? {
        outline: '1px dashed rgba(255, 215, 0, 0.78)',
      }
    : {}
}


// Zonas de imagem na página 1 (coordenadas em % da página)


function ImageUploadZone({
  value,
  canEdit,
  onChange,
}: {
  value: string
  canEdit: boolean
  onChange: (dataUrl: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onChange(reader.result)
      }
    }
    reader.readAsDataURL(file)
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
              pointerEvents: 'none',
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
  tone,
}: {
  pageNumber: number
  templateUrl: string
  fieldData: Record<string, string>
  onFieldChange: (fieldName: string, value: string) => void
  canEdit: boolean
  tone: 'blue' | 'red' | 'grey'
}) {
  const pageSize = pdfSheetPageSizes[pageNumber - 1]
  const pageRef = useRef<HTMLElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [renderError, setRenderError] = useState(false)
  const [sheetScale, setSheetScale] = useState(1)

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

  useEffect(() => {
    const node = pageRef.current

    if (!node) {
      return
    }

    const updateScale = () => {
      const nextScale = node.getBoundingClientRect().width / pageSize.width

      setSheetScale((current) => (Math.abs(current - nextScale) > 0.001 ? nextScale : current))
    }

    updateScale()

    const observer = new ResizeObserver(() => updateScale())
    observer.observe(node)

    return () => observer.disconnect()
  }, [pageSize.width])

  const pageFields = pdfSheetTemplateFields.filter((field) => field.page === pageNumber)
  const pageSections = sheetPageSectionConfigs.filter((section) => section.page === pageNumber)
  const pageImageZones = sheetImageZoneConfigs.filter((zone) => zone.page === pageNumber)
  const fieldsBySectionId = useMemo(() => {
    const grouped = new Map<string, PdfSheetTemplateField[]>()

    for (const field of pageFields) {
      const sectionId = resolveFieldSectionId(field)

      if (!sectionId) {
        continue
      }

      const bucket = grouped.get(sectionId)

      if (bucket) {
        bucket.push(field)
      } else {
        grouped.set(sectionId, [field])
      }
    }

    return grouped
  }, [pageFields])
  const pageStyle = useMemo(
    () => ({
      aspectRatio: `${pageSize.width} / ${pageSize.height}`,
      '--sheet-scale': `${sheetScale}`,
    }),
    [pageSize.height, pageSize.width, sheetScale],
  )

  const renderField = (field: PdfSheetTemplateField, sectionBox?: SheetLayoutBox) => {
    const fieldBox = { x: field.x, y: field.y, width: field.width, height: field.height }
    const wrapperStyle = buildBoxStyle(fieldBox, pageSize, sectionBox)
    const inputClassName = getFieldInputClassName(field, canEdit)
    const inputStyle = field.name === 'CIDADE'
      ? { ...buildFieldInputStyle(field), ...buildDebugInputStyle(), fontFamily: 'CyberwayRiders, sans-serif' }
      : { ...buildFieldInputStyle(field), ...buildDebugInputStyle() }
    const fieldKey = `${field.page}-${field.name}-${field.widgetIndex}`

    if (field.name === 'SEXO') {
      const value = fieldData['SEXO'] ?? ''

      return (
        <div key={fieldKey} className="absolute overflow-hidden" style={wrapperStyle}>
          <select
            value={value}
            disabled={!canEdit}
            spellCheck={false}
            onChange={(event) => onFieldChange('SEXO', event.target.value)}
            className={`${inputClassName} cursor-pointer`}
            style={inputStyle}
          >
            <option value="">-</option>
            <option value="Masculino">Masculino</option>
            <option value="Feminino">Feminino</option>
          </select>
        </div>
      )
    }

    if (isSkillScoreField(field)) {
      const value = fieldData[field.name] ?? '0'

      return (
        <div
            key={fieldKey}
            className="absolute flex items-center justify-center overflow-hidden"
            style={wrapperStyle}
        >
          <span
            className="absolute inset-0 flex items-center justify-center font-display text-[#f8f8f4]"
            style={inputStyle}
          >
            {value || '0'}
          </span>
        </div>
      )
    }

    if (isSkillSelectField(field)) {
      const value = resolveSkillSelectValue(field.name, fieldData)
      const scoreFieldName = getSkillScoreFieldName(field.name)

      return (
        <div key={fieldKey} className="absolute overflow-hidden" style={wrapperStyle}>
          <select
            value={value}
            disabled={!canEdit}
            spellCheck={false}
            onChange={(event) => {
              const nextValue = event.target.value
              const option = skillSelectOptions.find((entry) => entry.label === nextValue)

              onFieldChange(field.name, nextValue)

              if (scoreFieldName && option) {
                onFieldChange(scoreFieldName, option.score)
              }
            }}
            className={`${inputClassName} cursor-pointer`}
            style={{ ...inputStyle, padding: '0.02rem 0.72rem 0 0.08rem' }}
          >
            {skillSelectOptions.map((option) => (
              <option key={option.label || 'empty'} value={option.label}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={10}
            className="pointer-events-none absolute right-[0.1rem] top-1/2 -translate-y-1/2 text-[#2d2d2d]"
          />
        </div>
      )
    }

    const value = fieldData[field.name] ?? ''

    if (isMultilineField(field) && !isCodexValueField(field) && !isCodexSingleLineTextField(field)) {
      return (
        <div key={fieldKey} className="absolute overflow-hidden" style={wrapperStyle}>
          <textarea
            value={value}
            readOnly={!canEdit}
            spellCheck={false}
            onChange={(event) => onFieldChange(field.name, event.target.value)}
            className={`${inputClassName} resize-none`}
            style={inputStyle}
          />
        </div>
      )
    }

    return (
      <div key={fieldKey} className="absolute overflow-hidden" style={wrapperStyle}>
        <input
          value={value}
          readOnly={!canEdit}
          spellCheck={false}
          inputMode={isNumericField(field) ? 'numeric' : 'text'}
          onChange={(event) => onFieldChange(field.name, event.target.value)}
          className={inputClassName}
          style={inputStyle}
        />
      </div>
    )
  }

  return (
    <section
      ref={pageRef}
      className="relative overflow-hidden border-2 border-white/70 bg-[#a7a7a6] shadow-[0_18px_50px_rgba(0,0,0,0.35)]"
      style={pageStyle}
    >
      {renderError ? (
        <div className="absolute inset-0 bg-[#a7a7a6]" />
      ) : (
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      )}

      {pageNumber === 4 ? (
        <CyberwareBoard
          fieldData={fieldData}
          onFieldChange={onFieldChange}
          canEdit={canEdit}
          tone={tone}
        />
      ) : null}

      {pageImageZones.map((imageZone) => (
        <div
          key={imageZone.id}
          className="group/img absolute overflow-hidden"
          style={{
            ...imageZone.absoluteStyle,
            pointerEvents: canEdit ? 'auto' : 'none',
          }}
        >
          <ImageUploadZone
            value={fieldData[imageZone.fieldName] ?? ''}
            canEdit={canEdit}
            onChange={(dataUrl) => onFieldChange(imageZone.fieldName, dataUrl)}
          />
        </div>
      ))}
      {pageSections.map((section) => {
        const sectionFields = fieldsBySectionId.get(section.id) ?? []
        if (!sectionFields.length) {
          return null
        }

        return (
          <div
            key={section.id}
            className="absolute"
            style={{
              ...buildBoxStyle(section.box, pageSize),
              ...(section.clip ? { overflow: 'hidden' } : {}),
            }}
          >


            {sectionFields.map((field) => renderField(field, section.box))}
          </div>
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

  const relationsData = parseRelationsData(fieldData['P5_RELATIONS'])

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
          tone={color}
        />
      ))}

      {/* Page 5 — Relações */}
      <div className="col-span-2">
        <RelationsBoard
          data={relationsData}
          canEdit={canEdit}
          tone={color}
          onChange={(updated) => onFieldChange('P5_RELATIONS', stringifyRelationsData(updated))}
        />
      </div>
    </div>
  )
}

export function PdfSheetPreview({
  fieldData,
  pageNumber = 1,
  className,
}: {
  fieldData: Record<string, string>
  pageNumber?: number
  className?: string
}) {
  const color = karmaToColor(fieldData['KARMA'] ?? '')
  const gender = sexoToGender(fieldData['SEXO'] ?? '')
  const templateUrl = TEMPLATE_URLS[`${color}-${gender}`] ?? TEMPLATE_URLS['grey-m']
  const safePageNumber = Math.min(5, Math.max(1, Math.round(pageNumber)))
  const relationsData = parseRelationsData(fieldData['P5_RELATIONS'])

  return (
    <div className={className}>
      {safePageNumber === 5 ? (
        <RelationsBoard
          data={relationsData}
          canEdit={false}
          tone={color}
          onChange={() => {}}
        />
      ) : (
        <TemplatePdfPage
          pageNumber={safePageNumber}
          templateUrl={templateUrl}
          fieldData={fieldData}
          onFieldChange={() => {}}
          canEdit={false}
          tone={color}
        />
      )}
    </div>
  )
}







