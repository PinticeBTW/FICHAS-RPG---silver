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
    page: 1,
    width: 475,
    height: 675,
  },
  {
    page: 2,
    width: 475,
    height: 675,
  },
  {
    page: 3,
    width: 475,
    height: 675,
  },
  {
    page: 4,
    width: 475,
    height: 675,
  },
] as const

const page1AttackRows = [
  { index: 1, ataques: { x: 12, y: 332, width: 125, height: 23 }, teste: { x: 139, y: 332, width: 78, height: 23 }, dano: { x: 219, y: 332, width: 98, height: 23 } },
  { index: 2, ataques: { x: 12, y: 307, width: 125, height: 23 }, teste: { x: 139, y: 307, width: 78, height: 23 }, dano: { x: 219, y: 307, width: 98, height: 23 } },
  { index: 3, ataques: { x: 12, y: 282, width: 125, height: 23 }, teste: { x: 139, y: 282, width: 78, height: 23 }, dano: { x: 219, y: 282, width: 98, height: 23 } },
  { index: 4, ataques: { x: 12, y: 257, width: 125, height: 23 }, teste: { x: 139, y: 257, width: 78, height: 23 }, dano: { x: 219, y: 257, width: 98, height: 23 } },
  { index: 5, ataques: { x: 12, y: 232, width: 125, height: 23 }, teste: { x: 139, y: 232, width: 78, height: 23 }, dano: { x: 220, y: 232, width: 98, height: 23 } },
  { index: 6, ataques: { x: 13, y: 207, width: 125, height: 23 }, teste: { x: 140, y: 207, width: 78, height: 23 }, dano: { x: 220, y: 207, width: 98, height: 23 } },
  { index: 7, ataques: { x: 12, y: 182, width: 125, height: 23 }, teste: { x: 139, y: 182, width: 78, height: 23 }, dano: { x: 219, y: 182, width: 98, height: 23 } },
  { index: 8, ataques: { x: 12, y: 157, width: 125, height: 23 }, teste: { x: 139, y: 157, width: 78, height: 23 }, dano: { x: 220, y: 157, width: 98, height: 23 } },
  { index: 9, ataques: { x: 13, y: 132, width: 125, height: 23 }, teste: { x: 140, y: 132, width: 78, height: 23 }, dano: { x: 220, y: 132, width: 98, height: 23 } },
  { index: 10, ataques: { x: 13, y: 106, width: 125, height: 23 }, teste: { x: 140, y: 107, width: 78, height: 23 }, dano: { x: 220, y: 107, width: 98, height: 23 } },
  { index: 11, ataques: { x: 13, y: 81, width: 125, height: 23 }, teste: { x: 140, y: 82, width: 78, height: 23 }, dano: { x: 220, y: 82, width: 98, height: 23 } },
  { index: 12, ataques: { x: 13, y: 56, width: 125, height: 23 }, teste: { x: 140, y: 57, width: 78, height: 23 }, dano: { x: 220, y: 57, width: 98, height: 23 } },
] as const

function buildAttackFields(): PdfSheetTemplateField[] {
  return page1AttackRows.flatMap((row) => [
    { name: `ATAQUES${row.index}`, widgetIndex: 0, page: 1, ...row.ataques },
    { name: `TESTE${row.index}`, widgetIndex: 0, page: 1, ...row.teste },
    { name: `DANO${row.index}`, widgetIndex: 0, page: 1, ...row.dano },
  ])
}

