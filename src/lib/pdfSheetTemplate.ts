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
    "x": 254.619,
    "y": 695.127,
    "width": 84.437,
    "height": 85.091
  },
  {
    "name": "FORÇA",
    "widgetIndex": 0,
    "page": 2,
    "x": 360.002,
    "y": 693.818,
    "width": 84.436,
    "height": 85.091
  },
  {
    "name": "AGILIDADE",
    "widgetIndex": 0,
    "page": 2,
    "x": 42.546,
    "y": 693.163,
    "width": 84.436,
    "height": 85.091
  },
  {
    "name": "VIGOR",
    "widgetIndex": 0,
    "page": 2,
    "x": 148.583,
    "y": 693.163,
    "width": 84.436,
    "height": 85.091
  },
  {
    "name": "INTELIGENCIA",
    "widgetIndex": 0,
    "page": 2,
    "x": 467.348,
    "y": 693.163,
    "width": 84.436,
    "height": 85.091
  },
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
    "x": 210.656,
    "y": 225.488,
    "width": 56.946,
    "height": 34.691
  },
  {
    "name": "DESL",
    "widgetIndex": 0,
    "page": 2,
    "x": 465.209,
    "y": 193.153,
    "width": 93.861,
    "height": 66.764
  },
  {
    "name": "PV-ATUAL",
    "widgetIndex": 0,
    "page": 2,
    "x": 211.419,
    "y": 192.215,
    "width": 54.328,
    "height": 32.728
  },
  {
    "name": "PS",
    "widgetIndex": 0,
    "page": 2,
    "x": 211.691,
    "y": 156.161,
    "width": 57.165,
    "height": 32.945
  },
  {
    "name": "EX 1",
    "widgetIndex": 0,
    "page": 2,
    "x": 465.317,
    "y": 126.695,
    "width": 93.993,
    "height": 64.669
  },
  {
    "name": "EX",
    "widgetIndex": 0,
    "page": 2,
    "x": 328.757,
    "y": 126.084,
    "width": 99.23,
    "height": 66.109
  },
  {
    "name": "PS-ATUAL",
    "widgetIndex": 0,
    "page": 2,
    "x": 212.018,
    "y": 121.579,
    "width": 54.983,
    "height": 32.509
  },
  {
    "name": "PE",
    "widgetIndex": 0,
    "page": 2,
    "x": 212.128,
    "y": 87.651,
    "width": 54.328,
    "height": 32.073
  },
  {
    "name": "BLOQUEIO",
    "widgetIndex": 0,
    "page": 2,
    "x": 517.669,
    "y": 52.984,
    "width": 41.935,
    "height": 71.738
  },
  {
    "name": "PE-ATUAL",
    "widgetIndex": 0,
    "page": 2,
    "x": 212.455,
    "y": 52.851,
    "width": 54.545,
    "height": 32.727
  },
  {
    "name": "DEFESA",
    "widgetIndex": 0,
    "page": 2,
    "x": 369.855,
    "y": 52.638,
    "width": 52.338,
    "height": 71.642
  },
  {
    "name": "HAB 1",
    "widgetIndex": 0,
    "page": 3,
    "x": 19.782,
    "y": 639.463,
    "width": 206.179,
    "height": 43.507
  },
  {
    "name": "DESC1",
    "widgetIndex": 0,
    "page": 3,
    "x": 338.124,
    "y": 639.447,
    "width": 240.437,
    "height": 42.981
  },
  {
    "name": "CUSTO1",
    "widgetIndex": 0,
    "page": 3,
    "x": 227.28,
    "y": 639.251,
    "width": 109.343,
    "height": 42.811
  },
  {
    "name": "HAB2",
    "widgetIndex": 0,
    "page": 3,
    "x": 19.669,
    "y": 596.095,
    "width": 206.871,
    "height": 41.829
  },
  {
    "name": "CUSTO2",
    "widgetIndex": 0,
    "page": 3,
    "x": 227.051,
    "y": 595.332,
    "width": 110.325,
    "height": 43.139
  },
  {
    "name": "DESC2",
    "widgetIndex": 0,
    "page": 3,
    "x": 338.45,
    "y": 594.646,
    "width": 240.438,
    "height": 42.982
  },
  {
    "name": "CUSTO3",
    "widgetIndex": 0,
    "page": 3,
    "x": 226.888,
    "y": 553.605,
    "width": 109.997,
    "height": 40.52
  },
  {
    "name": "HAB3",
    "widgetIndex": 0,
    "page": 3,
    "x": 19.451,
    "y": 552.677,
    "width": 206.215,
    "height": 41.611
  },
  {
    "name": "DESC3",
    "widgetIndex": 0,
    "page": 3,
    "x": 337.577,
    "y": 552.537,
    "width": 240.438,
    "height": 41.672
  },
  {
    "name": "HAB4",
    "widgetIndex": 0,
    "page": 3,
    "x": 20.602,
    "y": 510.124,
    "width": 206.215,
    "height": 42.266
  },
  {
    "name": "DESC4",
    "widgetIndex": 0,
    "page": 3,
    "x": 338.619,
    "y": 510.094,
    "width": 240.438,
    "height": 41.672
  },
  {
    "name": "CUSTO4",
    "widgetIndex": 0,
    "page": 3,
    "x": 226.457,
    "y": 510.015,
    "width": 109.998,
    "height": 42.484
  },
  {
    "name": "DESC5",
    "widgetIndex": 0,
    "page": 3,
    "x": 338.619,
    "y": 466.894,
    "width": 239.129,
    "height": 41.672
  },
  {
    "name": "HAB5",
    "widgetIndex": 0,
    "page": 3,
    "x": 19.948,
    "y": 466.27,
    "width": 206.216,
    "height": 42.92
  },
  {
    "name": "CUSTO5",
    "widgetIndex": 0,
    "page": 3,
    "x": 227.112,
    "y": 465.833,
    "width": 109.997,
    "height": 42.484
  },
  {
    "name": "DESC6",
    "widgetIndex": 0,
    "page": 3,
    "x": 337.965,
    "y": 423.039,
    "width": 239.129,
    "height": 41.672
  },
  {
    "name": "CUSTO6",
    "widgetIndex": 0,
    "page": 3,
    "x": 227.112,
    "y": 421.979,
    "width": 109.997,
    "height": 42.483
  },
  {
    "name": "HAB6",
    "widgetIndex": 0,
    "page": 3,
    "x": 19.948,
    "y": 421.76,
    "width": 206.216,
    "height": 42.921
  },
  {
    "name": "DESC7",
    "widgetIndex": 0,
    "page": 3,
    "x": 338.619,
    "y": 381.802,
    "width": 239.129,
    "height": 41.673
  },
  {
    "name": "CUSTO7",
    "widgetIndex": 0,
    "page": 3,
    "x": 227.112,
    "y": 379.106,
    "width": 109.997,
    "height": 42.483
  },
  {
    "name": "HAB7",
    "widgetIndex": 0,
    "page": 3,
    "x": 20.275,
    "y": 378.887,
    "width": 206.215,
    "height": 42.921
  },
  {
    "name": "DESC8",
    "widgetIndex": 0,
    "page": 3,
    "x": 338.292,
    "y": 335.984,
    "width": 240.438,
    "height": 41.672
  },
  {
    "name": "CUSTO8",
    "widgetIndex": 0,
    "page": 3,
    "x": 227.112,
    "y": 335.251,
    "width": 109.997,
    "height": 42.484
  },
  {
    "name": "HAB8",
    "widgetIndex": 0,
    "page": 3,
    "x": 19.62,
    "y": 333.723,
    "width": 206.215,
    "height": 42.921
  },
  {
    "name": "DESC9",
    "widgetIndex": 0,
    "page": 3,
    "x": 339.601,
    "y": 290.82,
    "width": 239.129,
    "height": 41.672
  },
  {
    "name": "HAB9",
    "widgetIndex": 0,
    "page": 3,
    "x": 19.62,
    "y": 290.523,
    "width": 206.215,
    "height": 42.921
  },
  {
    "name": "CUSTO9",
    "widgetIndex": 0,
    "page": 3,
    "x": 227.112,
    "y": 290.251,
    "width": 109.997,
    "height": 42.483
  },
  {
    "name": "HAB10",
    "widgetIndex": 0,
    "page": 3,
    "x": 20.602,
    "y": 246.505,
    "width": 206.215,
    "height": 42.92
  },
  {
    "name": "CUSTO10",
    "widgetIndex": 0,
    "page": 3,
    "x": 227.766,
    "y": 245.741,
    "width": 109.998,
    "height": 42.484
  },
  {
    "name": "DESC10",
    "widgetIndex": 0,
    "page": 3,
    "x": 340.256,
    "y": 245.002,
    "width": 239.129,
    "height": 41.672
  },
  {
    "name": "CUSTO11",
    "widgetIndex": 0,
    "page": 3,
    "x": 228.421,
    "y": 202.214,
    "width": 109.997,
    "height": 42.484
  },
  {
    "name": "HAB11",
    "widgetIndex": 0,
    "page": 3,
    "x": 20.602,
    "y": 201.341,
    "width": 204.252,
    "height": 42.92
  },
  {
    "name": "DESC11",
    "widgetIndex": 0,
    "page": 3,
    "x": 338.947,
    "y": 201.147,
    "width": 239.129,
    "height": 41.672
  },
  {
    "name": "DESC12",
    "widgetIndex": 0,
    "page": 3,
    "x": 338.9,
    "y": 157.947,
    "width": 240.438,
    "height": 41.672
  },
  {
    "name": "HAB12",
    "widgetIndex": 0,
    "page": 3,
    "x": 20.929,
    "y": 157.814,
    "width": 204.906,
    "height": 42.92
  },
  {
    "name": "CUSTO12",
    "widgetIndex": 0,
    "page": 3,
    "x": 228.421,
    "y": 157.705,
    "width": 109.997,
    "height": 42.483
  },
  {
    "name": "DESC13",
    "widgetIndex": 0,
    "page": 3,
    "x": 338.9,
    "y": 112.783,
    "width": 239.129,
    "height": 41.672
  },
  {
    "name": "HAB13",
    "widgetIndex": 0,
    "page": 3,
    "x": 20.275,
    "y": 112.65,
    "width": 206.215,
    "height": 42.92
  },
  {
    "name": "CUSTO13",
    "widgetIndex": 0,
    "page": 3,
    "x": 227.766,
    "y": 111.886,
    "width": 109.998,
    "height": 42.484
  },
  {
    "name": "CUSTO14",
    "widgetIndex": 0,
    "page": 3,
    "x": 227.766,
    "y": 69.013,
    "width": 109.998,
    "height": 42.484
  },
  {
    "name": "DESC14",
    "widgetIndex": 0,
    "page": 3,
    "x": 338.246,
    "y": 67.619,
    "width": 239.129,
    "height": 41.672
  },
  {
    "name": "HAB14",
    "widgetIndex": 0,
    "page": 3,
    "x": 20.275,
    "y": 67.486,
    "width": 206.215,
    "height": 42.92
  },
  {
    "name": "CUSTO15",
    "widgetIndex": 0,
    "page": 3,
    "x": 227.766,
    "y": 25.159,
    "width": 109.998,
    "height": 42.484
  },
  {
    "name": "DESC15",
    "widgetIndex": 0,
    "page": 3,
    "x": 338.246,
    "y": 25.073,
    "width": 239.129,
    "height": 41.672
  },
  {
    "name": "HAB15",
    "widgetIndex": 0,
    "page": 3,
    "x": 20.602,
    "y": 24.449,
    "width": 206.215,
    "height": 42.92
  }
]
