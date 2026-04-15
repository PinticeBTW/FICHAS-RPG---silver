/**
 * Scales pdfSheetTemplate.ts from old 594.56×847 pages to new 475×675 pages.
 * Run: node scripts/scale-template.mjs
 */

import { writeFileSync } from 'fs'

const SX = 475 / 594.56
const SY1 = 675 / 846.275  // page 1
const SY = 675 / 847.404   // pages 2, 3, 4

function sx(v) { return Math.round(v * SX * 1000) / 1000 }
function sy1(v) { return Math.round(v * SY1 * 1000) / 1000 }
function sy(v) { return Math.round(v * SY * 1000) / 1000 }

// page3RowBottoms scaled
const oldRowBottoms = [
  726.806, 696.148, 665.409, 635.579, 604.920, 574.181,
  543.367, 513.538, 482.879, 452.140, 421.505,
  328.511, 297.852, 267.113, 237.284, 206.625,
  175.886, 145.072, 115.242,  84.584,  53.845, 23.210,
]
const newRowBottoms = oldRowBottoms.map(v => sy(v))

// page3RowHeight scaled
const newRowHeight = Math.round(30.659 * SY * 1000) / 1000

// page3Columns — from text extraction of new PDFs
const page3Columns = {
  ability:     { x: 92,  width: 145 },
  value:       { x: 237, width: 83  },
  description: { x: 320, width: 150 },
}

// page2AttributeTopFields scaled
const attrTopFields = [
  { name: 'AGILIDADE-TOP',   x: 70.92,   y: 790.476, w: 30, h: 18 },
  { name: 'VIGOR-TOP',       x: 177.114, y: 790.835, w: 30, h: 18 },
  { name: 'PRESENCA-TOP',    x: 282.467, y: 790.835, w: 30, h: 18 },
  { name: 'FORCA-TOP',       x: 388.879, y: 790.817, w: 30, h: 18 },
  { name: 'INTELIGENCIA-TOP',x: 496.173, y: 790.429, w: 30, h: 18 },
].map(f => ({
  name: f.name, widgetIndex: 0, page: 2,
  x: sx(f.x), y: sy(f.y), width: sx(f.w), height: sy(f.h),
}))