const page1InventoryRows = [
  { index: 1, item: { x: 319, y: 190, width: 80, height: 23 }, space: { x: 400, y: 190, width: 63, height: 23 } },
  { index: 2, item: { x: 319, y: 166, width: 80, height: 23 }, space: { x: 400, y: 166, width: 63, height: 23 } },
  { index: 3, item: { x: 319, y: 141, width: 80, height: 23 }, space: { x: 400, y: 141, width: 63, height: 23 } },
  { index: 4, item: { x: 320, y: 116, width: 80, height: 23 }, space: { x: 400, y: 115, width: 63, height: 23 } },
  { index: 5, item: { x: 319, y: 91, width: 80, height: 23 }, space: { x: 400, y: 91, width: 63, height: 23 } },
  { index: 6, item: { x: 320, y: 66, width: 80, height: 23 }, space: { x: 401, y: 66, width: 63, height: 23 } },
  { index: 7, item: { x: 319, y: 42, width: 80, height: 23 }, space: { x: 400, y: 41, width: 63, height: 23 } },
  { index: 8, item: { x: 320, y: 16, width: 80, height: 23 }, space: { x: 401, y: 16, width: 63, height: 23 } },
] as const

function buildInventoryFields(): PdfSheetTemplateField[] {
  return page1InventoryRows.flatMap((row) => [
    { name: `INV ${row.index}`, widgetIndex: 0, page: 1, ...row.item },
    { name: `ESP${row.index}`, widgetIndex: 0, page: 1, ...row.space },
  ])
}

const page2AttributeTopFields: PdfSheetTemplateField[] = [
  { name: 'AGILIDADE-TOP', widgetIndex: 0, page: 2, x: 44, y: 628, width: 23, height: 24 },
  { name: 'VIGOR-TOP', widgetIndex: 0, page: 2, x: 134, y: 627, width: 23, height: 24 },
  { name: 'PRESENCA-TOP', widgetIndex: 0, page: 2, x: 225, y: 628, width: 23, height: 24 },
  { name: 'FORCA-TOP', widgetIndex: 0, page: 2, x: 315, y: 628, width: 23, height: 24 },
  { name: 'INTELIGENCIA-TOP', widgetIndex: 0, page: 2, x: 404, y: 628, width: 23, height: 24 },
] as const

const leftSkills = [
  { name: 'ACROBACIA', x: 166, y: 471, width: 46, height: 11, scoreX: 147, scoreWidth: 14, scoreHeight: 11 },
  { name: 'ARTES', x: 166, y: 453, width: 46, height: 11, scoreX: 147, scoreWidth: 14, scoreHeight: 11 },
  { name: 'ATLETISMO', x: 166, y: 435, width: 46, height: 11, scoreX: 147, scoreWidth: 14, scoreHeight: 11 },
  { name: 'ATUALIDADES', x: 166, y: 417, width: 46, height: 11, scoreX: 147, scoreWidth: 14, scoreHeight: 11 },
  { name: 'CIENCIAS', x: 166, y: 399, width: 46, height: 11, scoreX: 147, scoreWidth: 14, scoreHeight: 11 },
  { name: 'CRIME', x: 166, y: 381, width: 46, height: 11, scoreX: 147, scoreWidth: 14, scoreHeight: 11 },
  { name: 'CONDUCAO', x: 165, y: 363, width: 46, height: 11, scoreX: 147, scoreWidth: 14, scoreHeight: 11 },
  { name: 'DIPLOMACIA', x: 165, y: 345, width: 46, height: 11, scoreX: 147, scoreWidth: 14, scoreHeight: 11 },
  { name: 'DOMISTICACAO', x: 166, y: 327, width: 46, height: 11, scoreX: 147, scoreWidth: 14, scoreHeight: 11 },
  { name: 'FORTITUDE', x: 166, y: 309, width: 46, height: 11, scoreX: 147, scoreWidth: 14, scoreHeight: 11 },
  { name: 'FURTIVIDADE', x: 166, y: 291, width: 46, height: 11, scoreX: 147, scoreWidth: 14, scoreHeight: 11 },
  { name: 'INICIATIVA', x: 166, y: 273, width: 46, height: 11, scoreX: 147, scoreWidth: 14, scoreHeight: 11 },
  { name: 'INTIMIDACAO', x: 166, y: 255, width: 46, height: 11, scoreX: 148, scoreWidth: 14, scoreHeight: 11 },
  { name: 'INTUICAO', x: 166, y: 237, width: 46, height: 11, scoreX: 148, scoreWidth: 14, scoreHeight: 11 },
] as const

