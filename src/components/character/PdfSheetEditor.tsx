import { ChevronDown, ChevronsUpDown, ImagePlus, Link2, Lock, Pencil, Play, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { CyberwareBoard } from './CyberwareBoard'
import { ImageCropDialog } from '../shared/ImageCropDialog'
import { SharedMediaImage } from '../shared/SharedMediaImage'
import { resolveSharedMediaUrl, uploadSharedImage } from '../../lib/media/mediaStorage'
import type { SharedMediaScope } from '../../lib/media/mediaTypes'
import { validateImageInput } from '../../lib/media/imageOptimization'
import {
  DEBUG_INPUTS_ONLY,
  type SheetFieldVisualPreset,
  sheetFieldVisualPresets,
  sheetImageZoneConfigs,
  sheetPageSectionConfigs,
  type SheetLayoutBox,
} from '../../lib/pdfSheetLayoutConfig'
import { pdfSheetPageSizes, pdfSheetTemplateFields, type PdfSheetTemplateField } from '../../lib/pdfSheetTemplate'
import type { SheetEconomySubjectKind } from '../../lib/sheetEconomyService'
import { useSheetEconomySources } from './useSheetEconomySources'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const PDF_TEMPLATE_VERSION = 'page2-v3'
const templateUrl = (path: string) => `${path}?v=${PDF_TEMPLATE_VERSION}`

const TEMPLATE_URLS: Record<string, string> = {
  'blue-m': templateUrl('/templates/sheet-blue-m.pdf'),
  'blue-f': templateUrl('/templates/sheet-blue-f.pdf'),
  // Red and grey source assets are currently named inversely.
  'grey-m': templateUrl('/templates/sheet-red-m.pdf'),
  'grey-f': templateUrl('/templates/sheet-red-f.pdf'),
  'red-m': templateUrl('/templates/sheet-grey-m.pdf'),
  'red-f': templateUrl('/templates/sheet-grey-f.pdf'),
}

const KARMA_FIELD_ALIASES = ['KARMA', 'Karma', 'karma', 'K4rma', 'K4RMA'] as const
const SHEET_MONEY_SOURCE_STORAGE_PREFIX = 'rpgsilver-sheet-money-source:'

type SheetMoneySourceId = 'vlt' | 'vox-bank' | 'shneider-bank' | 'altara-bank'

interface SheetMoneySourcePresentation {
  readonly id: SheetMoneySourceId
  readonly label: 'CASH' | 'VOX BANK' | 'SHNEIDER' | 'ALTARA BANK'
  readonly value: string
  readonly available: boolean
  readonly status: 'ready' | 'loading' | 'error' | 'unavailable'
  readonly title: string
}

const DEFAULT_SHEET_MONEY_SOURCE: SheetMoneySourcePresentation = {
  id: 'vlt',
  label: 'CASH',
  value: '',
  available: true,
  status: 'ready',
  title: 'Read-only VLT wallet balance',
}

const noopMoneySourceToggle = () => undefined

function readStoredMoneySource(storageKey: string): SheetMoneySourceId {
  if (!storageKey || typeof window === 'undefined') return 'vlt'
  try {
    const stored = window.localStorage.getItem(storageKey)
    return stored === 'vox-bank' || stored === 'shneider-bank' ? stored : 'vlt'
  } catch {
    return 'vlt'
  }
}

function storeMoneySource(storageKey: string, sourceId: SheetMoneySourceId) {
  if (!storageKey || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey, sourceId)
  } catch {
    // A blocked preference store must never block the sheet itself.
  }
}

function karmaToColor(karma: string): 'blue' | 'grey' | 'red' {
  const normalized = karma.normalize('NFKC').trim()
  const compact = normalized.replace(/\s+/g, '')

  if (!compact || compact === '-') return 'grey'
  if (compact === '--') return 'red'

  if (/^[+-]?[0-9]+$/u.test(compact)) {
    const value = Number(compact)
    if (value > 0) return 'blue'
    if (value < 0) return 'red'
    return 'grey'
  }

  if (/[+\uFF0B\uFE62]/u.test(compact)) return 'blue'
  if (/[-\u2010\u2011\u2012\u2013\u2014\uFE63\uFF0D\u2212|\uFF5C]/u.test(compact)) return 'red'

  // Any non-empty value without explicit '+' should be treated as negative.
  return 'red'
}

function sexoToGender(sexo: string): 'm' | 'f' {
  const v = sexo.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const feminine = ['f', 'feminino', 'mulher', 'femea', 'female']
  return feminine.some((w) => v === w || v.startsWith(w)) ? 'f' : 'm'
}

function readKarmaValue(fieldData: Record<string, string>) {
  for (const key of KARMA_FIELD_ALIASES) {
    const value = fieldData[key]
    if (typeof value === 'string' && value.trim()) {
      return value
    }
  }

  for (const key of KARMA_FIELD_ALIASES) {
    const value = fieldData[key]
    if (typeof value === 'string') {
      return value
    }
  }

  return ''
}
const statFieldNames = new Set([
  'PV', 'PV-ATUAL', 'PS', 'PS-ATUAL', 'PE', 'PE-ATUAL',
  'PV-TEMP', 'PV-ATUAL-TEMP', 'PS-TEMP', 'PS-ATUAL-TEMP', 'PE-TEMP', 'PE-ATUAL-TEMP',
  'DEFESA', 'BLOQUEIO', 'DESL', 'EX', 'EX 1',
])

