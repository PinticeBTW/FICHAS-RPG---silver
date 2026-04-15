export type PdfSheetTemplateField = {
  name: string
  widgetIndex: number
  page: number
  x: number
  y: number
  width: number
  height: number
}

export const pdfSheetPageSizes = [
  {
    "page": 1,
    "width": 475,
    "height": 675
  },
  {
    "page": 2,
    "width": 475,
    "height": 675
  },
  {
    "page": 3,
    "width": 475,
    "height": 675
  },
  {
    "page": 4,
    "width": 475,
    "height": 675
  }
] as const

// Page 3 columns — from actual PDF rect extraction
const page3Columns = {
  ability: {
    x: 90,
    width: 150,
  },
  value: {
    x: 238,
    width: 64,
  },
  description: {
    x: 300,
    width: 165,
  },
} as const

// page2AttributeTopFields — small boxes at the top of each attribute circle
const page2AttributeTopFields: PdfSheetTemplateField[] = [
  {
    name: 'AGILIDADE-TOP',
    widgetIndex: 0,
    page: 2,
    x: 44,
    y: 601,
    width: 24,
    height: 13,
  },
  {
    name: 'VIGOR-TOP',
    widgetIndex: 0,
    page: 2,
    x: 135,
    y: 601,
    width: 24,
    height: 13,
  },
  {
    name: 'PRESENCA-TOP',
    widgetIndex: 0,
    page: 2,
    x: 226,
    y: 601,
    width: 24,
    height: 13,
  },
  {
    name: 'FORCA-TOP',
    widgetIndex: 0,
    page: 2,
    x: 317,
    y: 601,
    width: 24,
    height: 13,
  },
  {
    name: 'INTELIGENCIA-TOP',
    widgetIndex: 0,
    page: 2,
    x: 408,
    y: 601,
    width: 24,
    height: 13,
  },
] as const

// Page 3 rows — upper 11 (RAM section) + lower 11 (PE section)
// Row height = 27 (from actual PDF)
const page3RowHeight = 27

const page3RowBottoms = [
  // Upper section (rows 1-11, RAM)
  592, 567, 542, 517, 492, 467, 442, 417, 392, 367, 342,
  // Lower section (rows 12-22, PE)
  264, 239, 214, 189, 164, 139, 114, 89, 64, 39, 14,
] as const

function buildPage3Fields(): PdfSheetTemplateField[] {
  return page3RowBottoms.flatMap((y, index) => {
    const slot = index + 1
    const abilityName = slot === 1 ? 'HAB 1' : `HAB${slot}`

    return [
      {
        name: abilityName,
        widgetIndex: 0,
        page: 3,
        x: page3Columns.ability.x,
        y,
        width: page3Columns.ability.width,
        height: page3RowHeight,
      },
      {
        name: `CUSTO${slot}`,
        widgetIndex: 0,
        page: 3,
        x: page3Columns.value.x,
        y,
        width: page3Columns.value.width,
        height: page3RowHeight,
      },
      {
        name: `DESC${slot}`,
        widgetIndex: 0,
        page: 3,
        x: page3Columns.description.x,
        y,
        width: page3Columns.description.width,
        height: page3RowHeight,
      },
    ]
  })
}

// Page 1 attack table rows (12 rows from rect extraction)
// Columns: ATAQUES x=10 w=129, TESTE x=137 w=82, DANO x=217 w=102, h=27 each
const attackRows = [355, 330, 305, 280, 255, 230, 205, 180, 155, 130, 105, 80] as const

function buildAttackFields(): PdfSheetTemplateField[] {
  return attackRows.flatMap((y, i) => {
    const n = i + 1
    return [
      { name: `ATAQUES${n}`, widgetIndex: 0, page: 1, x: 10,  y, width: 129, height: 27 },
      { name: `TESTE${n}`,   widgetIndex: 0, page: 1, x: 137, y, width: 82,  height: 27 },
      { name: `DANO${n}`,    widgetIndex: 0, page: 1, x: 217, y, width: 102, height: 27 },
    ]
  })
}

// Page 1 inventory rows (6 rows from rect extraction)
// INV: x=317 w=83, ESP: x=398 w=67, h=27 each
const invRows = [214, 189, 164, 139, 114, 89] as const

function buildInvFields(): PdfSheetTemplateField[] {
  return invRows.flatMap((y, i) => {
    const n = i + 1
    return [
      { name: `INV ${n}`, widgetIndex: 0, page: 1, x: 317, y, width: 83, height: 27 },
      { name: `ESP${n}`,  widgetIndex: 0, page: 1, x: 398, y, width: 67, height: 27 },
    ]
  })
}

// Page 2 skill rows
// Left side:  bonus x=137 w=25, value x=165 w=48, h=13
// Right side: bonus x=363 w=25, value x=391 w=48, h=13
const leftSkills = [
  { name: 'ACROBACIA',    y: 470 },
  { name: 'ARTES',        y: 452 },
  { name: 'ATLETISMO',    y: 434 },
  { name: 'ATUALIDADES',  y: 416 },
  { name: 'CIENCIAS',     y: 398 },
  { name: 'CRIME',        y: 380 },
  { name: 'CONDUCAO',     y: 362 },
  { name: 'DIPLOMACIA',   y: 344 },
  { name: 'DOMISTICAÇÃO', y: 326 },
  { name: 'FORTITUDE',    y: 308 },
  { name: 'FURTIVIDADE',  y: 290 },
  { name: 'INICIATIVA',   y: 272 },
  { name: 'INTIMIDAÇÃO',  y: 254 },
  { name: 'INTUIÇÃO',     y: 236 },
] as const

