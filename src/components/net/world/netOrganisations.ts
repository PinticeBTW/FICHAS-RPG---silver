import type { NetOrganisation } from './netWorldTypes'

// New Vega Network is the parent company behind the NVN newsroom and VLT.
export const netOrganisations = [
  {
    id: 'org-netwatch',
    displayName: 'NetWatch',
    type: 'authority',
    aliases: [],
  },
  {
    id: 'org-lucid',
    displayName: 'Lucid Interactive',
    shortName: 'LUCID',
    type: 'corporation',
    aliases: ['Lucid'],
  },
  {
    id: 'org-vox-net',
    displayName: 'VOX NET',
    type: 'corporation',
    aliases: ['VoxNet'],
  },
  {
    id: 'org-nvn',
    displayName: 'New Vega Network',
    shortName: 'NVN',
    type: 'corporation',
    aliases: ['NVN', 'New Vega News'],
  },
  {
    id: 'org-nvps',
    displayName: 'New Vega Public Safety',
    shortName: 'NVPS',
    type: 'authority',
    aliases: ['NVPS'],
  },
] as const satisfies readonly NetOrganisation[]
