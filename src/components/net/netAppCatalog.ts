import {
  Activity,
  Fingerprint,
  Newspaper,
  Store,
  Video,
  Waves,
  type LucideIcon,
} from 'lucide-react'

import type { NetWindowConstraints } from './netWindowGeometry'

export type NetAppId =
  | 'echo'
  | 'pulse'
  | 'iden'
  | 'nvn'
  | 'net-store'
  | 'loop'

export type NetRunnableAppId = Exclude<NetAppId, 'loop'>
export type NetOptionalAppId = 'echo' | 'pulse' | 'nvn'
export type NetCatalogueStatus = 'available' | 'coming-soon'
export type NetAppAccessMode = 'player' | 'gm-system'
export type NetGmSystemEntryPoint = 'signal-control' | 'newsroom-control' | 'reader'

export interface NetGmSystemAccessDefinition {
  readonly entryPoint: NetGmSystemEntryPoint
  readonly statusLabel: string
  readonly actionLabel: string
  readonly description: string
  readonly onlineNotice: string
}

export type NetAppWindowDefaults = NetWindowConstraints & {
  width: number
  height: number
}

export interface NetAppDefinition {
  id: NetAppId
  name: string
  owner: string
  category: string
  description: string
  shortDescription: string
  searchAliases: readonly string[]
  accentRgb: string
  icon: LucideIcon
  systemApp: boolean
  removable: boolean
  available: boolean
  catalogueStatus: NetCatalogueStatus
  version: string
  installSize: string
  features: readonly string[]
  defaultWindow: NetAppWindowDefaults
  featured?: boolean
  subtitle?: string
  onlineNotice?: string
  unreadBadge?: number
  /** Explicit shell access to a dedicated GM/system surface; never player authority. */
  gmSystemAccess?: NetGmSystemAccessDefinition
}