const rightSkills = [
  { name: 'INVESTIGACAO', x: 392, y: 471, width: 46, height: 11, scoreX: 374, scoreWidth: 14, scoreHeight: 11 },
  { name: 'LUTA', x: 392, y: 453, width: 46, height: 11, scoreX: 373, scoreWidth: 14, scoreHeight: 11 },
  { name: 'MEDICINA', x: 392, y: 435, width: 46, height: 11, scoreX: 373, scoreWidth: 14, scoreHeight: 11 },
  { name: 'MENTIRA', x: 392, y: 417, width: 46, height: 11, scoreX: 373, scoreWidth: 14, scoreHeight: 11 },
  { name: 'PRECEPCAO', x: 392, y: 399, width: 46, height: 11, scoreX: 373, scoreWidth: 14, scoreHeight: 11 },
  { name: 'PONTARIA', x: 392, y: 381, width: 46, height: 11, scoreX: 373, scoreWidth: 14, scoreHeight: 11 },
  { name: 'PROFISSAO', x: 391, y: 363, width: 46, height: 11, scoreX: 373, scoreWidth: 14, scoreHeight: 11 },
  { name: 'REFLEXOS', x: 391, y: 345, width: 46, height: 11, scoreX: 373, scoreWidth: 14, scoreHeight: 11 },
  { name: 'SOBREVIVENCIA', x: 392, y: 327, width: 46, height: 11, scoreX: 373, scoreWidth: 14, scoreHeight: 11 },
  { name: 'TATICA', x: 392, y: 309, width: 46, height: 11, scoreX: 373, scoreWidth: 14, scoreHeight: 11 },
  { name: 'TECNOLOGIA', x: 392, y: 291, width: 46, height: 11, scoreX: 374, scoreWidth: 14, scoreHeight: 11 },
  { name: 'VONTADE', x: 392, y: 273, width: 46, height: 11, scoreX: 373, scoreWidth: 14, scoreHeight: 11 },
] as const

const skillScoreFieldOffsetX = 2
const skillScoreFieldWidthExtra = 2

function buildSkillFields(): PdfSheetTemplateField[] {
  const fields: PdfSheetTemplateField[] = []

  for (const skill of leftSkills) {
    fields.push({ name: skill.name, widgetIndex: 0, page: 2, x: skill.x, y: skill.y, width: skill.width, height: skill.height })
    fields.push({
      name: `${skill.name} 1`,
      widgetIndex: 0,
      page: 2,
      x: skill.scoreX + skillScoreFieldOffsetX,
      y: skill.y,
      width: skill.scoreWidth + skillScoreFieldWidthExtra,
      height: skill.scoreHeight,
    })
  }

  for (const skill of rightSkills) {
    fields.push({ name: skill.name, widgetIndex: 0, page: 2, x: skill.x, y: skill.y, width: skill.width, height: skill.height })
    fields.push({
      name: `${skill.name} 1`,
      widgetIndex: 0,
      page: 2,
      x: skill.scoreX + skillScoreFieldOffsetX,
      y: skill.y,
      width: skill.scoreWidth + skillScoreFieldWidthExtra,
      height: skill.scoreHeight,
    })
  }

  return fields
}