// All fields (page 1 uses SY1, pages 2+ use SY)
const rawFields = [
  // --- PAGE 1 ---
  { name: 'CIDADE',      page: 1, x: 19.047,  y: 753.329, w: 424.017, h: 68.073 },
  { name: 'NOME',        page: 1, x: 381.733, y: 662.137, w: 193.615, h: 21.600 },
  { name: 'IDADE',       page: 1, x: 381.339, y: 637.919, w: 193.354, h: 21.600 },
  { name: 'ALTURA',      page: 1, x: 397.049, y: 611.868, w: 177.382, h: 21.600 },
  { name: 'SEXO',        page: 1, x: 373.747, y: 586.734, w: 201.601, h: 21.600 },
  { name: 'NACIONALIDADE', page: 1, x: 458.310, y: 560.290, w: 116.641, h: 21.599 },
  { name: 'TIPOLOGIA',   page: 1, x: 413.412, y: 534.762, w: 160.759, h: 21.600 },
  { name: 'OCUPAÇÃO',    page: 1, x: 417.602, y: 508.352, w: 158.270, h: 21.600 },
  { name: 'ATAQUES1',    page: 1, x: 20.318,  y: 424.420, w: 152.629, h: 24.873 },
  { name: 'TESTE1',      page: 1, x: 174.594, y: 424.288, w:  96.121, h: 25.308 },
  { name: 'DANO1',       page: 1, x: 272.667, y: 423.415, w: 114.448, h: 26.182 },
  { name: 'ATAQUES2',    page: 1, x:  19.903, y: 397.912, w: 152.630, h: 24.873 },
  { name: 'TESTE2',      page: 1, x: 174.266, y: 397.258, w:  96.121, h: 25.309 },
  { name: 'DANO2',       page: 1, x: 272.448, y: 397.258, w: 114.448, h: 26.182 },
  { name: 'ATAQUES3',    page: 1, x:  20.339, y: 371.730, w: 152.630, h: 24.873 },
  { name: 'TESTE3',      page: 1, x: 174.430, y: 371.500, w:  96.121, h: 25.309 },
  { name: 'DANO3',       page: 1, x: 272.121, y: 371.064, w: 114.448, h: 26.182 },
  { name: 'TESTE4',      page: 1, x: 174.539, y: 346.216, w:  96.121, h: 25.308 },
  { name: 'ATAQUES4',    page: 1, x:  20.536, y: 346.148, w: 152.630, h: 24.873 },
  { name: 'DANO4',       page: 1, x: 271.902, y: 344.906, w: 114.448, h: 26.182 },
  { name: 'TESTE5',      page: 1, x: 174.949, y: 320.222, w:  96.121, h: 25.308 },
  { name: 'DANO5',       page: 1, x: 272.394, y: 320.003, w: 114.448, h: 25.310 },
  { name: 'ATAQUES5',    page: 1, x:  20.558, y: 319.640, w: 152.629, h: 24.873 },
  { name: 'KARMA',       page: 1, x: 415.639, y: 294.936, w: 142.691, h: 30.110 },
  { name: 'DANO6',       page: 1, x: 272.175, y: 294.718, w: 114.448, h: 24.437 },
  { name: 'TESTE6',      page: 1, x: 174.621, y: 294.501, w:  96.121, h: 25.308 },
  { name: 'ATAQUES6',    page: 1, x:  20.558, y: 293.458, w: 152.630, h: 24.873 },
  { name: 'DANO7',       page: 1, x: 271.848, y: 269.397, w: 114.448, h: 23.128 },
  { name: 'TESTE7',      page: 1, x: 173.912, y: 268.743, w:  96.121, h: 25.309 },
  { name: 'ATAQUES7',    page: 1, x:  19.990, y: 267.903, w: 152.630, h: 24.873 },
  { name: 'DANO8',       page: 1, x: 271.629, y: 242.803, w: 114.448, h: 24.001 },
  { name: 'TESTE8',      page: 1, x: 174.457, y: 242.586, w:  96.121, h: 23.999 },
  { name: 'ATAQUES8',    page: 1, x:  19.576, y: 241.395, w: 152.630, h: 24.873 },
  { name: 'INV 1',       page: 1, x: 387.987, y: 238.252, w: 113.616, h: 18.764 },
  { name: 'ESP1',        page: 1, x: 502.912, y: 237.086, w:  74.617, h: 20.289 },
  { name: 'DANO9',       page: 1, x: 272.831, y: 217.458, w: 114.448, h: 22.691 },
  { name: 'ESP2',        page: 1, x: 503.564, y: 216.687, w:  73.746, h: 19.419 },
  { name: 'TESTE9',      page: 1, x: 174.803, y: 216.513, w:  96.121, h: 24.872 },
  { name: 'INV 2',       page: 1, x: 388.518, y: 216.128, w: 112.321, h: 20.597 },
  { name: 'ATAQUES9',    page: 1, x:  20.012, y: 215.213, w: 152.630, h: 24.873 },
  { name: 'INV 3',       page: 1, x: 387.558, y: 196.230, w: 113.368, h: 18.982 },
  { name: 'ESP3',        page: 1, x: 503.477, y: 195.088, w:  74.269, h: 20.813 },
  { name: 'DANO10',      page: 1, x: 272.611, y: 190.864, w: 114.448, h: 23.128 },
  { name: 'ATAQUES10',   page: 1, x:  20.209, y: 189.631, w: 152.630, h: 24.873 },
  { name: 'TESTE10',     page: 1, x: 174.475, y: 189.046, w:  96.121, h: 25.309 },
  { name: 'INV 4',       page: 1, x: 388.125, y: 175.852, w: 112.713, h: 18.720 },
  { name: 'ESP4',        page: 1, x: 503.128, y: 175.669, w:  73.746, h: 18.763 },
  { name: 'DANO11',      page: 1, x: 272.721, y: 160.830, w: 114.448, h: 27.230 },
  { name: 'TESTE11',     page: 1, x: 174.203, y: 160.671, w:  97.430, h: 27.490 },
  { name: 'ATAQUES11',   page: 1, x:  20.230, y: 158.759, w: 152.630, h: 30.546 },
  { name: 'ESP5',        page: 1, x: 503.128, y: 153.851, w:  73.746, h: 19.418 },
  { name: 'INV 5',       page: 1, x: 387.863, y: 153.815, w: 113.849, h: 19.637 },
  { name: 'ESP6',        page: 1, x: 503.564, y: 132.849, w:  73.746, h: 19.418 },
  { name: 'INV 6',       page: 1, x: 388.256, y: 132.390, w: 114.546, h: 20.291 },
  { name: 'DANO12',      page: 1, x: 272.938, y: 129.785, w: 114.448, h: 27.928 },
  { name: 'ATAQUES12',   page: 1, x:  20.667, y: 129.522, w: 152.630, h: 28.801 },
  { name: 'TESTE12',     page: 1, x: 173.875, y: 128.841, w:  97.866, h: 29.672 },
  { name: 'INV 7',       page: 1, x: 388.169, y: 112.416, w: 113.499, h: 19.418 },
  { name: 'ESP7',        page: 1, x: 503.564, y: 111.523, w:  73.746, h: 19.418 },
  { name: 'TESTE13',     page: 1, x: 173.830, y:  99.659, w:  97.866, h: 27.926 },
  { name: 'ATAQUES13',   page: 1, x:  20.339, y:  99.222, w: 152.630, h: 28.800 },
  { name: 'DANO13',      page: 1, x: 272.448, y:  98.786, w: 115.321, h: 28.364 },
  { name: 'ESP8',        page: 1, x: 503.128, y:  91.342, w:  73.746, h: 19.418 },
  { name: 'INV 8',       page: 1, x: 387.863, y:  91.165, w: 113.368, h: 19.418 },
  { name: 'INV 9',       page: 1, x: 388.038, y:  70.612, w: 112.364, h: 18.545 },
  { name: 'ESP9',        page: 1, x: 503.564, y:  69.742, w:  73.746, h: 19.418 },
  { name: 'ESP10',       page: 1, x: 503.128, y:  48.360, w:  73.746, h: 19.418 },
  { name: 'INV 10',      page: 1, x: 387.820, y:  47.267, w: 113.455, h: 21.163 },
  { name: 'INV 11',      page: 1, x: 387.820, y:  24.794, w: 113.237, h: 21.599 },
  { name: 'CYBERPHYSHOSIS', page: 1, x: 288.609, y: 24.322, w: 98.270, h: 64.625 },
  { name: 'ESP11',       page: 1, x: 502.473, y:  24.142, w:  74.619, h: 22.472 },
  // --- PAGE 2 ---
  { name: 'PRESENÇA',    page: 2, x: 253.010, y: 695.016, w:  88.257, h: 88.936 },
  { name: 'FORÇA',       page: 2, x: 359.432, y: 695.016, w:  88.257, h: 88.936 },
  { name: 'AGILIDADE',   page: 2, x:  41.313, y: 694.676, w:  88.257, h: 88.936 },
  { name: 'VIGOR',       page: 2, x: 147.443, y: 695.016, w:  88.257, h: 88.936 },
  { name: 'INTELIGENCIA',page: 2, x: 466.471, y: 694.624, w:  88.257, h: 88.936 },
  { name: 'INVESTIGAÇÃO',  page: 2, x: 492.675, y: 571.985, w: 57.508, h: 14.256 },
  { name: 'ACROBACIA',     page: 2, x: 215.013, y: 571.893, w: 58.315, h: 13.521 },
  { name: 'INVESTIGAÇÃO 1',page: 2, x: 461.387, y: 571.745, w: 19.847, h: 13.419 },
  { name: 'ACROBACIA 1',   page: 2, x: 184.292, y: 571.606, w: 21.812, h: 13.746 },
  { name: 'LUTA 1',        page: 2, x: 460.872, y: 551.787, w: 20.283, h: 13.420 },
  { name: 'LUTA',          page: 2, x: 492.311, y: 551.344, w: 57.660, h: 14.404 },
  { name: 'ARTES',         page: 2, x: 214.964, y: 550.748, w: 58.424, h: 13.794 },
  { name: 'ARTES 1',       page: 2, x: 184.244, y: 550.624, w: 21.484, h: 13.856 },
  { name: 'MEDICINA',      page: 2, x: 492.344, y: 531.836, w: 58.207, h: 14.012 },
  { name: 'MEDICINA 1',    page: 2, x: 460.837, y: 530.450, w: 20.611, h: 14.947 },
  { name: 'ATLETISMO',     page: 2, x: 215.266, y: 529.441, w: 58.424, h: 14.012 },
  { name: 'ATLETISMO 1',   page: 2, x: 184.212, y: 528.927, w: 20.720, h: 13.638 },
  { name: 'MENTIRA',       page: 2, x: 492.355, y: 511.111, w: 57.333, h: 13.577 },
  { name: 'MENTIRA 1',     page: 2, x: 460.871, y: 510.660, w: 20.501, h: 13.638 },
  { name: 'ATUALIDADES',   page: 2, x: 215.183, y: 509.075, w: 58.097, h: 14.012 },
  { name: 'ATUALIDADES 1', page: 2, x: 184.244, y: 508.297, w: 19.956, h: 14.292 },
  { name: 'PRECEPÇÃO 1',   page: 2, x: 460.776, y: 489.624, w: 20.283, h: 13.747 },
  { name: 'CIENCIAS 1',    page: 2, x: 184.356, y: 489.357, w: 20.338, h: 13.910 },
  { name: 'PRECEPÇÃO',     page: 2, x: 492.173, y: 489.047, w: 57.661, h: 15.102 },
  { name: 'CIENCIAS',      page: 2, x: 215.318, y: 488.936, w: 57.497, h: 14.340 },
  { name: 'PONTARIA 1',    page: 2, x: 461.744, y: 469.205, w: 18.975, h: 14.074 },
  { name: 'PONTARIA',      page: 2, x: 492.136, y: 468.893, w: 58.425, h: 14.230 },
  { name: 'CRIME 1',       page: 2, x: 184.409, y: 466.734, w: 19.683, h: 14.237 },
  { name: 'CRIME',         page: 2, x: 214.965, y: 466.366, w: 58.478, h: 14.176 },
  { name: 'PROFISSAO',     page: 2, x: 491.784, y: 449.374, w: 58.861, h: 13.357 },
  { name: 'PROFISSAO 1',   page: 2, x: 461.368, y: 448.641, w: 19.629, h: 14.511 },
  { name: 'CONDUCAO',      page: 2, x: 215.412, y: 446.271, w: 57.988, h: 13.848 },
  { name: 'CONDUÇAO 1',    page: 2, x: 184.613, y: 445.921, w: 19.358, h: 13.747 },
  { name: 'REFLEXOS 1',    page: 2, x: 461.634, y: 427.750, w: 18.975, h: 13.747 },
  { name: 'REFLEXOS',      page: 2, x: 492.245, y: 427.658, w: 57.879, h: 14.229 },
  { name: 'DIPLOMACIA 1',  page: 2, x: 185.308, y: 425.352, w: 18.210, h: 14.074 },
  { name: 'DIPLOMACIA',    page: 2, x: 215.373, y: 425.148, w: 57.988, h: 14.339 },
  { name: 'RELIGIÃO 1',    page: 2, x: 461.725, y: 407.679, w: 18.942, h: 14.074 },
  { name: 'RELIGIÃO',      page: 2, x: 492.330, y: 406.957, w: 57.660, h: 14.666 },
  { name: 'DOMISTICAÇÃO',  page: 2, x: 215.238, y: 406.296, w: 58.315, h: 13.684 },
  { name: 'DOMISTICAÇÃO 1',page: 2, x: 185.257, y: 405.781, w: 18.212, h: 13.419 },
  { name: 'SOBREVIVENCIA', page: 2, x: 492.573, y: 387.513, w: 57.988, h: 13.793 },
  { name: 'SOBREVIVENCIA 1',page: 2, x: 461.526, y: 387.389, w: 19.519, h: 13.856 },
  { name: 'FORTITUDE',     page: 2, x: 215.372, y: 384.567, w: 57.988, h: 13.684 },
  { name: 'FORTITUDE 1',   page: 2, x: 185.962, y: 384.115, w: 17.556, h: 14.728 },
  { name: 'TATICA',        page: 2, x: 492.344, y: 367.003, w: 58.098, h: 14.230 },
  { name: 'TATICA 1',      page: 2, x: 460.977, y: 366.852, w: 20.174, h: 14.510 },
  { name: 'FURTIVIDADE 1', page: 2, x: 185.632, y: 364.846, w: 17.883, h: 13.747 },
  { name: 'FURTIVIDADE',   page: 2, x: 214.957, y: 364.705, w: 57.989, h: 14.012 },
  { name: 'TECNOLOGIA 1',  page: 2, x: 460.762, y: 346.590, w: 19.848, h: 13.638 },
  { name: 'TECNOLOGIA',    page: 2, x: 492.355, y: 346.496, w: 58.097, h: 14.230 },
  { name: 'INICIATIVA 1',  page: 2, x: 185.635, y: 345.169, w: 17.883, h: 13.747 },
  { name: 'INICIATIVA',    page: 2, x: 215.373, y: 344.640, w: 57.988, h: 14.011 },
  { name: 'VONTADE',       page: 2, x: 492.251, y: 326.799, w: 57.987, h: 14.339 },
  { name: 'VONTADE 1',     page: 2, x: 460.337, y: 326.539, w: 20.720, h: 14.074 },
  { name: 'INTIMIDAÇÃO',   page: 2, x: 215.479, y: 325.210, w: 57.333, h: 14.011 },
  { name: 'INTIMIDAÇÃO 1', page: 2, x: 185.950, y: 325.015, w: 17.555, h: 13.746 },
  { name: 'INTUIÇÃO 1',    page: 2, x: 185.659, y: 304.167, w: 18.538, h: 13.746 },
  { name: 'INTUIÇÃO',      page: 2, x: 214.207, y: 304.035, w: 59.297, h: 14.011 },
  { name: 'PV',            page: 2, x: 211.395, y: 191.399, w: 56.599, h: 34.527 },
  { name: 'DESL',          page: 2, x: 422.761, y: 193.153, w: 107.250, h: 67.577 },
  { name: 'PV-ATUAL',      page: 2, x: 211.395, y: 225.926, w: 56.599, h: 34.527 },
  { name: 'PS',            page: 2, x: 211.268, y: 120.426, w: 56.726, h: 34.502 },
  { name: 'EX 1',          page: 2, x: 514.641, y: 125.620, w: 44.696, h: 67.174 },
  { name: 'EX',            page: 2, x: 369.775, y: 125.689, w: 52.857, h: 67.210 },
  { name: 'PS-ATUAL',      page: 2, x: 211.268, y: 154.928, w: 56.726, h: 36.453 },
  { name: 'PE',            page: 2, x: 211.268, y:  51.423, w: 56.726, h: 34.502 },
  { name: 'BLOQUEIO',      page: 2, x: 514.737, y:  51.418, w: 44.696, h: 73.878 },
  { name: 'PE-ATUAL',      page: 2, x: 211.268, y:  85.925, w: 56.726, h: 34.502 },
  { name: 'DEFESA',        page: 2, x: 369.871, y:  51.494, w: 52.857, h: 73.918 },
]

