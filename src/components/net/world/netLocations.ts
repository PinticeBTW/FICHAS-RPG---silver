import type { NetLocation } from './netWorldTypes'

export const netLocations = [
  {
    id: 'location-rooftop-31',
    displayName: 'Rooftop 31',
    districtId: 'district-neon-row',
    aliases: [],
    type: 'rooftop',
  },
  {
    id: 'location-old-quarter-platform-06',
    displayName: 'Platform 06',
    districtId: 'district-old-quarter',
    aliases: ['Old Quarter — Platform 06'],
    type: 'transit-platform',
  },
  {
    id: 'location-eastern-industrial-rail-spur-3',
    displayName: 'Rail Spur 3',
    districtId: 'district-eastern-industrial',
    aliases: [],
    type: 'rail-spur',
  },
] as const satisfies readonly NetLocation[]
