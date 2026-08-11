import type { NetDistrict } from './netWorldTypes'

// “Eastern Industrial District” is canonical; older app copy may retain its aliases.
// Sector 07 and District 7 remain distinct until narrative lore confirms a relationship.
export const netDistricts = [
  { id: 'district-neon-row', displayName: 'Neon Row', aliases: [] },
  { id: 'district-04', displayName: 'District 04', aliases: ['DISTRICT 04', 'District04'] },
  { id: 'district-old-quarter', displayName: 'Old Quarter', aliases: [] },
  { id: 'district-blackwater', displayName: 'Blackwater', aliases: [] },
  { id: 'district-central', displayName: 'Central', aliases: [] },
  {
    id: 'district-eastern-industrial',
    displayName: 'Eastern Industrial District',
    aliases: ['Eastern Industrial', 'Industrial District'],
  },
  { id: 'district-chrome-docks', displayName: 'Chrome Docks', aliases: [] },
  { id: 'sector-07', displayName: 'Sector 07', aliases: [], type: 'sector' },
  { id: 'district-07', displayName: 'District 7', aliases: [] },
] as const satisfies readonly NetDistrict[]