const page3Rows = [
  { ability: { x: 92, y: 594, width: 146, height: 23 }, cost: { x: 240, y: 594, width: 60, height: 23 }, description: { x: 302, y: 594, width: 161, height: 23 } },
  { ability: { x: 91, y: 569, width: 146, height: 23 }, cost: { x: 239, y: 569, width: 60, height: 23 }, description: { x: 301, y: 569, width: 161, height: 23 } },
  { ability: { x: 94, y: 544, width: 146, height: 23 }, cost: { x: 242, y: 544, width: 60, height: 23 }, description: { x: 304, y: 544, width: 161, height: 23 } },
  { ability: { x: 93, y: 519, width: 146, height: 23 }, cost: { x: 241, y: 519, width: 60, height: 23 }, description: { x: 303, y: 519, width: 161, height: 23 } },
  { ability: { x: 91, y: 493, width: 146, height: 23 }, cost: { x: 239, y: 493, width: 60, height: 23 }, description: { x: 301, y: 494, width: 161, height: 23 } },
  { ability: { x: 90, y: 468, width: 146, height: 23 }, cost: { x: 238, y: 468, width: 60, height: 23 }, description: { x: 300, y: 468, width: 161, height: 23 } },
  { ability: { x: 93, y: 443, width: 146, height: 23 }, cost: { x: 241, y: 443, width: 60, height: 23 }, description: { x: 303, y: 444, width: 161, height: 23 } },
  { ability: { x: 92, y: 418, width: 146, height: 23 }, cost: { x: 240, y: 418, width: 60, height: 23 }, description: { x: 302, y: 418, width: 161, height: 23 } },
  { ability: { x: 91, y: 392, width: 146, height: 23 }, cost: { x: 239, y: 392, width: 60, height: 23 }, description: { x: 301, y: 393, width: 161, height: 23 } },
  { ability: { x: 93, y: 367, width: 146, height: 23 }, cost: { x: 241, y: 367, width: 60, height: 23 }, description: { x: 303, y: 368, width: 161, height: 23 } },
  { ability: { x: 93, y: 342, width: 146, height: 23 }, cost: { x: 241, y: 342, width: 60, height: 23 }, description: { x: 303, y: 343, width: 161, height: 23 } },
  { ability: { x: 92, y: 266, width: 146, height: 23 }, cost: { x: 240, y: 266, width: 60, height: 23 }, description: { x: 302, y: 267, width: 161, height: 23 } },
  { ability: { x: 91, y: 241, width: 146, height: 23 }, cost: { x: 240, y: 241, width: 60, height: 23 }, description: { x: 302, y: 241, width: 161, height: 23 } },
  { ability: { x: 94, y: 216, width: 146, height: 23 }, cost: { x: 242, y: 216, width: 60, height: 23 }, description: { x: 304, y: 217, width: 161, height: 23 } },
  { ability: { x: 93, y: 191, width: 146, height: 23 }, cost: { x: 241, y: 191, width: 60, height: 23 }, description: { x: 303, y: 192, width: 161, height: 23 } },
  { ability: { x: 91, y: 165, width: 146, height: 23 }, cost: { x: 239, y: 165, width: 60, height: 23 }, description: { x: 301, y: 166, width: 161, height: 23 } },
  { ability: { x: 90, y: 140, width: 146, height: 23 }, cost: { x: 238, y: 140, width: 60, height: 23 }, description: { x: 300, y: 141, width: 161, height: 23 } },
  { ability: { x: 93, y: 115, width: 146, height: 23 }, cost: { x: 241, y: 115, width: 60, height: 23 }, description: { x: 303, y: 116, width: 161, height: 23 } },
  { ability: { x: 92, y: 90, width: 146, height: 23 }, cost: { x: 240, y: 90, width: 60, height: 23 }, description: { x: 302, y: 91, width: 161, height: 23 } },
  { ability: { x: 91, y: 64, width: 146, height: 23 }, cost: { x: 239, y: 64, width: 60, height: 23 }, description: { x: 301, y: 65, width: 161, height: 23 } },
  { ability: { x: 93, y: 40, width: 146, height: 23 }, cost: { x: 241, y: 39, width: 60, height: 23 }, description: { x: 303, y: 40, width: 161, height: 23 } },
  { ability: { x: 93, y: 14, width: 146, height: 23 }, cost: { x: 241, y: 14, width: 60, height: 23 }, description: { x: 303, y: 15, width: 161, height: 23 } },
] as const