function scaleField(f) {
  const scaleY = f.page === 1 ? SY1 : SY
  return {
    name: f.name,
    widgetIndex: 0,
    page: f.page,
    x: Math.round(f.x * SX * 1000) / 1000,
    y: Math.round(f.y * scaleY * 1000) / 1000,
    width:  Math.round(f.w * SX * 1000) / 1000,
    height: Math.round(f.h * scaleY * 1000) / 1000,
  }
}

const scaledFields = rawFields.map(scaleField)

// Render page3RowBottoms array
const rowBottomsStr = newRowBottoms
  .map((v, i) => `  ${v}`)
  .join(',\n')

// Render attrTopFields
const attrTopStr = attrTopFields.map(f => `  {
    name: '${f.name}',
    widgetIndex: 0,
    page: 2,
    x: ${f.x},
    y: ${f.y},
    width: ${f.width},
    height: ${f.height},
  }`).join(',\n')

// Render scaledFields
const fieldsStr = scaledFields.map(f => `  {
    "name": "${f.name}",
    "widgetIndex": 0,
    "page": ${f.page},
    "x": ${f.x},
    "y": ${f.y},
    "width": ${f.width},
    "height": ${f.height}
  }`).join(',\n')

const output = `export type PdfSheetTemplateField = {
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

const page3Columns = {
  ability: {
    x: 92,
    width: 145,
  },
  value: {
    x: 237,
    width: 83,
  },
  description: {
    x: 320,
    width: 150,
  },
} as const

const page2AttributeTopFields: PdfSheetTemplateField[] = [
${attrTopStr}
] as const

const page3RowHeight = ${newRowHeight}

const page3RowBottoms = [
${rowBottomsStr}
] as const

function buildPage3Fields(): PdfSheetTemplateField[] {
  return page3RowBottoms.flatMap((y, index) => {
    const slot = index + 1
    const abilityName = slot === 1 ? 'HAB 1' : \`HAB\${slot}\`

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
        name: \`CUSTO\${slot}\`,
        widgetIndex: 0,
        page: 3,
        x: page3Columns.value.x,
        y,
        width: page3Columns.value.width,
        height: page3RowHeight,
      },
      {
        name: \`DESC\${slot}\`,
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

export const pdfSheetTemplateFields: PdfSheetTemplateField[] = [
${fieldsStr},
  ...page2AttributeTopFields,
  ...buildPage3Fields(),
]
`

writeFileSync('src/lib/pdfSheetTemplate.ts', output)
console.log('Done! src/lib/pdfSheetTemplate.ts updated.')
console.log(`SX=${SX.toFixed(6)}, SY1=${SY1.toFixed(6)}, SY=${SY.toFixed(6)}`)
console.log('page3RowBottoms:', newRowBottoms.join(', '))
console.log('page3RowHeight:', newRowHeight)
