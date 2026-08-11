import type { NetOrganisation } from './netWorldTypes'

// NVN is distinct from its newsroom, dispatch, and editorial accounts.
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
    type: 'publisher',
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
