export const DEBUG_INPUTS_ONLY = true

export type SheetTextAlign = 'left' | 'center' | 'right'

export interface SheetLayoutBox {
  x: number
  y: number
  width: number
  height: number
}

export interface SheetLayoutSection {
  id: string
  page: number
  label: string
  box: SheetLayoutBox
  clip?: boolean
  debugColor?: string
}

export interface SheetImageZoneConfig {
  id: string
  page: number
  fieldName: 'FOTO' | 'FOTO2'
  absoluteStyle: {
    left: string
    top: string
    width: string
    height: string
  }
}

export interface SheetFieldVisualPreset {
  fontClass: 'font-display' | 'font-body'
  fontSize: string
  lineHeight: string
  padding: string
  textAlign: SheetTextAlign
  letterSpacing?: string
  italic?: boolean
  fontWeight?: string
}

const sheetScaledPx = (value: number) => `calc(${value}px * var(--sheet-scale, 1))`

const sheetScaledPadding = (
  top: number,
  right: number,
  bottom: number = top,
  left: number = right,
) => `${sheetScaledPx(top)} ${sheetScaledPx(right)} ${sheetScaledPx(bottom)} ${sheetScaledPx(left)}`

export const sheetPageSectionConfigs: SheetLayoutSection[] = [
  {
    id: 'page1-city',
    page: 1,
    label: 'Cidade',
    box: { x: 10, y: 599, width: 455, height: 62 },
    clip: true,
    debugColor: 'rgba(0, 255, 255, 0.55)',
  },
  {
    id: 'page1-info-photo',
    page: 1,
    label: 'Foto Perfil',
    box: { x: 7, y: 389, width: 220, height: 211 },
    clip: true,
    debugColor: 'rgba(255, 210, 0, 0.5)',
  },
  {
    id: 'page1-info',
    page: 1,
    label: 'Informacoes',
    box: { x: 229, y: 395, width: 231, height: 180 },
    clip: true,
    debugColor: 'rgba(0, 180, 255, 0.55)',
  },
  {
    id: 'page1-attacks',
    page: 1,
    label: 'Ataques',
    box: { x: 10, y: 56, width: 309, height: 336 },
    clip: true,
    debugColor: 'rgba(0, 255, 140, 0.5)',
  },
  {
    id: 'page1-portrait',
    page: 1,
    label: 'Retrato',
    box: { x: 310, y: 278, width: 151, height: 103 },
    clip: true,
    debugColor: 'rgba(255, 160, 0, 0.5)',
  },
  {
    id: 'page1-karma',
    page: 1,
    label: 'Karma',
    box: { x: 317, y: 327, width: 148, height: 36 },
    clip: true,
    debugColor: 'rgba(255, 0, 180, 0.55)',
  },
  {
    id: 'page1-inventory',
    page: 1,
    label: 'Inventario',
    box: { x: 317, y: 30, width: 148, height: 275 },
    clip: true,
    debugColor: 'rgba(255, 110, 110, 0.55)',
  },
  {
    id: 'page1-cyberpsychosis',
    page: 1,
    label: 'Cyberpsychosis',
    box: { x: 10, y: 14, width: 309, height: 43 },
    clip: true,
    debugColor: 'rgba(200, 255, 0, 0.55)',
  },
  {
    id: 'page2-attributes',
    page: 2,
    label: 'Atributos',
    box: { x: 20, y: 520, width: 436, height: 124 },
    clip: false,
    debugColor: 'rgba(0, 220, 255, 0.55)',
  },
  {
    id: 'page2-skills',
    page: 2,
    label: 'Capacidades',
    box: { x: 35, y: 228, width: 406, height: 285 },
    clip: true,
    debugColor: 'rgba(0, 255, 170, 0.5)',
  },
  {
    id: 'page2-vitals',
    page: 2,
    label: 'Vida Sanidade Esforco',
    box: { x: 24, y: 38, width: 192, height: 164 },
    clip: true,
    debugColor: 'rgba(255, 210, 0, 0.5)',
  },
  {
    id: 'page2-combat',
    page: 2,
    label: 'RAM e Combate',
    box: { x: 228, y: 38, width: 227, height: 164 },
    clip: true,
    debugColor: 'rgba(255, 110, 220, 0.55)',
  },
  {
    id: 'page3-codex-top',
    page: 3,
    label: 'Codex Superior',
    box: { x: 90, y: 292, width: 375, height: 327 },
    clip: true,
    debugColor: 'rgba(0, 220, 255, 0.55)',
  },
  {
    id: 'page3-codex-bottom',
    page: 3,
    label: 'Codex Inferior',
    box: { x: 90, y: 14, width: 375, height: 277 },
    clip: true,
    debugColor: 'rgba(255, 145, 0, 0.55)',
  },
  {
    id: 'page4-codex-top',
    page: 4,
    label: 'Codex Superior',
    box: { x: 90, y: 292, width: 375, height: 327 },
    clip: true,
    debugColor: 'rgba(0, 220, 255, 0.55)',
  },
  {
    id: 'page4-codex-bottom',
    page: 4,
    label: 'Codex Inferior',
    box: { x: 90, y: 14, width: 375, height: 277 },
    clip: true,
    debugColor: 'rgba(255, 145, 0, 0.55)',
  },
  {
    id: 'page5-matrix-left',
    page: 5,
    label: 'Cyberware Esquerda',
    box: { x: 20, y: 73, width: 140, height: 556 },
    clip: false,
    debugColor: 'rgba(0, 255, 170, 0.5)',
  },
  {
    id: 'page5-matrix-right',
    page: 5,
    label: 'Cyberware Direita',
    box: { x: 315, y: 73, width: 140, height: 556 },
    clip: false,
    debugColor: 'rgba(255, 210, 0, 0.5)',
  },
  {
    id: 'page5-matrix-meters',
    page: 5,
    label: 'Cyber Shield',
    box: { x: 24, y: 12, width: 427, height: 52 },
    clip: false,
    debugColor: 'rgba(255, 110, 220, 0.55)',
  },
]