const rightSkills = [
  { name: 'INVESTIGAÇÃO',  y: 470 },
  { name: 'LUTA',          y: 452 },
  { name: 'MEDICINA',      y: 434 },
  { name: 'MENTIRA',       y: 416 },
  { name: 'PRECEPÇÃO',     y: 398 },
  { name: 'PONTARIA',      y: 380 },
  { name: 'PROFISSAO',     y: 362 },
  { name: 'REFLEXOS',      y: 344 },
  { name: 'SOBREVIVENCIA', y: 326 },
  { name: 'TATICA',        y: 308 },
  { name: 'TECNOLOGIA',    y: 290 },
  { name: 'VONTADE',       y: 272 },
] as const

function buildSkillFields(): PdfSheetTemplateField[] {
  const fields: PdfSheetTemplateField[] = []
  for (const s of leftSkills) {
    fields.push({ name: s.name,      widgetIndex: 0, page: 2, x: 165, y: s.y, width: 48, height: 13 })
    fields.push({ name: `${s.name} 1`, widgetIndex: 0, page: 2, x: 137, y: s.y, width: 25, height: 13 })
  }
  for (const s of rightSkills) {
    fields.push({ name: s.name,      widgetIndex: 0, page: 2, x: 391, y: s.y, width: 48, height: 13 })
    fields.push({ name: `${s.name} 1`, widgetIndex: 0, page: 2, x: 363, y: s.y, width: 25, height: 13 })
  }
  return fields
}

export const pdfSheetTemplateFields: PdfSheetTemplateField[] = [
  // ─── PAGE 1 ──────────────────────────────────────────────────────────────
  // City name (large box at top)
  { name: 'CIDADE',       widgetIndex: 0, page: 1, x: 10,  y: 599, width: 455, height: 62  },

  // Info section (right column, no rect boxes — estimated from label text positions)
  { name: 'NOME',         widgetIndex: 0, page: 1, x: 269, y: 541, width: 199, height: 20 },
  { name: 'IDADE',        widgetIndex: 0, page: 1, x: 269, y: 519, width: 199, height: 20 },
  { name: 'ALTURA',       widgetIndex: 0, page: 1, x: 283, y: 497, width: 185, height: 20 },
  { name: 'SEXO',         widgetIndex: 0, page: 1, x: 264, y: 475, width: 204, height: 20 },
  { name: 'NACIONALIDADE',widgetIndex: 0, page: 1, x: 334, y: 453, width: 134, height: 20 },
  { name: 'TIPOLOGIA',    widgetIndex: 0, page: 1, x: 293, y: 431, width: 175, height: 20 },
  { name: 'OCUPAÇÃO',     widgetIndex: 0, page: 1, x: 294, y: 409, width: 174, height: 20 },

  // KARMA (large box, right side)
  { name: 'KARMA',        widgetIndex: 0, page: 1, x: 317, y: 292, width: 148, height: 97  },

  // Cyberpsychosis (bottom left — estimated)
  { name: 'CYBERPHYSHOSIS', widgetIndex: 0, page: 1, x: 185, y: 18, width: 80, height: 30 },

  // Attack rows (generated)
  ...buildAttackFields(),

  // Inventory rows (generated)
  ...buildInvFields(),

  // ─── PAGE 2 ──────────────────────────────────────────────────────────────
  // Attribute circles (estimated from label text centres — no rect in PDF)
  { name: 'AGILIDADE',    widgetIndex: 0, page: 2, x: 21,  y: 531, width: 70, height: 70 },
  { name: 'VIGOR',        widgetIndex: 0, page: 2, x: 112, y: 531, width: 70, height: 70 },
  { name: 'PRESENÇA',     widgetIndex: 0, page: 2, x: 203, y: 531, width: 70, height: 70 },
  { name: 'FORÇA',        widgetIndex: 0, page: 2, x: 294, y: 531, width: 70, height: 70 },
  { name: 'INTELIGENCIA', widgetIndex: 0, page: 2, x: 385, y: 531, width: 70, height: 70 },

  // Skills (generated)
  ...buildSkillFields(),

  // Attribute top fields
  ...page2AttributeTopFields,

  // HP / sanity / effort points (left column — from rect extraction)
  { name: 'PV',       widgetIndex: 0, page: 2, x: 168, y: 173, width: 48, height: 29 },
  { name: 'PV-ATUAL', widgetIndex: 0, page: 2, x: 168, y: 146, width: 48, height: 29 },
  { name: 'PS',       widgetIndex: 0, page: 2, x: 168, y: 119, width: 48, height: 29 },
  { name: 'PS-ATUAL', widgetIndex: 0, page: 2, x: 168, y:  92, width: 48, height: 29 },
  { name: 'PE',       widgetIndex: 0, page: 2, x: 168, y:  65, width: 48, height: 29 },
  { name: 'PE-ATUAL', widgetIndex: 0, page: 2, x: 168, y:  38, width: 48, height: 29 },

  // Combat stats (right column — from rect extraction)
  { name: 'DESL',    widgetIndex: 0, page: 2, x: 341, y: 148, width: 114, height: 54 },
  { name: 'EX',      widgetIndex: 0, page: 2, x: 285, y:  92, width:  58, height: 58 },
  { name: 'EX 1',    widgetIndex: 0, page: 2, x: 405, y:  92, width:  50, height: 58 },
  { name: 'DEFESA',  widgetIndex: 0, page: 2, x: 285, y:  38, width:  58, height: 56 },
  { name: 'BLOQUEIO',widgetIndex: 0, page: 2, x: 405, y:  38, width:  50, height: 56 },

  // ─── PAGE 3 ──────────────────────────────────────────────────────────────
  ...buildPage3Fields(),
]
