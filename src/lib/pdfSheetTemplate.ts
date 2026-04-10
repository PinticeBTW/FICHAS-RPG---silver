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
    "width": 594.56,
    "height": 846.275
  },
  {
    "page": 2,
    "width": 594.56,
    "height": 847.404
  },
  {
    "page": 3,
    "width": 594.56,
    "height": 847.404
  },
  {
    "page": 4,
    "width": 594.56,
    "height": 847.404
  }
] as const

const page3Columns = {
  ability: {
    x: 101.769,
    width: 176.939,
  },
  value: {
    x: 278.709,
    width: 73.493,
  },
  description: {
    x: 352.45,
    width: 226.626,
  },
} as const

const page2AttributeTopFields: PdfSheetTemplateField[] = [
  {
    name: 'AGILIDADE-TOP',
    widgetIndex: 0,
    page: 2,
    x: 70.92,
    y: 790.476,
    width: 30,
    height: 18,
  },
  {
    name: 'VIGOR-TOP',
    widgetIndex: 0,
    page: 2,
    x: 177.114,
    y: 790.835,
    width: 30,
    height: 18,
  },
  {
    name: 'PRESENCA-TOP',
    widgetIndex: 0,
    page: 2,
    x: 282.467,
    y: 790.835,
    width: 30,
    height: 18,
  },
  {
    name: 'FORCA-TOP',
    widgetIndex: 0,
    page: 2,
    x: 388.879,
    y: 790.817,
    width: 30,
    height: 18,
  },
  {
    name: 'INTELIGENCIA-TOP',
    widgetIndex: 0,
    page: 2,
    x: 496.173,
    y: 790.429,
    width: 30,
    height: 18,
  },
] as const

const page3RowHeight = 30.659