const page2VitalFieldNames = new Set([
  'PV',
  'PV-TEMP',
  'PV-ATUAL',
  'PV-ATUAL-TEMP',
  'PS',
  'PS-TEMP',
  'PS-ATUAL',
  'PS-ATUAL-TEMP',
  'PE',
  'PE-TEMP',
  'PE-ATUAL',
  'PE-ATUAL-TEMP',
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
  'MECANICA',
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
  { label: 'Bom - Negativo', score: '-5' },
  { label: 'Mestre - Negativo', score: '-10' },
  { label: 'Fudido - Negativo', score: '-15' },
  { label: 'Bom - TEMP', score: '5' },
  { label: 'Mestre - TEMP', score: '10' },
  { label: 'Fudido - TEMP', score: '15' },
] as const

const scoreToOptionLabel = new Map<string, string>([
  ['5', 'Bom'],
  ['10', 'Mestre'],
  ['15', 'Fudido'],
  ['-5', 'Bom - Negativo'],
  ['-10', 'Mestre - Negativo'],
  ['-15', 'Fudido - Negativo'],
])

const templateCache = new Map<string, Promise<PDFDocumentProxy>>()
const CODEX_UNLOCK_LINKS_FIELD = '__CODEX_UNLOCK_LINKS'
const CODEX_UNLOCK_USED_FIELD = '__CODEX_UNLOCK_USED'

function loadTemplateDocument(url: string) {
  if (!templateCache.has(url)) {
    templateCache.set(url, getDocument(url).promise)
  }

  return templateCache.get(url)!
}

function isMultilineField(field: PdfSheetTemplateField) {
  return (
    /^DESC\d+$/i.test(field.name) ||
    /^HAB ?\d+$/i.test(field.name) ||
    /^CUSTO\d+$/i.test(field.name) ||
    /^DESCPE\d+$/i.test(field.name) ||
    /^HABPE\d+$/i.test(field.name) ||
    /^CUSTOPE\d+$/i.test(field.name)
  )
}

function isManualLineBreakField(field: PdfSheetTemplateField) {
  return field.page === 1 && /^ATAQUES\d+$/i.test(field.name)
}

function supportsLineBreaks(field: PdfSheetTemplateField) {
  return isMultilineField(field) || isManualLineBreakField(field)
}

function isCodexValueField(field: PdfSheetTemplateField) {
  return (field.page === 3 || field.page === 4) && (/^CUSTO\d+$/i.test(field.name) || /^CUSTOPE\d+$/i.test(field.name))
}

function isCodexTextField(field: PdfSheetTemplateField) {
  return (
    (field.page === 3 || field.page === 4) &&
    (/^HAB ?\d+$/i.test(field.name) || /^DESC\d+$/i.test(field.name) || /^HABPE\d+$/i.test(field.name) || /^DESCPE\d+$/i.test(field.name))
  )
}

function isCodexAbilityNameField(field: PdfSheetTemplateField) {
  return (
    (field.page === 3 && /^HAB ?\d+$/i.test(field.name)) ||
    (field.page === 4 && /^HABPE\d+$/i.test(field.name))
  )
}

function isCodexDescriptionField(field: PdfSheetTemplateField) {
  return (
    (field.page === 3 && /^DESC\d+$/i.test(field.name)) ||
    (field.page === 4 && /^DESCPE\d+$/i.test(field.name))
  )
}

function getCodexAbilityFieldName(field: PdfSheetTemplateField) {
  const slot = getCodexSlot(field.name, field.page)

  if (!slot) {
    return null
  }

  return field.page === 3 ? (slot === 1 ? 'HAB 1' : `HAB${slot}`) : `HABPE${slot}`
}

function getCodexDescriptionTitle(field: PdfSheetTemplateField, fieldData: Record<string, string>) {
  const abilityFieldName = getCodexAbilityFieldName(field)
  const abilityName = abilityFieldName ? fieldData[abilityFieldName]?.trim() : ''

  return abilityName || 'DESCRIÇÃO'
}

function isCodexSingleLineTextField(field: PdfSheetTemplateField) {
  return isCodexTextField(field)
}

function shouldRenderTextareaField(field: PdfSheetTemplateField) {
  return (
    isManualLineBreakField(field) ||
    (isMultilineField(field) && !isCodexValueField(field) && !isCodexSingleLineTextField(field))
  )
}

function isPage2AttributeField(field: PdfSheetTemplateField) {
  return field.page === 2 && page2AttributeKeys.has(normalizeFieldKey(field.name))
}

function isPage2AttributeTopField(field: PdfSheetTemplateField) {
  return field.page === 2 && /-TOP$/i.test(field.name)
}

function isPage2ResourceField(field: PdfSheetTemplateField) {
  return field.page === 2 && (page2VitalFieldNames.has(field.name) || ['DEFESA', 'BLOQUEIO', 'DESL', 'EX', 'EX 1'].includes(field.name))
}

function isNumericField(field: PdfSheetTemplateField) {
  return hasNormalizedPage2Attribute(field) || isPage2AttributeTopField(field) || isPage2ResourceField(field) || isCodexValueField(field) || isSkillBonusBox2(field) || field.name === 'CYBERPHYSHOSIS' || field.name === 'CASH'
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

type CodexResourceKind = 'ram' | 'pe'

type CodexResourceState = {
  fieldName: 'DESL' | 'PE-ATUAL'
  available: number | null
}

type CodexUnlockState = Record<CodexResourceKind, Record<string, number[]>>
type CodexUnlockUsageState = Record<CodexResourceKind, Record<string, boolean>>

type CodexAbilityRowState = {
  slot: number
  resourceKind: CodexResourceKind
  cost: number | null
  spendCost: number | null
  resource: CodexResourceState
  abilityName: string
  hasContent: boolean
  isUnlockSource: boolean
  unlockGroupKey: string | null
  linkedTargetSlots: number[]
  unlockUsed: boolean
  prerequisiteSourceSlot: number | null
  prerequisiteLabel: string | null
  isLockedByPrerequisite: boolean
  isResourceBlocked: boolean
  isBlocked: boolean
  rowBox: SheetLayoutBox
  actionBox: SheetLayoutBox
  linkBox: SheetLayoutBox
  clearLinkBox: SheetLayoutBox
}

function parseSheetNumber(value: string | undefined) {
  if (!value?.trim()) {
    return null
  }

  const match = value.match(/[-\u2010\u2011\u2012\u2013\u2014\u2212\uFE63\uFF0D]?\s*\d+(?:[,.]\d+)?/u)
  if (!match) {
    return null
  }

  const parsed = Number(
    match[0]
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212\uFE63\uFF0D]/gu, '-')
      .replace(/\s+/g, '')
      .replace(',', '.'),
  )
  return Number.isFinite(parsed) ? parsed : null
}

function hasNegativeSheetNumber(value: string | undefined) {
  return /[-\u2010\u2011\u2012\u2013\u2014\u2212\uFE63\uFF0D]\s*\d/u.test(value ?? '')
}

function normalizeCodexUnlockGroupName(value: string) {
  const normalized = normalizeFieldKey(value)

  return normalized || null
}

function formatSheetNumber(value: number) {
  const normalized = Math.max(0, value)
  return Number.isInteger(normalized)
    ? String(normalized)
    : String(Number(normalized.toFixed(2)))
}

function resolveCodexResourceState(kind: CodexResourceKind, fieldData: Record<string, string>): CodexResourceState {
  if (kind === 'ram') {
    return {
      fieldName: 'DESL',
      available: parseSheetNumber(fieldData.DESL),
    }
  }

  return {
    fieldName: 'PE-ATUAL',
    available: parseSheetNumber(fieldData['PE-ATUAL']) ?? parseSheetNumber(fieldData.PE),
  }
}

function createEmptyCodexUnlockState(): CodexUnlockState {
  return {
    ram: {},
    pe: {},
  }
}

function createEmptyCodexUnlockUsageState(): CodexUnlockUsageState {
  return {
    ram: {},
    pe: {},
  }
}

function parseCodexUnlockState(value: string | undefined): CodexUnlockState {
  const fallback = createEmptyCodexUnlockState()

  if (!value?.trim()) {
    return fallback
  }

  try {
    const parsed = JSON.parse(value) as unknown

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fallback
    }

    for (const kind of ['ram', 'pe'] as const) {
      const entries = (parsed as Record<string, unknown>)[kind]

      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
        continue
      }

      for (const [sourceSlot, targetSlotValue] of Object.entries(entries as Record<string, unknown>)) {
        const normalizedSource = Number(sourceSlot)
        const targetSlotValues = Array.isArray(targetSlotValue) ? targetSlotValue : [targetSlotValue]
        const normalizedTargets = [...new Set(
          targetSlotValues
            .map((targetSlot) => Number(targetSlot))
            .filter(
              (targetSlot) =>
                Number.isInteger(targetSlot) &&
                targetSlot > 0 &&
                targetSlot !== normalizedSource,
            ),
        )]

        if (Number.isInteger(normalizedSource) && normalizedSource > 0 && normalizedTargets.length) {
          fallback[kind][String(normalizedSource)] = normalizedTargets
        }
      }
    }
  } catch {
    return fallback
  }

  return fallback
}

