export type EchoType = 'standard' | 'dead' | 'chain'
export type EchoIntensity = 'low' | 'medium' | 'high'

export interface EchoPost {
  id: string
  author: string
  handle: string
  location: string
  district: string
  time: string
  type: EchoType
  frequencies: string[]
  content: string
  resonance: number
  intensity: EchoIntensity
  nearby: boolean
  x: number
  y: number
  integrity?: number
  requiresEchoId?: string
}

export const echoPosts: EchoPost[] = [
  {
    id: 'echo-adrian',
    author: 'Adrian',
    handle: '@adrian',
    location: 'Neon Row — Rooftop 31',
    district: 'NEON ROW',
    time: '03:14',
    type: 'standard',
    frequencies: ['Night', 'Static', 'Underground'],
    content: 'the city looks almost innocent from up here.',
    resonance: 4200,
    intensity: 'high',
    nearby: true,
    x: 22,
    y: 30,
  },
  {
    id: 'echo-unknown',
    author: 'Unknown',
    handle: 'deleted_user',
    location: 'District 11',
    district: 'DISTRICT 11',
    time: '--:--',
    type: 'dead',
    frequencies: ['Static', 'Warning'],
    content: "...don't let NetWatch fin—",
    resonance: 61,
    intensity: 'medium',
    nearby: false,
    x: 68,
    y: 22,
    integrity: 61,
  },
  {
    id: 'echo-maya',
    author: 'Maya',
    handle: '@maya',
    location: 'Old Quarter — Platform 06',
    district: 'OLD QUARTER',
    time: '21:47',
    type: 'standard',
    frequencies: ['Memory', 'Lost', 'Night'],
    content: 'I left this here in case you ever came back.',
    resonance: 1860,
    intensity: 'medium',
    nearby: true,
    x: 40,
    y: 68,
  },
  {
    id: 'echo-locked',
    author: 'Unknown Origin',
    handle: '???',
    location: 'Signal Relay 7',
    district: 'SIGNAL RELAY',
    time: '--:--',
    type: 'chain',
    frequencies: ['Locked'],
    content: '[ENCRYPTED — REQUIRES LINKED ECHO]',
    resonance: 0,
    intensity: 'low',
    nearby: false,
    x: 78,
    y: 60,
    requiresEchoId: 'echo-adrian',
  },
  {
    id: 'echo-kenji',
    author: 'Kenji',
    handle: '@kenji_v',
    location: 'District 04 — Undercroft',
    district: 'DISTRICT 04',
    time: '19:02',
    type: 'standard',
    frequencies: ['Trade', 'Underground'],
    content: 'if it isn’t on the grid, it isn’t taxed. ask for the Undercroft rate.',
    resonance: 890,
    intensity: 'low',
    nearby: false,
    x: 15,
    y: 72,
  },
  {
    id: 'echo-sable',
    author: 'Sable',
    handle: '@sable',
    location: 'Chrome Docks',
    district: 'CHROME DOCKS',
    time: '00:38',
    type: 'standard',
    frequencies: ['Warning', 'NetWatch'],
    content: "selling something you can't buy back. last warning.",
    resonance: 2310,
    intensity: 'high',
    nearby: true,
    x: 60,
    y: 40,
  },
]

export const echoFrequencies = Array.from(
  new Set(echoPosts.flatMap((post) => post.frequencies)),
).sort()