export const netAppCatalog: readonly NetAppDefinition[] = [
  {
    id: 'echo',
    name: 'ECHO',
    owner: 'LUCID INTERACTIVE',
    category: 'SOCIAL',
    description: 'A contextual social layer for nearby signals, public moments, and Resonance across New Vega.',
    shortDescription: 'Contextual social network',
    searchAliases: ['social', 'resonance', 'nearby', 'lucid'],
    accentRgb: '178, 111, 255',
    icon: Waves,
    systemApp: false,
    removable: true,
    available: true,
    catalogueStatus: 'available',
    version: '4.8.1',
    installSize: '248 MB',
    features: ['Nearby Resonance', 'Public echoes', 'Spatial context'],
    defaultWindow: { width: 1040, height: 680, minWidth: 560, minHeight: 420 },
    featured: true,
    subtitle: 'LUCID // RESONANCE LAYER',
    onlineNotice: 'ECHO // RESONANCE LAYER ONLINE',
    gmSystemAccess: {
      entryPoint: 'signal-control',
      statusLabel: 'GM Control',
      actionLabel: 'Open Signal Control',
      description: 'GM system access opens Signal Control without creating a character installation or ECHO player account.',
      onlineNotice: 'ECHO // SIGNAL CONTROL ONLINE',
    },
  },
  {
    id: 'pulse',
    name: 'PULSE',
    owner: 'VOX NET',
    category: 'SOCIAL',
    description: 'A fast public network for live trends, responses, and Heat moving through New Vega.',
    shortDescription: 'Public network',
    searchAliases: ['social', 'public', 'trends', 'vox', 'heat'],
    accentRgb: '255, 78, 96',
    icon: Activity,
    systemApp: false,
    removable: true,
    available: true,
    catalogueStatus: 'available',
    version: '9.2.4',
    installSize: '196 MB',
    features: ['Live public feed', 'Real social graph', 'Server-backed bookmarks'],
    defaultWindow: { width: 1120, height: 700, minWidth: 620, minHeight: 440 },
    subtitle: 'VOX NET // PUBLIC NETWORK',
    onlineNotice: 'PULSE // PUBLIC NETWORK ONLINE',
  },
  {
    id: 'iden',
    name: 'IDEN',
    owner: 'NETWATCH',
    category: 'IDENTITY',
    description: 'The public-grid identity, credential, and trust record interface maintained by NetWatch.',
    shortDescription: 'Identity system',
    searchAliases: ['identity', 'verification', 'credentials', 'netwatch', 'trust'],
    accentRgb: '78, 169, 255',
    icon: Fingerprint,
    systemApp: true,
    removable: false,
    available: true,
    catalogueStatus: 'available',
    version: '8.4.7',
    installSize: 'System image',
    features: ['Credential review', 'Trust records', 'Identity verification'],
    defaultWindow: { width: 1060, height: 680, minWidth: 600, minHeight: 430 },
    subtitle: 'NETWATCH // IDENTITY SYSTEM',
    onlineNotice: 'IDEN // IDENTITY SYSTEM ONLINE',
  },
  {
    id: 'nvn',
    name: 'NVN',
    owner: 'NEW VEGA NETWORK',
    category: 'NEWS',
    description: 'An independent newsroom for dispatches, reports, and live public-grid coverage.',
    shortDescription: 'Independent newsroom',
    searchAliases: ['news', 'headlines', 'dispatch', 'new vega network', 'journalism'],
    accentRgb: '80, 220, 175',
    icon: Newspaper,
    systemApp: false,
    removable: true,
    available: true,
    catalogueStatus: 'available',
    version: '5.1.3',
    installSize: '174 MB',
    features: ['Editorial dispatches', 'Live desk', 'Saved reports'],
    defaultWindow: { width: 1120, height: 700, minWidth: 620, minHeight: 440 },
    subtitle: 'NVN // INDEPENDENT NETWORK',
    onlineNotice: 'NVN // NEWSROOM ONLINE',
    gmSystemAccess: {
      entryPoint: 'newsroom-control',
      statusLabel: 'Newsroom Control',
      actionLabel: 'Open Newsroom Control',
      description: 'GM system access opens authoritative Newsroom Control without creating a character installation or app account.',
      onlineNotice: 'NVN // NEWSROOM CONTROL ONLINE',
    },
  },
  {
    id: 'net-store',
    name: 'NET STORE',
    owner: 'VEIL OS',
    category: 'SYSTEM',
    description: 'The local VEIL OS catalogue for approved city services and application modules.',
    shortDescription: 'VEIL OS software catalogue',
    searchAliases: ['store', 'install', 'catalogue', 'catalog', 'software', 'applications'],
    accentRgb: '243, 230, 0',
    icon: Store,
    systemApp: true,
    removable: false,
    available: true,
    catalogueStatus: 'available',
    version: '1.0.0',
    installSize: 'System image',
    features: ['Local catalogue', 'Application library', 'Installation records'],
    defaultWindow: { width: 1240, height: 760, minWidth: 760, minHeight: 500 },
    subtitle: 'VEGA MESH // SOFTWARE CATALOGUE',
    onlineNotice: 'NET STORE // MESH CATALOGUE READY',
  },
  {
    id: 'loop',
    name: 'LOOP',
    owner: 'VOX NET',
    category: 'CREATOR',
    description: 'A creator network for music, clips, and culture moving through the public grid.',
    shortDescription: 'Creator network',
    searchAliases: ['creators', 'creator', 'clips', 'video', 'music', 'culture'],
    accentRgb: '255, 78, 177',
    icon: Video,
    systemApp: false,
    removable: true,
    available: false,
    catalogueStatus: 'coming-soon',
    version: 'Pending release',
    installSize: '—',
    features: ['Creator profiles', 'Music culture', 'Short clips'],
    defaultWindow: { width: 1100, height: 700, minWidth: 620, minHeight: 440 },
    subtitle: 'VOX NET // CREATOR NETWORK',
  },
]

export const systemNetAppIds = netAppCatalog
  .filter((app) => app.systemApp && app.available)
  .map((app) => app.id) as readonly NetAppId[]

export const optionalNetAppIds = ['echo', 'pulse', 'nvn'] as const satisfies readonly NetOptionalAppId[]

export function getNetAppDefinition(id: string): NetAppDefinition | undefined {
  return netAppCatalog.find((app) => app.id === id)
}

export function isNetRunnableAppId(id: string): id is NetRunnableAppId {
  return id !== 'loop' && Boolean(getNetAppDefinition(id))
}

export function isNetOptionalAppId(id: string): id is NetOptionalAppId {
  return optionalNetAppIds.some((candidate) => candidate === id)
}

export function resolveNetAppAccessMode(
  app: NetAppDefinition,
  installed: boolean,
  isAuthoritativeGm: boolean,
): NetAppAccessMode | null {
  if (isAuthoritativeGm && app.gmSystemAccess) return 'gm-system'
  if (installed) return 'player'
  return null
}