function parseCodexUnlockUsageState(value: string | undefined): CodexUnlockUsageState {
  const fallback = createEmptyCodexUnlockUsageState()

  if (!value?.trim()) {
    return fallback
  }

  try {
    const parsed = JSON.parse(value) as unknown

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fallback
    }

    for (const kind of ['ram', 'pe'] as const) {
      const entries = (parsed as Record<string, unknown>)[kind]

      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
        continue
      }

      for (const [sourceSlot, used] of Object.entries(entries as Record<string, unknown>)) {
        const normalizedSource = Number(sourceSlot)

        if (Number.isInteger(normalizedSource) && normalizedSource > 0 && used === true) {
          fallback[kind][String(normalizedSource)] = true
        }
      }
    }
  } catch {
    return fallback
  }

  return fallback
}

function serializeCodexUnlockState(value: CodexUnlockState) {
  return JSON.stringify(value)
}

function serializeCodexUnlockUsageState(value: CodexUnlockUsageState) {
  return JSON.stringify(value)
}

function getCodexSlot(fieldName: string, pageNumber: number) {
  const ramMatch =
    pageNumber === 3 ? fieldName.match(/^(?:HAB ?|CUSTO|DESC)(\d+)$/i) : null
  const peMatch =
    pageNumber === 4 ? fieldName.match(/^(?:HABPE|CUSTOPE|DESCPE)(\d+)$/i) : null
  const slot = Number((ramMatch ?? peMatch)?.[1])

  return Number.isInteger(slot) && slot > 0 ? slot : null
}

function buildCodexAbilityRowStates(
  pageNumber: number,
  pageFields: PdfSheetTemplateField[],
  fieldData: Record<string, string>,
  unlockLinks: CodexUnlockState,
  unlockUsage: CodexUnlockUsageState,
): CodexAbilityRowState[] {
  if (pageNumber !== 3 && pageNumber !== 4) {
    return []
  }

  const resourceKind: CodexResourceKind = pageNumber === 3 ? 'ram' : 'pe'
  const resource = resolveCodexResourceState(resourceKind, fieldData)
  const linksForKind = unlockLinks[resourceKind]
  const usageForKind = unlockUsage[resourceKind]
  const fieldsBySlot = new Map<number, PdfSheetTemplateField[]>()

  for (const field of pageFields) {
    const slot = getCodexSlot(field.name, pageNumber)

    if (!slot) {
      continue
    }

    const fields = fieldsBySlot.get(slot)
    if (fields) {
      fields.push(field)
    } else {
      fieldsBySlot.set(slot, [field])
    }
  }

  const baseRows = [...fieldsBySlot.entries()]
    .sort(([left], [right]) => left - right)
    .map(([slot, fields]) => {
      const costFieldName = resourceKind === 'ram' ? `CUSTO${slot}` : `CUSTOPE${slot}`
      const abilityFieldName = resourceKind === 'ram' ? (slot === 1 ? 'HAB 1' : `HAB${slot}`) : `HABPE${slot}`
      const descriptionFieldName = resourceKind === 'ram' ? `DESC${slot}` : `DESCPE${slot}`
      const costField = fields.find((field) => field.name === costFieldName)
      const costValue = fieldData[costFieldName]
      const cost = parseSheetNumber(costValue)
      const isUnlockSource = cost !== null && hasNegativeSheetNumber(costValue)
      const abilityName = fieldData[abilityFieldName]?.trim() || `Habilidade ${slot}`
      const hasContent = [abilityFieldName, costFieldName, descriptionFieldName].some(
        (fieldName) => Boolean(fieldData[fieldName]?.trim()),
      )
      const left = Math.min(...fields.map((field) => field.x))
      const right = Math.max(...fields.map((field) => field.x + field.width))
      const bottom = Math.min(...fields.map((field) => field.y))
      const top = Math.max(...fields.map((field) => field.y + field.height))
      const rowBox = {
        x: left,
        y: bottom,
        width: right - left,
        height: top - bottom,
      }
      const costRight = (costField?.x ?? left + 150) + (costField?.width ?? 60)
      const costIconY = (costField?.y ?? bottom) + 5
      const costIconHeight = Math.max(11, (costField?.height ?? rowBox.height) - 10)

      return {
        slot,
        resourceKind,
        cost,
        spendCost: cost === null ? null : Math.abs(cost),
        resource,
        abilityName,
        hasContent,
        isUnlockSource,
        unlockGroupKey: isUnlockSource ? normalizeCodexUnlockGroupName(abilityName) : null,
        linkedTargetSlots: isUnlockSource ? linksForKind[String(slot)] ?? [] : [],
        unlockUsed: usageForKind[String(slot)] === true,
        prerequisiteSourceSlot: null,
        prerequisiteLabel: null,
        isLockedByPrerequisite: false,
        isResourceBlocked: false,
        isBlocked: false,
        rowBox,
        actionBox: {
          x: left + 3,
          y: bottom + 4,
          width: 13,
          height: Math.max(12, rowBox.height - 8),
        },
        linkBox: {
          x: costRight - 28,
          y: costIconY,
          width: 12,
          height: costIconHeight,
        },
        clearLinkBox: {
          x: costRight - 15,
          y: costIconY,
          width: 12,
          height: costIconHeight,
        },
      }
    })
    .filter((row) => row.hasContent && row.cost !== null)

  const rowsBySlot = new Map(baseRows.map((row) => [row.slot, row]))
  const unlockGroupSlotsByKey = new Map<string, number[]>()

  for (const row of baseRows) {
    if (!row.isUnlockSource || !row.unlockGroupKey) {
      continue
    }

    const groupSlots = unlockGroupSlotsByKey.get(row.unlockGroupKey)

    if (groupSlots) {
      groupSlots.push(row.slot)
    } else {
      unlockGroupSlotsByKey.set(row.unlockGroupKey, [row.slot])
    }
  }

  const isUnlockPrerequisiteUsed = (sourceSlot: number) => {
    const sourceRow = rowsBySlot.get(sourceSlot)
    const groupSlots = sourceRow?.unlockGroupKey
      ? unlockGroupSlotsByKey.get(sourceRow.unlockGroupKey) ?? [sourceSlot]
      : [sourceSlot]

    return groupSlots.some((slot) => usageForKind[String(slot)] === true)
  }

  return baseRows.map((row) => {
    const prerequisiteSourceSlots = Object.entries(linksForKind)
      .filter(([, targetSlots]) => targetSlots.includes(row.slot))
      .map(([sourceSlot]) => Number(sourceSlot))
      .filter((sourceSlot) => Number.isInteger(sourceSlot) && sourceSlot > 0)
    const lockedPrerequisiteSlots = prerequisiteSourceSlots.filter(
      (sourceSlot) => !isUnlockPrerequisiteUsed(sourceSlot),
    )
    const firstLockedPrerequisiteSlot = lockedPrerequisiteSlots[0]
    const prerequisiteSource = firstLockedPrerequisiteSlot
      ? rowsBySlot.get(firstLockedPrerequisiteSlot)
      : undefined
    const prerequisiteLabel = prerequisiteSource
      ? lockedPrerequisiteSlots.length > 1
        ? `${prerequisiteSource.abilityName} +${lockedPrerequisiteSlots.length - 1}`
        : prerequisiteSource.abilityName
      : null
    const isLockedByPrerequisite =
      lockedPrerequisiteSlots.length > 0
    const isResourceBlocked =
      row.spendCost !== null &&
      row.resource.available !== null &&
      row.spendCost > row.resource.available

    return {
      ...row,
      prerequisiteSourceSlot: firstLockedPrerequisiteSlot ?? null,
      prerequisiteLabel,
      isLockedByPrerequisite,
      isResourceBlocked,
      isBlocked: isLockedByPrerequisite || isResourceBlocked,
    }
  })
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
    if (field.name === 'CASH') return 'page1-cash'
  }

  if (field.page === 2) {
    if (hasNormalizedPage2Attribute(field) || isPage2AttributeTopField(field)) return 'page2-attributes'
    if (isSkillSelectField(field) || isSkillScoreField(field) || isSkillBonusBox2(field)) return 'page2-skills'
    if (page2VitalFieldNames.has(field.name)) return 'page2-vitals'
    if (['DESL', 'EX', 'EX 1', 'DEFESA', 'BLOQUEIO'].includes(field.name)) return 'page2-combat'
  }

  if (field.page === 3 || field.page === 4) {
    const sectionPrefix = field.page === 3 ? 'page3' : 'page4'
    return field.y >= 292 ? `${sectionPrefix}-codex-top` : `${sectionPrefix}-codex-bottom`
  }

  return null
}