const page3RowBottoms = [
  726.806,
  696.148,
  665.409,
  635.579,
  604.92,
  574.181,
  543.367,
  513.538,
  482.879,
  452.14,
  421.505,
  328.511,
  297.852,
  267.113,
  237.284,
  206.625,
  175.886,
  145.072,
  115.242,
  84.584,
  53.845,
  23.21,
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

export const pdfSheetTemplateFields: PdfSheetTemplateField[] = [
  {
    "name": "CIDADE",
    "widgetIndex": 0,
    "page": 1,
    "x": 19.047,
    "y": 753.329,
    "width": 424.017,
    "height": 68.073
  },
  {
    "name": "NOME",
    "widgetIndex": 0,
    "page": 1,
    "x": 381.733,
    "y": 662.137,
    "width": 193.615,
    "height": 21.6
  },
  {
    "name": "IDADE",
    "widgetIndex": 0,
    "page": 1,
    "x": 381.339,
    "y": 637.919,
    "width": 193.354,
    "height": 21.6
  },
  {
    "name": "ALTURA",
    "widgetIndex": 0,
    "page": 1,
    "x": 397.049,
    "y": 611.868,
    "width": 177.382,
    "height": 21.6
  },
  {
    "name": "SEXO",
    "widgetIndex": 0,
    "page": 1,
    "x": 373.747,
    "y": 586.734,
    "width": 201.601,
    "height": 21.6
  },
  {
    "name": "NACIONALIDADE",
    "widgetIndex": 0,
    "page": 1,
    "x": 458.31,
    "y": 560.29,
    "width": 116.641,
    "height": 21.599
  },
  {
    "name": "TIPOLOGIA",
    "widgetIndex": 0,
    "page": 1,
    "x": 413.412,
    "y": 534.762,
    "width": 160.759,
    "height": 21.6
  },
  {
    "name": "OCUPAÇÃO",
    "widgetIndex": 0,
    "page": 1,
    "x": 417.602,
    "y": 508.352,
    "width": 158.27,
    "height": 21.6
  },
  {
    "name": "ATAQUES1",
    "widgetIndex": 0,
    "page": 1,
    "x": 20.318,
    "y": 424.42,
    "width": 152.629,
    "height": 24.873
  },
  {
    "name": "TESTE1",
    "widgetIndex": 0,
    "page": 1,
    "x": 174.594,
    "y": 424.288,
    "width": 96.121,
    "height": 25.308
  },
  {
    "name": "DANO1",
    "widgetIndex": 0,
    "page": 1,
    "x": 272.667,
    "y": 423.415,
    "width": 114.448,
    "height": 26.182
  },
  {
    "name": "ATAQUES2",
    "widgetIndex": 0,
    "page": 1,
    "x": 19.903,
    "y": 397.912,
    "width": 152.63,
    "height": 24.873
  },
  {
    "name": "TESTE2",
    "widgetIndex": 0,
    "page": 1,
    "x": 174.266,
    "y": 397.258,
    "width": 96.121,
    "height": 25.309
  },
  {
    "name": "DANO2",
    "widgetIndex": 0,
    "page": 1,
    "x": 272.448,
    "y": 397.258,
    "width": 114.448,
    "height": 26.182
  },
  {
    "name": "ATAQUES3",
    "widgetIndex": 0,
    "page": 1,
    "x": 20.339,
    "y": 371.73,
    "width": 152.63,
    "height": 24.873
  },
  {
    "name": "TESTE3",
    "widgetIndex": 0,
    "page": 1,
    "x": 174.43,
    "y": 371.5,
    "width": 96.121,
    "height": 25.309
  },
  {
    "name": "DANO3",
    "widgetIndex": 0,
    "page": 1,
    "x": 272.121,
    "y": 371.064,
    "width": 114.448,
    "height": 26.182
  },
  {
    "name": "TESTE4",
    "widgetIndex": 0,
    "page": 1,
    "x": 174.539,
    "y": 346.216,
    "width": 96.121,
    "height": 25.308
  },
  {
    "name": "ATAQUES4",
    "widgetIndex": 0,
    "page": 1,
    "x": 20.536,
    "y": 346.148,
    "width": 152.63,
    "height": 24.873
  },
  {
    "name": "DANO4",
    "widgetIndex": 0,
    "page": 1,
    "x": 271.902,
    "y": 344.906,
    "width": 114.448,
    "height": 26.182
  },
  {
    "name": "TESTE5",
    "widgetIndex": 0,
    "page": 1,
    "x": 174.949,
    "y": 320.222,
    "width": 96.121,
    "height": 25.308
  },
  {
    "name": "DANO5",
    "widgetIndex": 0,
    "page": 1,
    "x": 272.394,
    "y": 320.003,
    "width": 114.448,
    "height": 25.31
  },
  {
    "name": "ATAQUES5",
    "widgetIndex": 0,
    "page": 1,
    "x": 20.558,
    "y": 319.64,
    "width": 152.629,
    "height": 24.873
  },
  {
    "name": "KARMA",
    "widgetIndex": 0,
    "page": 1,
    "x": 415.639,
    "y": 294.936,
    "width": 142.691,
    "height": 30.11
  },
  {
    "name": "DANO6",
    "widgetIndex": 0,
    "page": 1,
    "x": 272.175,
    "y": 294.718,
    "width": 114.448,
    "height": 24.437
  },
  {
    "name": "TESTE6",
    "widgetIndex": 0,
    "page": 1,
    "x": 174.621,
    "y": 294.501,
    "width": 96.121,
    "height": 25.308
  },
  {
    "name": "ATAQUES6",
    "widgetIndex": 0,
    "page": 1,
    "x": 20.558,
    "y": 293.458,
    "width": 152.63,
    "height": 24.873
  },
  {
    "name": "DANO7",
    "widgetIndex": 0,
    "page": 1,
    "x": 271.848,
    "y": 269.397,
    "width": 114.448,
    "height": 23.128
  },
  {
    "name": "TESTE7",
    "widgetIndex": 0,
    "page": 1,
    "x": 173.912,
    "y": 268.743,
    "width": 96.121,
    "height": 25.309
  },
  {
    "name": "ATAQUES7",
    "widgetIndex": 0,
    "page": 1,
    "x": 19.99,
    "y": 267.903,
    "width": 152.63,
    "height": 24.873
  },
  {
    "name": "DANO8",
    "widgetIndex": 0,
    "page": 1,
    "x": 271.629,
    "y": 242.803,
    "width": 114.448,
    "height": 24.001
  },
  {
    "name": "TESTE8",
    "widgetIndex": 0,
    "page": 1,
    "x": 174.457,
    "y": 242.586,
    "width": 96.121,
    "height": 23.999
  },
  {
    "name": "ATAQUES8",
    "widgetIndex": 0,
    "page": 1,
    "x": 19.576,
    "y": 241.395,
    "width": 152.63,
    "height": 24.873
  },
  {
    "name": "INV 1",
    "widgetIndex": 0,
    "page": 1,
    "x": 387.987,
    "y": 238.252,
    "width": 113.616,
    "height": 18.764
  },
  {
    "name": "ESP1",
    "widgetIndex": 0,
    "page": 1,
    "x": 502.912,
    "y": 237.086,
    "width": 74.617,
    "height": 20.289
  },
  {
    "name": "DANO9",
    "widgetIndex": 0,
    "page": 1,
    "x": 272.831,
    "y": 217.458,
    "width": 114.448,
    "height": 22.691
  },
  {
    "name": "ESP2",
    "widgetIndex": 0,
    "page": 1,
    "x": 503.564,
    "y": 216.687,
    "width": 73.746,
    "height": 19.419
  },
  {
    "name": "TESTE9",
    "widgetIndex": 0,
    "page": 1,
    "x": 174.803,
    "y": 216.513,
    "width": 96.121,
    "height": 24.872
  },
  {
    "name": "INV 2",
    "widgetIndex": 0,
    "page": 1,
    "x": 388.518,
    "y": 216.128,
    "width": 112.321,
    "height": 20.597
  },
  {
    "name": "ATAQUES9",
    "widgetIndex": 0,
    "page": 1,
    "x": 20.012,
    "y": 215.213,
    "width": 152.63,
    "height": 24.873
  },
  {
    "name": "INV 3",
    "widgetIndex": 0,
    "page": 1,
    "x": 387.558,
    "y": 196.23,
    "width": 113.368,
    "height": 18.982
  },
  {
    "name": "ESP3",
    "widgetIndex": 0,
    "page": 1,
    "x": 503.477,
    "y": 195.088,
    "width": 74.269,
    "height": 20.813
  },
  {
    "name": "DANO10",
    "widgetIndex": 0,
    "page": 1,
    "x": 272.611,
    "y": 190.864,
    "width": 114.448,
    "height": 23.128
  },
  {
    "name": "ATAQUES10",
    "widgetIndex": 0,
    "page": 1,
    "x": 20.209,
    "y": 189.631,
    "width": 152.63,
    "height": 24.873
  },
  {
    "name": "TESTE10",
    "widgetIndex": 0,
    "page": 1,
    "x": 174.475,
    "y": 189.046,
    "width": 96.121,
    "height": 25.309
  },
  {
    "name": "INV 4",
    "widgetIndex": 0,
    "page": 1,
    "x": 388.125,
    "y": 175.852,
    "width": 112.713,
    "height": 18.72
  },
  {
    "name": "ESP4",
    "widgetIndex": 0,
    "page": 1,
    "x": 503.128,
    "y": 175.669,
    "width": 73.746,
    "height": 18.763
  },
  {
    "name": "DANO11",
    "widgetIndex": 0,
    "page": 1,
    "x": 272.721,
    "y": 160.83,
    "width": 114.448,
    "height": 27.23
  },
  {
    "name": "TESTE11",
    "widgetIndex": 0,
    "page": 1,
    "x": 174.203,
    "y": 160.671,
    "width": 97.43,
    "height": 27.49
  },
  {
    "name": "ATAQUES11",
    "widgetIndex": 0,
    "page": 1,
    "x": 20.23,
    "y": 158.759,
    "width": 152.63,
    "height": 30.546
  },
  {
    "name": "ESP5",
    "widgetIndex": 0,
    "page": 1,
    "x": 503.128,
    "y": 153.851,
    "width": 73.746,
    "height": 19.418
  },
  {
    "name": "INV 5",
    "widgetIndex": 0,
    "page": 1,
    "x": 387.863,
    "y": 153.815,
    "width": 113.849,
    "height": 19.637
  },
  {
    "name": "ESP6",
    "widgetIndex": 0,
    "page": 1,
    "x": 503.564,
    "y": 132.849,
    "width": 73.746,
    "height": 19.418
  },
  {
    "name": "INV 6",
    "widgetIndex": 0,
    "page": 1,
    "x": 388.256,
    "y": 132.39,
    "width": 114.546,
    "height": 20.291
  },
  {
    "name": "DANO12",
    "widgetIndex": 0,
    "page": 1,
    "x": 272.938,
    "y": 129.785,
    "width": 114.448,
    "height": 27.928
  },
  {
    "name": "ATAQUES12",
    "widgetIndex": 0,
    "page": 1,
    "x": 20.667,
    "y": 129.522,
    "width": 152.63,
    "height": 28.801
  },
  {
    "name": "TESTE12",
    "widgetIndex": 0,
    "page": 1,
    "x": 173.875,
    "y": 128.841,
    "width": 97.866,
    "height": 29.672
  },
  {
    "name": "INV 7",
    "widgetIndex": 0,
    "page": 1,
    "x": 388.169,
    "y": 112.416,
    "width": 113.499,
    "height": 19.418
  },
  {
    "name": "ESP7",
    "widgetIndex": 0,
    "page": 1,
    "x": 503.564,
    "y": 111.523,
    "width": 73.746,
    "height": 19.418
  },
  {
    "name": "TESTE13",
    "widgetIndex": 0,
    "page": 1,
    "x": 173.83,
    "y": 99.659,
    "width": 97.866,
    "height": 27.926
  },
  {
    "name": "ATAQUES13",
    "widgetIndex": 0,
    "page": 1,
    "x": 20.339,
    "y": 99.222,
    "width": 152.63,
    "height": 28.8
  },
  {
    "name": "DANO13",
    "widgetIndex": 0,
    "page": 1,
    "x": 272.448,
    "y": 98.786,
    "width": 115.321,
    "height": 28.364
  },
  {
    "name": "ESP8",
    "widgetIndex": 0,
    "page": 1,
    "x": 503.128,
    "y": 91.342,
    "width": 73.746,
    "height": 19.418
  },
  {
    "name": "INV 8",
    "widgetIndex": 0,
    "page": 1,
    "x": 387.863,
    "y": 91.165,
    "width": 113.368,
    "height": 19.418
  },
  {
    "name": "INV 9",
    "widgetIndex": 0,
    "page": 1,
    "x": 388.038,
    "y": 70.612,
    "width": 112.364,
    "height": 18.545
  },
  {
    "name": "ESP9",
    "widgetIndex": 0,
    "page": 1,
    "x": 503.564,
    "y": 69.742,
    "width": 73.746,
    "height": 19.418
  },
  {
    "name": "ESP10",
    "widgetIndex": 0,
    "page": 1,
    "x": 503.128,
    "y": 48.36,
    "width": 73.746,
    "height": 19.418
  },
  {
    "name": "INV 10",
    "widgetIndex": 0,
    "page": 1,
    "x": 387.82,
    "y": 47.267,
    "width": 113.455,
    "height": 21.163
  },
  {
    "name": "INV 11",
    "widgetIndex": 0,
    "page": 1,
    "x": 387.82,
    "y": 24.794,
    "width": 113.237,
    "height": 21.599
  },
  {
    "name": "CYBERPHYSHOSIS",
    "widgetIndex": 0,
    "page": 1,
    "x": 288.609,
    "y": 24.322,
    "width": 98.27,
    "height": 64.625
  },
  {
    "name": "ESP11",
    "widgetIndex": 0,
    "page": 1,
    "x": 502.473,
    "y": 24.142,
    "width": 74.619,
    "height": 22.472
  },
  {
    "name": "PRESENÇA",
    "widgetIndex": 0,
    "page": 2,
    "x": 253.01,
    "y": 695.016,
    "width": 88.257,
    "height": 88.936
  },
  {
    "name": "FORÇA",
    "widgetIndex": 0,
    "page": 2,
    "x": 359.432,
    "y": 695.016,
    "width": 88.257,
    "height": 88.936
  },
  {
    "name": "AGILIDADE",
    "widgetIndex": 0,
    "page": 2,
    "x": 41.313,
    "y": 694.676,
    "width": 88.257,
    "height": 88.936
  },
  {
    "name": "VIGOR",
    "widgetIndex": 0,
    "page": 2,
    "x": 147.443,
    "y": 695.016,
    "width": 88.257,
    "height": 88.936
  },
  {
    "name": "INTELIGENCIA",
    "widgetIndex": 0,
    "page": 2,
    "x": 466.471,
    "y": 694.624,
    "width": 88.257,
    "height": 88.936
  },
  ...page2AttributeTopFields,
  {
    "name": "INVESTIGAÇÃO",
    "widgetIndex": 0,
    "page": 2,
    "x": 492.675,
    "y": 571.985,
    "width": 57.508,
    "height": 14.256
  },
  {
    "name": "ACROBACIA",
    "widgetIndex": 0,
    "page": 2,
    "x": 215.013,
    "y": 571.893,
    "width": 58.315,
    "height": 13.521
  },
  {
    "name": "INVESTIGAÇÃO 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 461.387,
    "y": 571.745,
    "width": 19.847,
    "height": 13.419
  },
  {
    "name": "ACROBACIA 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 184.292,
    "y": 571.606,
    "width": 21.812,
    "height": 13.746
  },
  {
    "name": "LUTA 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 460.872,
    "y": 551.787,
    "width": 20.283,
    "height": 13.42
  },
  {
    "name": "LUTA",
    "widgetIndex": 0,
    "page": 2,
    "x": 492.311,
    "y": 551.344,
    "width": 57.66,
    "height": 14.404
  },
  {
    "name": "ARTES",
    "widgetIndex": 0,
    "page": 2,
    "x": 214.964,
    "y": 550.748,
    "width": 58.424,
    "height": 13.794
  },
  {
    "name": "ARTES 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 184.244,
    "y": 550.624,
    "width": 21.484,
    "height": 13.856
  },
  {
    "name": "MEDICINA",
    "widgetIndex": 0,
    "page": 2,
    "x": 492.344,
    "y": 531.836,
    "width": 58.207,
    "height": 14.012
  },
  {
    "name": "MEDICINA 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 460.837,
    "y": 530.45,
    "width": 20.611,
    "height": 14.947
  },
  {
    "name": "ATLETISMO",
    "widgetIndex": 0,
    "page": 2,
    "x": 215.266,
    "y": 529.441,
    "width": 58.424,
    "height": 14.012
  },
  {
    "name": "ATLETISMO 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 184.212,
    "y": 528.927,
    "width": 20.72,
    "height": 13.638
  },
  {
    "name": "MENTIRA",
    "widgetIndex": 0,
    "page": 2,
    "x": 492.355,
    "y": 511.111,
    "width": 57.333,
    "height": 13.577
  },
  {
    "name": "MENTIRA 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 460.871,
    "y": 510.66,
    "width": 20.501,
    "height": 13.638
  },
  {
    "name": "ATUALIDADES",
    "widgetIndex": 0,
    "page": 2,
    "x": 215.183,
    "y": 509.075,
    "width": 58.097,
    "height": 14.012
  },
  {
    "name": "ATUALIDADES 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 184.244,
    "y": 508.297,
    "width": 19.956,
    "height": 14.292
  },
  {
    "name": "PRECEPÇÃO 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 460.776,
    "y": 489.624,
    "width": 20.283,
    "height": 13.747
  },
  {
    "name": "CIENCIAS 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 184.356,
    "y": 489.357,
    "width": 20.338,
    "height": 13.91
  },
  {
    "name": "PRECEPÇÃO",
    "widgetIndex": 0,
    "page": 2,
    "x": 492.173,
    "y": 489.047,
    "width": 57.661,
    "height": 15.102
  },
  {
    "name": "CIENCIAS",
    "widgetIndex": 0,
    "page": 2,
    "x": 215.318,
    "y": 488.936,
    "width": 57.497,
    "height": 14.34
  },
  {
    "name": "PONTARIA 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 461.744,
    "y": 469.205,
    "width": 18.975,
    "height": 14.074
  },
  {
    "name": "PONTARIA",
    "widgetIndex": 0,
    "page": 2,
    "x": 492.136,
    "y": 468.893,
    "width": 58.425,
    "height": 14.23
  },
  {
    "name": "CRIME 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 184.409,
    "y": 466.734,
    "width": 19.683,
    "height": 14.237
  },
  {
    "name": "CRIME",
    "widgetIndex": 0,
    "page": 2,
    "x": 214.965,
    "y": 466.366,
    "width": 58.478,
    "height": 14.176
  },
  {
    "name": "PROFISSAO",
    "widgetIndex": 0,
    "page": 2,
    "x": 491.784,
    "y": 449.374,
    "width": 58.861,
    "height": 13.357
  },
  {
    "name": "PROFISSAO 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 461.368,
    "y": 448.641,
    "width": 19.629,
    "height": 14.511
  },
  {
    "name": "CONDUCAO",
    "widgetIndex": 0,
    "page": 2,
    "x": 215.412,
    "y": 446.271,
    "width": 57.988,
    "height": 13.848
  },
  {
    "name": "CONDUÇAO 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 184.613,
    "y": 445.921,
    "width": 19.358,
    "height": 13.747
  },
  {
    "name": "REFLEXOS 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 461.634,
    "y": 427.75,
    "width": 18.975,
    "height": 13.747
  },
  {
    "name": "REFLEXOS",
    "widgetIndex": 0,
    "page": 2,
    "x": 492.245,
    "y": 427.658,
    "width": 57.879,
    "height": 14.229
  },
  {
    "name": "DIPLOMACIA 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 185.308,
    "y": 425.352,
    "width": 18.21,
    "height": 14.074
  },
  {
    "name": "DIPLOMACIA",
    "widgetIndex": 0,
    "page": 2,
    "x": 215.373,
    "y": 425.148,
    "width": 57.988,
    "height": 14.339
  },
  {
    "name": "RELIGIÃO 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 461.725,
    "y": 407.679,
    "width": 18.942,
    "height": 14.074
  },
  {
    "name": "RELIGIÃO",
    "widgetIndex": 0,
    "page": 2,
    "x": 492.33,
    "y": 406.957,
    "width": 57.66,
    "height": 14.666
  },
  {
    "name": "DOMISTICAÇÃO",
    "widgetIndex": 0,
    "page": 2,
    "x": 215.238,
    "y": 406.296,
    "width": 58.315,
    "height": 13.684
  },
  {
    "name": "DOMISTICAÇÃO 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 185.257,
    "y": 405.781,
    "width": 18.212,
    "height": 13.419
  },
  {
    "name": "SOBREVIVENCIA",
    "widgetIndex": 0,
    "page": 2,
    "x": 492.573,
    "y": 387.513,
    "width": 57.988,
    "height": 13.793
  },
  {
    "name": "SOBREVIVENCIA 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 461.526,
    "y": 387.389,
    "width": 19.519,
    "height": 13.856
  },
  {
    "name": "FORTITUDE",
    "widgetIndex": 0,
    "page": 2,
    "x": 215.372,
    "y": 384.567,
    "width": 57.988,
    "height": 13.684
  },
  {
    "name": "FORTITUDE 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 185.962,
    "y": 384.115,
    "width": 17.556,
    "height": 14.728
  },
  {
    "name": "TATICA",
    "widgetIndex": 0,
    "page": 2,
    "x": 492.344,
    "y": 367.003,
    "width": 58.098,
    "height": 14.23
  },
  {
    "name": "TATICA 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 460.977,
    "y": 366.852,
    "width": 20.174,
    "height": 14.51
  },
  {
    "name": "FURTIVIDADE 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 185.632,
    "y": 364.846,
    "width": 17.883,
    "height": 13.747
  },
  {
    "name": "FURTIVIDADE",
    "widgetIndex": 0,
    "page": 2,
    "x": 214.957,
    "y": 364.705,
    "width": 57.989,
    "height": 14.012
  },
  {
    "name": "TECNOLOGIA 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 460.762,
    "y": 346.59,
    "width": 19.848,
    "height": 13.638
  },
  {
    "name": "TECNOLOGIA",
    "widgetIndex": 0,
    "page": 2,
    "x": 492.355,
    "y": 346.496,
    "width": 58.097,
    "height": 14.23
  },
  {
    "name": "INICIATIVA 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 185.635,
    "y": 345.169,
    "width": 17.883,
    "height": 13.747
  },
  {
    "name": "INICIATIVA",
    "widgetIndex": 0,
    "page": 2,
    "x": 215.373,
    "y": 344.64,
    "width": 57.988,
    "height": 14.011
  },
  {
    "name": "VONTADE",
    "widgetIndex": 0,
    "page": 2,
    "x": 492.251,
    "y": 326.799,
    "width": 57.987,
    "height": 14.339
  },
  {
    "name": "VONTADE 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 460.337,
    "y": 326.539,
    "width": 20.72,
    "height": 14.074
  },
  {
    "name": "INTIMIDAÇÃO",
    "widgetIndex": 0,
    "page": 2,
    "x": 215.479,
    "y": 325.21,
    "width": 57.333,
    "height": 14.011
  },
  {
    "name": "INTIMIDAÇÃO 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 185.95,
    "y": 325.015,
    "width": 17.555,
    "height": 13.746
  },
  {
    "name": "INTUIÇÃO 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 185.659,
    "y": 304.167,
    "width": 18.538,
    "height": 13.746
  },
  {
    "name": "INTUIÇÃO",
    "widgetIndex": 0,
    "page": 2,
    "x": 214.207,
    "y": 304.035,
    "width": 59.297,
    "height": 14.011
  },
  {
    "name": "PV",
    "widgetIndex": 0,
    "page": 2,
    "x": 211.395,
    "y": 191.399,
    "width": 56.599,
    "height": 34.527
  },
  {
    "name": "DESL",
    "widgetIndex": 0,
    "page": 2,
    "x": 422.761,
    "y": 193.153,
    "width": 107.25,
    "height": 67.577
  },
  {
    "name": "PV-ATUAL",
    "widgetIndex": 0,
    "page": 2,
    "x": 211.395,
    "y": 225.926,
    "width": 56.599,
    "height": 34.527
  },
  {
    "name": "PS",
    "widgetIndex": 0,
    "page": 2,
    "x": 211.268,
    "y": 120.426,
    "width": 56.726,
    "height": 34.502
  },
  {
    "name": "EX 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 514.641,
    "y": 125.62,
    "width": 44.696,
    "height": 67.174
  },
  {
    "name": "EX",
    "widgetIndex": 0,
    "page": 2,
    "x": 369.775,
    "y": 125.689,
    "width": 52.857,
    "height": 67.21
  },
  {
    "name": "PS-ATUAL",
    "widgetIndex": 0,
    "page": 2,
    "x": 211.268,
    "y": 154.928,
    "width": 56.726,
    "height": 36.453
  },
  {
    "name": "PE",
    "widgetIndex": 0,
    "page": 2,
    "x": 211.268,
    "y": 51.423,
    "width": 56.726,
    "height": 34.502
  },
  {
    "name": "BLOQUEIO",
    "widgetIndex": 0,
    "page": 2,
    "x": 514.737,
    "y": 51.418,
    "width": 44.696,
    "height": 73.878
  },
  {
    "name": "PE-ATUAL",
    "widgetIndex": 0,
    "page": 2,
    "x": 211.268,
    "y": 85.925,
    "width": 56.726,
    "height": 34.502
  },
  {
    "name": "DEFESA",
    "widgetIndex": 0,
    "page": 2,
    "x": 369.871,
    "y": 51.494,
    "width": 52.857,
    "height": 73.918
  },
  ...buildPage3Fields(),
]