export const sheetImageZoneConfigs: SheetImageZoneConfig[] = [
  {
    id: 'page1-info-photo',
    page: 1,
    fieldName: 'FOTO2',
    absoluteStyle: {
      left: '2.4%', 
      top: '11.3%',
      width: '41.6%',
      height: '30%',
    },
  },
]

export const sheetFieldVisualPresets = {
  city: {
    fontClass: 'font-display',
    fontSize: sheetScaledPx(42),
    lineHeight: '0.88',
    padding: sheetScaledPadding(3, 6, 0, 6),
    textAlign: 'left',
    letterSpacing: '0.04em',
  },
  info: {
    fontClass: 'font-display',
    fontSize: sheetScaledPx(16),
    lineHeight: '1',
    padding: sheetScaledPadding(2, 2, 0, 2),
    textAlign: 'left',
    fontWeight: '400',
  },
  page1Karma: {
    fontClass: 'font-display',
    fontSize: sheetScaledPx(22),
    lineHeight: '1',
    padding: sheetScaledPadding(2, 2, 0, 2),
    textAlign: 'center',
    letterSpacing: '0.04em',
  },
  page1Cyberpsychosis: {
    fontClass: 'font-display',
    fontSize: sheetScaledPx(28),
    lineHeight: '1',
    padding: sheetScaledPadding(3, 2, 0, 2),
    textAlign: 'center',
    letterSpacing: '0.04em',
  },
  page2Attribute: {
    fontClass: 'font-display',
    fontSize: sheetScaledPx(44),
    lineHeight: '1',
    padding: sheetScaledPadding(3, 2, 0, 2),
    textAlign: 'center',
    letterSpacing: '0.04em',
  },
  page2AttributeTop: {
    fontClass: 'font-display',
    fontSize: sheetScaledPx(13),
    lineHeight: '1',
    padding: sheetScaledPadding(2, 1, 0, 1),
    textAlign: 'center',
    letterSpacing: '0.04em',
  },
  skillSelect: {
    fontClass: 'font-display',
    fontSize: sheetScaledPx(11),
    lineHeight: '1',
    padding: sheetScaledPadding(1, 12, 0, 2),
    textAlign: 'left',
    fontWeight: '400',
  },
  skillBonus: {
    fontClass: 'font-display',
    fontSize: sheetScaledPx(12),
    lineHeight: '1',
    padding: sheetScaledPadding(1, 1, 0, 1),
    textAlign: 'center',
    letterSpacing: '0.04em',
  },
  skillScore: {
    fontClass: 'font-display',
    fontSize: sheetScaledPx(10),
    lineHeight: '1',
    padding: sheetScaledPadding(0, 0, 0, 0),
    textAlign: 'center',
    letterSpacing: '0.04em',
  },
  page2Ram: {
    fontClass: 'font-display',
    fontSize: sheetScaledPx(26),
    lineHeight: '1',
    padding: sheetScaledPadding(3, 2, 0, 2),
    textAlign: 'center',
    letterSpacing: '0.04em',
  },
  page2CombatStat: {
    fontClass: 'font-display',
    fontSize: sheetScaledPx(22),
    lineHeight: '1',
    padding: sheetScaledPadding(3, 1, 0, 1),
    textAlign: 'center',
    letterSpacing: '0.04em',
  },
  page2Stat: {
    fontClass: 'font-display',
    fontSize: sheetScaledPx(20),
    lineHeight: '1',
    padding: sheetScaledPadding(2, 2, 0, 2),
    textAlign: 'center',
    letterSpacing: '0.04em',
  },
  codexValue: {
    fontClass: 'font-display',
    fontSize: sheetScaledPx(16),
    lineHeight: '1',
    padding: sheetScaledPadding(1, 1, 0, 1),
    textAlign: 'center',
    letterSpacing: '0.04em',
  },
  codexText: {
    fontClass: 'font-display',
    fontSize: sheetScaledPx(14),
    lineHeight: '1',
    padding: sheetScaledPadding(0, 3, 0, 3),
    textAlign: 'left',
    letterSpacing: '0.02em',
  },
  multiline: {
    fontClass: 'font-display',
    fontSize: sheetScaledPx(22),
    lineHeight: '1.15',
    padding: sheetScaledPadding(5, 7, 0, 7),
    textAlign: 'left',
    letterSpacing: '0.04em',
  },
  tallCell: {
    fontClass: 'font-display',
    fontSize: sheetScaledPx(14),
    lineHeight: '1',
    padding: sheetScaledPadding(2, 3, 0, 3),
    textAlign: 'left',
    letterSpacing: '0.04em',
  },
  compactCell: {
    fontClass: 'font-display',
    fontSize: sheetScaledPx(12),
    lineHeight: '1',
    padding: sheetScaledPadding(1, 2, 0, 2),
    textAlign: 'left',
    letterSpacing: '0.04em',
  },
  compactCellCentered: {
    fontClass: 'font-display',
    fontSize: sheetScaledPx(12),
    lineHeight: '1',
    padding: sheetScaledPadding(1, 1, 0, 1),
    textAlign: 'center',
    letterSpacing: '0.04em',
  },
  inventoryCell: {
    fontClass: 'font-display',
    fontSize: sheetScaledPx(15),
    lineHeight: '1',
    padding: sheetScaledPadding(2, 3, 0, 3),
    textAlign: 'left',
    letterSpacing: '0.04em',
  },
  inventoryCellCentered: {
    fontClass: 'font-display',
    fontSize: sheetScaledPx(15),
    lineHeight: '1',
    padding: sheetScaledPadding(2, 1, 0, 1),
    textAlign: 'center',
    letterSpacing: '0.04em',
  },
  attackCell: {
    fontClass: 'font-display',
    fontSize: sheetScaledPx(14),
    lineHeight: '1',
    padding: sheetScaledPadding(2, 3, 0, 3),
    textAlign: 'left',
    letterSpacing: '0.04em',
  },
  attackCellCentered: {
    fontClass: 'font-display',
    fontSize: sheetScaledPx(14),
    lineHeight: '1',
    padding: sheetScaledPadding(2, 1, 0, 1),
    textAlign: 'center',
    letterSpacing: '0.04em',
  },
} as const satisfies Record<string, SheetFieldVisualPreset>