function resolveFieldVisualPreset(field: PdfSheetTemplateField): FieldVisualPresetKey {
  if (field.name === 'CIDADE') return 'city'
  if (isInfoField(field)) return 'info'
  if (field.name === 'KARMA') return 'page1Karma'
  if (field.name === 'CYBERPHYSHOSIS') return 'page1Cyberpsychosis'
  if (field.name === 'CASH') return 'page1Cash'
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
    whiteSpace: supportsLineBreaks(field) ? 'pre-wrap' : 'nowrap',
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
  aspectRatio,
  mediaScope,
  slot,
  onChange,
}: {
  value: string
  canEdit: boolean
  aspectRatio: number
  mediaScope: Pick<SharedMediaScope, 'subjectKind' | 'subjectId'>
  slot: string
  onChange: (reference: string) => void
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
      setCropSource(await resolveSharedMediaUrl(value, 'display') ?? value)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'A imagem não pôde ser aberta.')
    }
  }

  return (
    <>
      {value ? (
        <>
          <SharedMediaImage
            source={value}
            variant="display"
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
            <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition group-hover/img:opacity-100">
              <button
                type="button"
                onClick={() => void editCurrent()}
                className="rounded bg-black/60 p-1 text-white transition hover:bg-black/80"
                title="Ajustar foto"
              >
                <Pencil size={12} />
              </button>
              <button
                type="button"
                onClick={() => onChange('')}
                className="rounded bg-black/60 p-1 text-white transition hover:bg-black/80"
                title="Remover foto"
              >
                <X size={12} />
              </button>
            </div>
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
          accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]

            if (file) {
              void handleFile(file)
            }

            event.target.value = ''
          }}
        />
      )}
      {uploadError ? <span role="alert" className="absolute bottom-1 left-1 right-1 bg-black/80 px-2 py-1 text-[10px] text-rose-300">{uploadError}</span> : null}
      {cropSource ? (
        <ImageCropDialog
          source={cropSource}
          title="Ajustar foto"
          description="Escolhe o enquadramento da foto antes de a guardar na ficha."
          aspectRatio={aspectRatio}
          outputWidth={720}
          onCancel={closeCrop}
          onConfirm={async (blob) => {
            const uploaded = await uploadSharedImage({
              ...mediaScope,
              mediaKind: 'avatar',
              slot,
            }, blob, 'avatar')
            onChange(uploaded.reference)
            closeCrop()
          }}
        />
      ) : null}
    </>
  )
}