function buildPage3Fields(): PdfSheetTemplateField[] {
  return page3Rows.flatMap((row, index) => {
    const slot = index + 1

    return [
      { name: slot === 1 ? 'HAB 1' : `HAB${slot}`, widgetIndex: 0, page: 3, ...row.ability },
      { name: `CUSTO${slot}`, widgetIndex: 0, page: 3, ...row.cost },
      { name: `DESC${slot}`, widgetIndex: 0, page: 3, ...row.description },
    ]
  })
}

export const pdfSheetTemplateFields: PdfSheetTemplateField[] = [
  { name: 'CIDADE', widgetIndex: 0, page: 1, x: 13, y: 600, width: 351, height: 59 },
  { name: 'NOME', widgetIndex: 0, page: 1, x: 270, y: 537, width: 189, height: 20 },
  { name: 'IDADE', widgetIndex: 0, page: 1, x: 270, y: 515, width: 189, height: 20 },
  { name: 'ALTURA', widgetIndex: 0, page: 1, x: 282, y: 492, width: 176, height: 20 },
  { name: 'SEXO', widgetIndex: 0, page: 1, x: 264, y: 470, width: 195, height: 20 },
  { name: 'NACIONALIDADE', widgetIndex: 0, page: 1, x: 333, y: 448, width: 125, height: 20 },
  { name: 'TIPOLOGIA', widgetIndex: 0, page: 1, x: 293, y: 427, width: 165, height: 20 },
  { name: 'OCUPAÇÃO', widgetIndex: 0, page: 1, x: 294, y: 404, width: 164, height: 20 },
  ...buildAttackFields(),
  { name: 'CYBERPHYSHOSIS', widgetIndex: 0, page: 1, x: 195, y: 16, width: 122, height: 39 },
  ...buildInventoryFields(),
  { name: 'KARMA', widgetIndex: 0, page: 1, x: 330, y: 243, width: 128, height: 27 },

  { name: 'AGILIDADE', widgetIndex: 0, page: 2, x: 24, y: 552, width: 66, height: 69 },
  { name: 'VIGOR', widgetIndex: 0, page: 2, x: 113, y: 552, width: 66, height: 69 },
  { name: 'PRESENÇA', widgetIndex: 0, page: 2, x: 204, y: 552, width: 66, height: 69 },
  { name: 'FORÇA', widgetIndex: 0, page: 2, x: 293, y: 552, width: 66, height: 69 },
  { name: 'INTELIGENCIA', widgetIndex: 0, page: 2, x: 384, y: 552, width: 66, height: 69 },
  ...page2AttributeTopFields,
  ...buildSkillFields(),
  { name: 'PV', widgetIndex: 0, page: 2, x: 170, y: 175, width: 44, height: 25 },
  { name: 'PV-ATUAL', widgetIndex: 0, page: 2, x: 170, y: 148, width: 44, height: 25 },
  { name: 'PS', widgetIndex: 0, page: 2, x: 170, y: 121, width: 44, height: 25 },
  { name: 'PS-ATUAL', widgetIndex: 0, page: 2, x: 170, y: 94, width: 44, height: 25 },
  { name: 'PE', widgetIndex: 0, page: 2, x: 170, y: 67, width: 44, height: 25 },
  { name: 'PE-ATUAL', widgetIndex: 0, page: 2, x: 171, y: 40, width: 44, height: 25 },
  { name: 'EX', widgetIndex: 0, page: 2, x: 286, y: 94, width: 55, height: 54 },
  { name: 'DEFESA', widgetIndex: 0, page: 2, x: 287, y: 39, width: 55, height: 54 },
  { name: 'EX 1', widgetIndex: 0, page: 2, x: 407, y: 95, width: 47, height: 54 },
  { name: 'BLOQUEIO', widgetIndex: 0, page: 2, x: 407, y: 38, width: 47, height: 54 },
  { name: 'DESL', widgetIndex: 0, page: 2, x: 343, y: 150, width: 88, height: 51 },

  ...buildPage3Fields(),
]