function AbilityDescriptionModal({
  title,
  description,
  canEdit,
  onChange,
  onClose,
}: {
  title: string
  description: string
  canEdit: boolean
  onChange: (value: string) => void
  onClose: () => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow

    document.body.style.overflow = 'hidden'

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  useEffect(() => {
    if (canEdit) {
      textareaRef.current?.focus()
    }
  }, [canEdit])

  return (
    <div
      id="description-modal"
      className="description-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="description-modal-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="description-modal-content">
        <header className="description-modal-header">
          <div className="min-w-0">
            <p className="description-modal-kicker">DESCRIÇÃO</p>
            <h2 id="description-modal-title" className="description-modal-title">
              {title}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="description-modal-close"
            title="Fechar descrição"
            aria-label="Fechar descrição"
          >
            <X size={18} />
          </button>
        </header>

        <div className="description-modal-body">
          {canEdit ? (
            <textarea
              ref={textareaRef}
              value={description}
              spellCheck={false}
              onChange={(event) => onChange(event.target.value)}
              className="description-modal-text description-modal-editor"
            />
          ) : (
            <p className="description-modal-text">{description || 'Sem descrição.'}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function TemplatePdfPage({
  pageNumber,
  templateUrl,
  fieldData,
  onFieldChange,
  canEdit,
  cyberwareViewerRole,
  cyberwareViewerProfileId,
  mediaScope,
  tone,
  moneySource = DEFAULT_SHEET_MONEY_SOURCE,
  canSelectMoneySource = false,
  onToggleMoneySource = noopMoneySourceToggle,
}: {
  pageNumber: number
  templateUrl: string
  fieldData: Record<string, string>
  onFieldChange: (fieldName: string, value: string) => void
  canEdit: boolean
  cyberwareViewerRole: 'gm' | 'owner' | 'shared'
  cyberwareViewerProfileId: string | null
  mediaScope: Pick<SharedMediaScope, 'subjectKind' | 'subjectId'>
  tone: 'blue' | 'red' | 'grey'
  moneySource?: SheetMoneySourcePresentation
  canSelectMoneySource?: boolean
  onToggleMoneySource?: () => void
}) {
  const pageSize = pdfSheetPageSizes[pageNumber - 1]
  const pageRef = useRef<HTMLElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [renderError, setRenderError] = useState(false)
  const [sheetScale, setSheetScale] = useState(1)
  const [descriptionModal, setDescriptionModal] = useState<{
    fieldName: string
    title: string
    description: string
  } | null>(null)

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
  const [pendingUnlockSource, setPendingUnlockSource] = useState<{
    kind: CodexResourceKind
    slot: number
  } | null>(null)
  const codexUnlockLinks = parseCodexUnlockState(fieldData[CODEX_UNLOCK_LINKS_FIELD])
  const codexUnlockUsage = parseCodexUnlockUsageState(fieldData[CODEX_UNLOCK_USED_FIELD])
  const codexAbilityRows = buildCodexAbilityRowStates(
    pageNumber,
    pageFields,
    fieldData,
    codexUnlockLinks,
    codexUnlockUsage,
  )
  const getUnlockGroupRows = (row: CodexAbilityRowState) => {
    if (!row.unlockGroupKey) {
      return [row]
    }

    const groupRows = codexAbilityRows.filter(
      (entry) =>
        entry.resourceKind === row.resourceKind &&
        entry.isUnlockSource &&
        entry.unlockGroupKey === row.unlockGroupKey,
    )

    return groupRows.length ? groupRows : [row]
  }

  const handleUseCodexAbility = (row: CodexAbilityRowState) => {
    const hasEnoughResource =
      row.spendCost === 0 ||
      (row.resource.available !== null && row.spendCost !== null && row.spendCost <= row.resource.available)

    if (
      !canEdit ||
      row.spendCost === null ||
      !hasEnoughResource ||
      row.isLockedByPrerequisite ||
      (row.isUnlockSource && (!row.linkedTargetSlots.length || row.unlockUsed))
    ) {
      return
    }

    if (row.resource.available !== null) {
      onFieldChange(row.resource.fieldName, formatSheetNumber(row.resource.available - row.spendCost))
    }

    if (row.isUnlockSource) {
      const nextUsage: CodexUnlockUsageState = {
        ram: { ...codexUnlockUsage.ram },
        pe: { ...codexUnlockUsage.pe },
      }

      for (const sourceRow of getUnlockGroupRows(row)) {
        nextUsage[row.resourceKind][String(sourceRow.slot)] = true
      }

      onFieldChange(CODEX_UNLOCK_USED_FIELD, serializeCodexUnlockUsageState(nextUsage))
    }
  }

  const handleResetCodexUnlock = (row: CodexAbilityRowState) => {
    if (!canEdit || !row.isUnlockSource) {
      return
    }

    const nextUsage: CodexUnlockUsageState = {
      ram: { ...codexUnlockUsage.ram },
      pe: { ...codexUnlockUsage.pe },
    }

    for (const sourceRow of getUnlockGroupRows(row)) {
      delete nextUsage[row.resourceKind][String(sourceRow.slot)]
    }

    onFieldChange(CODEX_UNLOCK_USED_FIELD, serializeCodexUnlockUsageState(nextUsage))
  }

  const handleToggleUnlockLink = (row: CodexAbilityRowState) => {
    if (!canEdit || !row.isUnlockSource) {
      return
    }

    setPendingUnlockSource((current) =>
      current?.kind === row.resourceKind && current.slot === row.slot
        ? null
        : { kind: row.resourceKind, slot: row.slot },
    )
  }

  const handleClearUnlockLink = (row: CodexAbilityRowState) => {
    if (!canEdit || !row.isUnlockSource) {
      return
    }

    const nextLinks: CodexUnlockState = {
      ram: { ...codexUnlockLinks.ram },
      pe: { ...codexUnlockLinks.pe },
    }
    const nextUsage: CodexUnlockUsageState = {
      ram: { ...codexUnlockUsage.ram },
      pe: { ...codexUnlockUsage.pe },
    }

    delete nextLinks[row.resourceKind][String(row.slot)]
    delete nextUsage[row.resourceKind][String(row.slot)]

    onFieldChange(CODEX_UNLOCK_LINKS_FIELD, serializeCodexUnlockState(nextLinks))
    onFieldChange(CODEX_UNLOCK_USED_FIELD, serializeCodexUnlockUsageState(nextUsage))
    setPendingUnlockSource((current) =>
      current?.kind === row.resourceKind && current.slot === row.slot ? null : current,
    )
  }

  const handleSelectUnlockTarget = (row: CodexAbilityRowState) => {
    if (
      !canEdit ||
      !pendingUnlockSource ||
      pendingUnlockSource.kind !== row.resourceKind ||
      pendingUnlockSource.slot === row.slot ||
      row.isUnlockSource
    ) {
      return
    }

    const nextLinks: CodexUnlockState = {
      ram: { ...codexUnlockLinks.ram },
      pe: { ...codexUnlockLinks.pe },
    }
    const nextUsage: CodexUnlockUsageState = {
      ram: { ...codexUnlockUsage.ram },
      pe: { ...codexUnlockUsage.pe },
    }

    const sourceKey = String(pendingUnlockSource.slot)
    const linkedTargets = nextLinks[pendingUnlockSource.kind][sourceKey] ?? []

    if (linkedTargets.includes(row.slot)) {
      const remainingTargets = linkedTargets.filter((targetSlot) => targetSlot !== row.slot)

      if (remainingTargets.length) {
        nextLinks[pendingUnlockSource.kind][sourceKey] = remainingTargets
      } else {
        delete nextLinks[pendingUnlockSource.kind][sourceKey]
      }
    } else {
      nextLinks[pendingUnlockSource.kind][sourceKey] = [...linkedTargets, row.slot]
    }

    delete nextUsage[pendingUnlockSource.kind][sourceKey]

    onFieldChange(CODEX_UNLOCK_LINKS_FIELD, serializeCodexUnlockState(nextLinks))
    onFieldChange(CODEX_UNLOCK_USED_FIELD, serializeCodexUnlockUsageState(nextUsage))
  }

  const openDescriptionModal = (field: PdfSheetTemplateField) => {
    setDescriptionModal({
      fieldName: field.name,
      title: getCodexDescriptionTitle(field, fieldData),
      description: fieldData[field.name] ?? '',
    })
  }

  const handleDescriptionCellClick = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null
    const cell = target?.closest<HTMLElement>('[data-ability-description-cell="true"]')

    if (!cell || !pageRef.current?.contains(cell)) {
      return
    }

    const fieldName = cell.dataset.descriptionFieldName
    const field = pageFields.find((entry) => entry.name === fieldName && isCodexDescriptionField(entry))

    if (!field) {
      return
    }

    event.preventDefault()
    openDescriptionModal(field)
  }

  const handleDescriptionCellKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }

    const target = event.target as HTMLElement | null
    const cell = target?.closest<HTMLElement>('[data-ability-description-cell="true"]')

    if (!cell || !pageRef.current?.contains(cell)) {
      return
    }

    const fieldName = cell.dataset.descriptionFieldName
    const field = pageFields.find((entry) => entry.name === fieldName && isCodexDescriptionField(entry))

    if (!field) {
      return
    }

    event.preventDefault()
    openDescriptionModal(field)
  }

  const renderField = (field: PdfSheetTemplateField, sectionBox?: SheetLayoutBox) => {
    const fieldBox = { x: field.x, y: field.y, width: field.width, height: field.height }
    const wrapperStyle = buildBoxStyle(fieldBox, pageSize, sectionBox)
    const fieldCanEdit = canEdit
    const inputClassName = getFieldInputClassName(field, fieldCanEdit)
    const inputStyle = field.name === 'CIDADE'
      ? { ...buildFieldInputStyle(field), ...buildDebugInputStyle(), fontFamily: 'CyberwayRiders, sans-serif' }
      : { ...buildFieldInputStyle(field), ...buildDebugInputStyle() }
    if (isCodexAbilityNameField(field)) {
      inputStyle.paddingLeft = 'calc(20px * var(--sheet-scale, 1))'
    }
    if (isCodexDescriptionField(field)) {
      inputStyle.cursor = 'pointer'
      inputStyle.overflow = 'hidden'
      inputStyle.textOverflow = 'ellipsis'
      inputStyle.whiteSpace = 'nowrap'
    }
    if (isCodexValueField(field) && hasNegativeSheetNumber(fieldData[field.name])) {
      inputStyle.paddingRight = 'calc(18px * var(--sheet-scale, 1))'
    }
    const fieldKey = `${field.page}-${field.name}-${field.widgetIndex}`

    if (field.name === 'CASH') {
      const sourceDisplayClassName = getFieldInputClassName(field, false)
      const sourceBackground = tone === 'blue'
        ? 'rgba(4, 23, 35, 0.92)'
        : tone === 'red'
          ? 'rgba(37, 8, 13, 0.92)'
          : 'rgba(24, 24, 22, 0.92)'

      return (
        <div
          key={fieldKey}
          className="absolute overflow-hidden"
          style={{
            ...(sectionBox
              ? { inset: 0 }
              : wrapperStyle),
            background: sourceBackground,
            boxShadow: 'inset 0 0 0 calc(1px * var(--sheet-scale, 1)) rgba(255,255,255,0.74)',
          }}
          data-sheet-money-source={moneySource.id}
          title={moneySource.title}
        >
          <span
            className={`pointer-events-none absolute inset-y-0 left-0 z-10 flex w-[55%] items-center justify-center font-display leading-none tracking-[0.04em] ${
              moneySource.status === 'error' ? 'text-rose-200' : 'text-white/70'
            }`}
            style={{
              fontSize: moneySource.id === 'vlt' || moneySource.id === 'altara-bank'
                ? 'calc(18px * var(--sheet-scale, 1))'
                : moneySource.id === 'vox-bank'
                  ? 'calc(12px * var(--sheet-scale, 1))'
                  : 'calc(9px * var(--sheet-scale, 1))',
            }}
          >
            {moneySource.label}{moneySource.id === 'altara-bank' ? '' : ':'}
          </span>
          <span
            className="pointer-events-none absolute inset-y-0 left-[55%] z-10 w-px bg-white/70"
            aria-hidden="true"
          />
          {canSelectMoneySource ? (
            <button
              type="button"
              onClick={onToggleMoneySource}
              className="absolute right-0 top-0 z-20 flex items-center justify-center text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:bg-white/15 focus-visible:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/90"
              style={{
                width: 'calc(17px * var(--sheet-scale, 1))',
                height: 'calc(15px * var(--sheet-scale, 1))',
                minWidth: '24px',
                minHeight: '24px',
              }}
              aria-label="Show next financial account balance"
              title="Switch account display"
            >
              <ChevronsUpDown size="calc(8px * var(--sheet-scale, 1))" strokeWidth={2} />
            </button>
          ) : null}
          <span
            className={`${sourceDisplayClassName} select-none`}
            style={{
              ...inputStyle,
              inset: '0 0 0 55%',
              width: '45%',
              padding: 'calc(8px * var(--sheet-scale, 1)) calc(2px * var(--sheet-scale, 1)) 0',
              fontSize: moneySource.status === 'ready'
                ? 'calc(19px * var(--sheet-scale, 1))'
                : 'calc(9px * var(--sheet-scale, 1))',
            }}
            aria-label={`${moneySource.label} balance`}
            aria-live="polite"
            aria-atomic="true"
          >
            {moneySource.value}
          </span>
        </div>
      )
    }

    if (field.name === 'KARMA') {
      return (
        <div key={fieldKey} className="absolute overflow-hidden" style={wrapperStyle}>
          <input
            value={readKarmaValue(fieldData)}
            readOnly={!canEdit}
            spellCheck={false}
            autoComplete="off"
            inputMode="text"
            maxLength={12}
            onChange={(event) => onFieldChange('KARMA', event.target.value)}
            className={getFieldInputClassName(field, canEdit)}
            style={inputStyle}
            aria-label="Karma reputation"
            title={canEdit
              ? 'Edit authoritative VLT Karma reputation'
              : 'Authoritative VLT Karma reputation'}
          />
        </div>
      )
    }

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

    const value = field.name === 'KARMA' ? readKarmaValue(fieldData) : fieldData[field.name] ?? ''

    if (isCodexDescriptionField(field)) {
      const title = getCodexDescriptionTitle(field, fieldData)

      return (
        <div
          key={fieldKey}
          className="ability-description-cell absolute overflow-hidden"
          style={wrapperStyle}
          data-ability-description-cell="true"
          data-description-field-name={field.name}
          data-full-description={value}
          title="Abrir descrição completa"
          role="button"
          tabIndex={0}
          aria-label={`Abrir descrição completa: ${title}`}
        >
          <input
            value={value}
            readOnly
            spellCheck={false}
            inputMode="text"
            aria-hidden="true"
            tabIndex={-1}
            className={`${inputClassName} pointer-events-none`}
            style={inputStyle}
          />
        </div>
      )
    }

    if (shouldRenderTextareaField(field)) {
      return (
        <div key={fieldKey} className="absolute overflow-hidden" style={wrapperStyle}>
          <textarea
            value={value}
            readOnly={!fieldCanEdit}
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
          readOnly={!fieldCanEdit}
          spellCheck={false}
          inputMode={isNumericField(field) ? 'numeric' : 'text'}
          onChange={(event) => onFieldChange(field.name, event.target.value)}
          className={inputClassName}
          style={inputStyle}
        />
      </div>
    )
  }

  const renderCodexAbilityControls = () =>
    codexAbilityRows.map((row) => {
      const resourceLabel = row.resourceKind === 'ram' ? 'RAM' : 'PE'
      const linkedTargets = row.linkedTargetSlots
        .map((targetSlot) => codexAbilityRows.find((entry) => entry.slot === targetSlot))
        .filter((entry): entry is CodexAbilityRowState => Boolean(entry))
      const linkedTargetLabel =
        linkedTargets.length > 1
          ? `${linkedTargets[0].abilityName} +${linkedTargets.length - 1}`
          : linkedTargets[0]?.abilityName ?? null
      const unlockSourceSelected =
        pendingUnlockSource?.kind === row.resourceKind &&
        pendingUnlockSource.slot === row.slot
      const isLinkedToPendingSource =
        Boolean(pendingUnlockSource) &&
        pendingUnlockSource?.kind === row.resourceKind &&
        (codexUnlockLinks[pendingUnlockSource.kind][String(pendingUnlockSource.slot)] ?? []).includes(row.slot)
      const canSelectAsUnlockTarget =
        canEdit &&
        Boolean(pendingUnlockSource) &&
        pendingUnlockSource?.kind === row.resourceKind &&
        pendingUnlockSource.slot !== row.slot &&
        !row.isUnlockSource
      const hasEnoughResource =
        row.spendCost !== null &&
        (row.spendCost === 0 ||
          (row.resource.available !== null && row.spendCost <= row.resource.available))
      const canUse =
        canEdit &&
        row.spendCost !== null &&
        hasEnoughResource &&
        !row.isLockedByPrerequisite &&
        (!row.isUnlockSource || (row.linkedTargetSlots.length > 0 && !row.unlockUsed))
      const canResetUnlock = canEdit && row.isUnlockSource && row.unlockUsed
      const disabledReason =
        row.isUnlockSource && row.unlockUsed
          ? 'Voltar a bloquear habilidade ligada'
          : row.isUnlockSource && !row.linkedTargetSlots.length
            ? 'Liga esta habilidade a uma habilidade alvo'
            : row.isLockedByPrerequisite
              ? `Usa ${row.prerequisiteLabel ?? 'o desbloqueio'} primeiro`
              : row.resource.available === null
          ? `Define ${resourceLabel} atual primeiro`
          : `Sem ${resourceLabel} suficiente`
      const blockedLabel = row.isLockedByPrerequisite
        ? ''
        : `${resourceLabel} BLOQ.`

      return (
        <div key={`codex-action-${row.resourceKind}-${row.slot}`}>
          {row.isBlocked ? (
            <div
              className="pointer-events-none absolute z-10 flex items-center justify-end overflow-hidden border border-rose-400/45 px-1.5"
              style={{
                ...buildBoxStyle(row.rowBox, pageSize),
                background:
                  'linear-gradient(90deg, rgba(85,0,12,0.48), rgba(85,0,12,0.24)), repeating-linear-gradient(135deg, rgba(255,255,255,0.18) 0 1px, transparent 1px 7px)',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
              }}
            >
              {blockedLabel ? (
                <span className="font-display text-[calc(11px*var(--sheet-scale,1))] leading-none tracking-[0.08em] text-rose-100">
                  {blockedLabel}
                </span>
              ) : null}
            </div>
          ) : null}

          {canSelectAsUnlockTarget ? (
            <button
              type="button"
              onClick={() => handleSelectUnlockTarget(row)}
              className={`absolute z-30 flex items-center justify-end border px-1.5 font-display text-[calc(10px*var(--sheet-scale,1))] leading-none tracking-[0.08em] transition ${
                isLinkedToPendingSource
                  ? 'border-rose-300/70 bg-rose-500/18 text-rose-100 hover:bg-rose-500/28'
                  : 'border-[#53b5ff]/70 bg-[#53b5ff]/16 text-[#9bddff] hover:bg-[#53b5ff]/26'
              }`}
              style={buildBoxStyle(row.rowBox, pageSize)}
              title={
                isLinkedToPendingSource
                  ? 'Remover esta habilidade deste desbloqueio'
                  : 'Adicionar esta habilidade ao desbloqueio'
              }
            >
              {isLinkedToPendingSource ? 'REMOVER' : 'LIGAR'}
            </button>
          ) : null}

          {canEdit ? (
            <button
              type="button"
              disabled={!canUse && !canResetUnlock}
              onClick={() =>
                canResetUnlock ? handleResetCodexUnlock(row) : handleUseCodexAbility(row)
              }
              className={`absolute z-20 flex items-center justify-center transition ${
                canUse
                  ? 'cursor-pointer text-[#f3e600] hover:bg-[#f3e600]/14'
                  : canResetUnlock
                    ? 'cursor-pointer text-[#53b5ff] hover:bg-[#53b5ff]/14'
                    : 'cursor-not-allowed text-rose-100/70 opacity-70'
              }`}
              style={buildBoxStyle(row.actionBox, pageSize)}
              title={
                canUse
                  ? `Usar habilidade: -${row.spendCost} ${resourceLabel}`
                  : disabledReason
              }
            >
              {canUse ? (
                <Play size="calc(7px * var(--sheet-scale, 1))" fill="currentColor" />
              ) : (
                <Lock size="calc(7px * var(--sheet-scale, 1))" />
              )}
            </button>
          ) : null}

          {canEdit && row.isUnlockSource ? (
            <button
              type="button"
              onClick={() => handleToggleUnlockLink(row)}
              className={`absolute z-20 flex items-center justify-center transition ${
                unlockSourceSelected
                  ? 'bg-[#53b5ff]/24 text-[#9bddff]'
                  : row.linkedTargetSlots.length
                    ? 'text-[#53b5ff] hover:bg-[#53b5ff]/14'
                    : 'text-[#f3e600] hover:bg-[#f3e600]/14'
              }`}
              style={buildBoxStyle(row.linkedTargetSlots.length ? row.linkBox : row.clearLinkBox, pageSize)}
              title={
                row.linkedTargetSlots.length
                  ? `Adicionar/remover alvos. Ligado a ${linkedTargetLabel ?? 'habilidades'}`
                  : 'Escolher habilidade desbloqueada'
              }
            >
              <Link2 size="calc(7px * var(--sheet-scale, 1))" />
            </button>
          ) : null}

          {canEdit && row.isUnlockSource && row.linkedTargetSlots.length ? (
            <button
              type="button"
              onClick={() => handleClearUnlockLink(row)}
              className="absolute z-20 flex items-center justify-center text-rose-300 transition hover:bg-rose-500/16"
              style={buildBoxStyle(row.clearLinkBox, pageSize)}
              title={`Remover ${row.linkedTargetSlots.length} ligação${row.linkedTargetSlots.length === 1 ? '' : 'ões'}`}
            >
              <X size="calc(8px * var(--sheet-scale, 1))" />
            </button>
          ) : null}
        </div>
      )
    })

  return (
    <section
      ref={pageRef}
      className="relative overflow-hidden border-2 border-white/70 bg-[#a7a7a6] shadow-[0_18px_50px_rgba(0,0,0,0.35)]"
      style={pageStyle}
      onClick={handleDescriptionCellClick}
      onKeyDown={handleDescriptionCellKeyDown}
    >
      {renderError ? (
        <div className="absolute inset-0 bg-[#a7a7a6]" />
      ) : (
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      )}

      {pageNumber === 5 ? (
        <CyberwareBoard
          fieldData={fieldData}
          onFieldChange={onFieldChange}
          canEdit={canEdit}
          viewerRole={cyberwareViewerRole}
          viewerProfileId={cyberwareViewerProfileId}
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
            aspectRatio={
              Math.max(1, parseFloat(imageZone.absoluteStyle.width)) /
              Math.max(1, parseFloat(imageZone.absoluteStyle.height))
            }
            mediaScope={mediaScope}
            slot={imageZone.fieldName.toLowerCase()}
            onChange={(dataUrl) => onFieldChange(imageZone.fieldName, dataUrl)}
          />
        </div>
      ))}
      {renderCodexAbilityControls()}
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
      {descriptionModal ? (
        <AbilityDescriptionModal
          title={descriptionModal.title}
          description={descriptionModal.description}
          canEdit={canEdit}
          onChange={(value) => {
            setDescriptionModal((current) =>
              current ? { ...current, description: value } : current,
            )
            onFieldChange(descriptionModal.fieldName, value)
          }}
          onClose={() => setDescriptionModal(null)}
        />
      ) : null}
    </section>
  )
}

export function PdfSheetEditor({
  fieldData,
  onFieldChange,
  canEdit,
  cyberwareViewerRole = 'shared',
  cyberwareViewerProfileId = null,
  mediaScope,
}: {
  fieldData: Record<string, string>
  onFieldChange: (fieldName: string, value: string) => void
  canEdit: boolean
  cyberwareViewerRole?: 'gm' | 'owner' | 'shared'
  cyberwareViewerProfileId?: string | null
  mediaScope: Pick<SharedMediaScope, 'subjectKind' | 'subjectId'>
}) {
  const color = karmaToColor(readKarmaValue(fieldData))
  const gender = sexoToGender(fieldData['SEXO'] ?? '')
  const templateUrl = TEMPLATE_URLS[`${color}-${gender}`] ?? TEMPLATE_URLS['grey-m']
  const sheetEconomySubject = useMemo(() => {
    if (
      mediaScope.subjectId === 'preview' ||
      (mediaScope.subjectKind !== 'profile-sheet' && mediaScope.subjectKind !== 'npc-card')
    ) {
      return null
    }

    return {
      subjectKind: mediaScope.subjectKind as SheetEconomySubjectKind,
      subjectId: mediaScope.subjectId,
    }
  }, [mediaScope.subjectId, mediaScope.subjectKind])
  const moneySourceStorageKey = sheetEconomySubject
    ? `${SHEET_MONEY_SOURCE_STORAGE_PREFIX}${sheetEconomySubject.subjectKind}:${sheetEconomySubject.subjectId}`
    : ''
  const storedMoneySource = useMemo(
    () => readStoredMoneySource(moneySourceStorageKey),
    [moneySourceStorageKey],
  )
  const [moneySourceSelection, setMoneySourceSelection] = useState<{
    storageKey: string
    sourceId: SheetMoneySourceId
  }>({ storageKey: '', sourceId: 'vlt' })
  const selectedMoneySourceId = moneySourceSelection.storageKey === moneySourceStorageKey
    ? moneySourceSelection.sourceId
    : storedMoneySource
  const sheetEconomy = useSheetEconomySources(
    sheetEconomySubject,
    Boolean(sheetEconomySubject),
  )
  const moneySources = useMemo<readonly SheetMoneySourcePresentation[]>(() => {
    if (sheetEconomySubject && !sheetEconomy.payload) {
      const failed = sheetEconomy.status === 'error'
      return [{
        id: 'vlt',
        label: 'CASH',
        value: failed ? 'UNAVAILABLE' : 'SYNC...',
        available: false,
        status: failed ? 'error' : 'loading',
        title: failed
          ? `Financial access could not be resolved: ${sheetEconomy.error ?? 'Try again.'}`
          : 'Resolving the authoritative financial source for this identity.',
      }]
    }

    if (sheetEconomy.payload?.primaryOsId === 'altara') {
      const altaraAccount = sheetEconomy.payload.altaraBank
      const currency = sheetEconomy.payload.homeCurrency
      const currencyLabel = currency
        ? (altaraAccount?.balanceAmount === 1 ? currency.singularLabel : currency.pluralLabel)
        : ''
      return [{
        id: 'altara-bank',
        label: 'ALTARA BANK',
        value: altaraAccount ? `${altaraAccount.balanceAmount} ${currencyLabel}` : '—',
        available: Boolean(altaraAccount),
        status: altaraAccount ? 'ready' : 'unavailable',
        title: altaraAccount
          ? `Read-only ${currency?.displayName ?? 'home-currency'} balance from ALTARA BANK. New Vega VG remains separate.`
          : currency
            ? `No active ALTARA BANK ${currency.currencyCode} account is available.`
            : 'Currency assignment required. Silver must set a home currency.',
      }]
    }

    const voxAccount = sheetEconomy.payload?.voxBank ?? null
    const shneiderAccount = sheetEconomy.payload?.shneiderBank ?? null
    const voxHasConfirmedValue = Boolean(voxAccount)
    const voxStatus = voxHasConfirmedValue
      ? 'ready'
      : sheetEconomy.status === 'loading'
        ? 'loading'
        : sheetEconomy.status === 'error'
          ? 'error'
          : 'unavailable'
    const voxValue = voxAccount
      ? `${voxAccount.balanceAmount}vG`
      : voxStatus === 'loading'
        ? 'SYNC...'
        : voxStatus === 'error'
          ? 'UNAVAILABLE'
          : 'NO ACCOUNT'
    const shneiderHasConfirmedValue = Boolean(shneiderAccount)
    const shneiderStatus = shneiderHasConfirmedValue
      ? 'ready'
      : sheetEconomy.status === 'loading'
        ? 'loading'
        : sheetEconomy.status === 'error'
          ? 'error'
          : 'unavailable'
    const shneiderValue = shneiderAccount
      ? `${shneiderAccount.balanceAmount}vG`
      : shneiderStatus === 'loading'
        ? 'SYNC...'
        : shneiderStatus === 'error'
          ? 'UNAVAILABLE'
          : 'NO ACCOUNT'

    return [
      {
        id: 'vlt',
        label: 'CASH',
        value: fieldData.CASH ?? '',
        available: true,
        status: 'ready',
        title: 'Read-only VLT wallet balance. Use VLT or Economy Control to change it.',
      },
      {
        id: 'vox-bank',
        label: 'VOX BANK',
        value: voxValue,
        available: voxHasConfirmedValue,
        status: voxStatus,
        title: sheetEconomy.error
          ? `VOX BANK could not be refreshed: ${sheetEconomy.error}`
          : voxHasConfirmedValue
            ? 'VOX BANK balance. Deposit or withdraw in the VOX BANK app.'
            : 'No VOX BANK account. Viewing this source does not open one.',
      },
      {
        id: 'shneider-bank',
        label: 'SHNEIDER',
        value: shneiderValue,
        available: shneiderHasConfirmedValue,
        status: shneiderStatus,
        title: sheetEconomy.error
          ? `SHNEIDER BANK could not be refreshed: ${sheetEconomy.error}`
          : shneiderHasConfirmedValue
            ? 'SHNEIDER BANK balance. Use the bank app to move or pay vG.'
            : 'No SHNEIDER BANK account. Viewing this source does not open one.',
      },
    ]
  }, [
    fieldData.CASH,
    sheetEconomy.error,
    sheetEconomy.payload,
    sheetEconomySubject,
    sheetEconomy.status,
  ])
  const selectedMoneySource = moneySources.find(
    (source) => source.id === selectedMoneySourceId,
  ) ?? moneySources[0]
  const handleToggleMoneySource = () => {
    if (!sheetEconomySubject || !moneySourceStorageKey || moneySources.length < 2) return
    const sourceOrder = moneySources.map((source) => source.id)
    const currentIndex = sourceOrder.indexOf(selectedMoneySourceId)
    const nextSourceId = sourceOrder[(currentIndex + 1) % sourceOrder.length]
    setMoneySourceSelection({
      storageKey: moneySourceStorageKey,
      sourceId: nextSourceId,
    })
    storeMoneySource(moneySourceStorageKey, nextSourceId)
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      {[1, 2, 3, 4, 5].map((pageNumber) => (
        <div key={pageNumber} className={pageNumber === 5 ? 'col-span-2' : ''}>
          <TemplatePdfPage
            pageNumber={pageNumber}
            templateUrl={templateUrl}
            fieldData={fieldData}
            onFieldChange={onFieldChange}
            canEdit={canEdit}
            cyberwareViewerRole={cyberwareViewerRole}
            cyberwareViewerProfileId={cyberwareViewerProfileId}
            mediaScope={mediaScope}
            tone={color}
            moneySource={selectedMoneySource}
            canSelectMoneySource={Boolean(sheetEconomySubject) && moneySources.length > 1}
            onToggleMoneySource={handleToggleMoneySource}
          />
        </div>
      ))}
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
  const color = karmaToColor(readKarmaValue(fieldData))
  const gender = sexoToGender(fieldData['SEXO'] ?? '')
  const templateUrl = TEMPLATE_URLS[`${color}-${gender}`] ?? TEMPLATE_URLS['grey-m']
  const safePageNumber = Math.min(5, Math.max(1, Math.round(pageNumber)))

  return (
    <div className={className}>
      <TemplatePdfPage
        pageNumber={safePageNumber}
        templateUrl={templateUrl}
        fieldData={fieldData}
        onFieldChange={() => {}}
        canEdit={false}
        cyberwareViewerRole="shared"
        cyberwareViewerProfileId={null}
        mediaScope={{ subjectKind: 'profile-sheet', subjectId: 'preview' }}
        tone={color}
        moneySource={{
          ...DEFAULT_SHEET_MONEY_SOURCE,
          value: fieldData.CASH ?? '',
        }}
      />
    </div>
  )
}
