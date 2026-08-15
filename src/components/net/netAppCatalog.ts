import {
  Activity,
  Building2,
  Fingerprint,
  Landmark,
  MessagesSquare,
  Newspaper,
  Settings2,
  Store,
  Video,
  WalletCards,
  HeartPulse,
  Waves,
  type LucideIcon,
} from 'lucide-react'

import type { NetWindowConstraints } from './netWindowGeometry'
import {
  netAppScopeAllows,
  type NetAppScope,
  type NetOsId,
} from '../../lib/netOsTypes'
import { ALTARA_NEWS_PRODUCT_NAME } from '../../lib/netAltaraNewsTypes'

export type NetAppId =
  | 'echo'
  | 'pulse'
  | 'iden'
  | 'vlt'
  | 'vox-bank'
  | 'shneider-bank'
  | 'nvn'
  | 'net-store'
  | 'loop'
  | 'altara-messenger'
  | 'altara-bank'
  | 'altara-news'
  | 'altara-store'
  | 'altara-settings'

export type NetRunnableAppId = Exclude<NetAppId, 'loop'>
export type NetOptionalAppId =
  | 'echo'
  | 'pulse'
  | 'nvn'
  | 'vox-bank'
  | 'shneider-bank'
  | 'altara-bank'
  | 'altara-news'
export type NetCatalogueStatus = 'available' | 'coming-soon'
export type NetAppAccessMode = 'player' | 'gm-system'
export type NetGmSystemEntryPoint = 'signal-control' | 'newsroom-control' | 'economy-control' | 'reader'

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
  scope: NetAppScope
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
    scope: 'veil-only',
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
    scope: 'veil-only',
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
    scope: 'veil-only',
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
    id: 'vlt',
    scope: 'veil-only',
    name: 'VLT',
    owner: 'NEW VEGA NETWORK',
    category: 'FINANCE',
    description: 'New Vega Network payments for authoritative vG and optional Karma social-capital profiles, direct identity transfers, and compact ledger activity.',
    shortDescription: 'New Vega Network wallet',
    searchAliases: ['wallet', 'cash', 'money', 'payment', 'credits', 'economy', 'karma', 'new vega network'],
    accentRgb: '232, 198, 109',
    icon: WalletCards,
    systemApp: true,
    removable: false,
    available: true,
    catalogueStatus: 'available',
    version: '1.0.0',
    installSize: 'System image',
    features: ['vG + optional Karma', 'Direct identity payments', 'Bounded ledger activity'],
    defaultWindow: { width: 980, height: 680, minWidth: 560, minHeight: 430 },
    subtitle: 'NEW VEGA NETWORK // PAYMENTS',
    onlineNotice: 'VLT // NETWORK WALLET ONLINE',
    gmSystemAccess: {
      entryPoint: 'economy-control',
      statusLabel: 'Economy Control',
      actionLabel: 'Open Economy Control',
      description: 'GM system access opens authoritative Economy Control without using a character identity or wallet as authority.',
      onlineNotice: 'VLT // ECONOMY CONTROL ONLINE',
    },
  },
  {
    id: 'nvn',
    scope: 'veil-only',
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
    id: 'vox-bank',
    scope: 'veil-only',
    name: 'VOX BANK',
    owner: 'VOX NET',
    category: 'FINANCE',
    description: 'A private vG savings account with direct VOX payments, VLT deposits and withdrawals, and a simple seven-day VOX Yield cycle.',
    shortDescription: 'VOX NET digital banking',
    searchAliases: ['bank', 'banking', 'savings', 'deposit', 'withdraw', 'yield', 'vox', 'vg'],
    accentRgb: '105, 198, 220',
    icon: Landmark,
    systemApp: false,
    removable: true,
    available: true,
    catalogueStatus: 'available',
    version: '1.0.0',
    installSize: '84 MB',
    features: ['Direct VOX payments', 'VLT deposits & withdrawals', 'Seven-day VOX Yield'],
    defaultWindow: { width: 1000, height: 700, minWidth: 580, minHeight: 440 },
    subtitle: 'VOX NET // DIGITAL BANKING',
    onlineNotice: 'VOX BANK // SECURE ACCOUNT ONLINE',
  },
  {
    id: 'shneider-bank',
    scope: 'veil-only',
    name: 'SHNEIDER BANK',
    owner: 'SHNEIDER',
    category: 'FINANCE',
    description: 'Private vG banking with direct SHNEIDER payments and preferred benefits across the SHNEIDER medical network.',
    shortDescription: 'Private health banking',
    searchAliases: ['bank', 'banking', 'health', 'medical', 'hospital', 'clinic', 'pharmacy', 'shneider', 'vg'],
    accentRgb: '167, 32, 46',
    icon: HeartPulse,
    systemApp: false,
    removable: true,
    available: true,
    catalogueStatus: 'available',
    version: '1.0.0',
    installSize: '76 MB',
    features: ['Direct SHNEIDER payments', 'VLT deposits & withdrawals', 'Medical network benefits'],
    defaultWindow: { width: 1020, height: 710, minWidth: 600, minHeight: 450 },
    subtitle: 'SHNEIDER // PRIVATE HEALTH BANKING',
    onlineNotice: 'SHNEIDER BANK // PRIVATE ACCOUNT ONLINE',
  },
  {
    id: 'net-store',
    scope: 'veil-only',
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
    scope: 'veil-only',
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
  {
    id: 'altara-messenger',
    scope: 'altara-only',
    name: 'ALTARA',
    owner: 'ALTARA',
    category: 'COMMUNICATIONS',
    description: 'ALTARA global communications with private direct messages, groups, and server-backed conversation history.',
    shortDescription: 'Global communications',
    searchAliases: ['altara', 'communications', 'messages', 'calls', 'global'],
    accentRgb: '219, 192, 139',
    icon: MessagesSquare,
    systemApp: true,
    removable: false,
    available: true,
    catalogueStatus: 'available',
    version: '1.0',
    installSize: 'System image',
    features: ['Direct messages', 'Private groups', 'Realtime conversation sync'],
    defaultWindow: { width: 1040, height: 680, minWidth: 460, minHeight: 390 },
    subtitle: 'ALTARA // GLOBAL COMMUNICATIONS',
    onlineNotice: 'ALTARA // COMMUNICATIONS ONLINE',
  },
  {
    id: 'altara-bank',
    scope: 'altara-only',
    name: 'ALTARA BANK',
    owner: 'ALTARA',
    category: 'FINANCE',
    description: 'ALTARA global banking with home-currency accounts, quoted cross-city payments, and authoritative account history.',
    shortDescription: 'Global personal banking',
    searchAliases: ['altara', 'bank', 'finance', 'global banking'],
    accentRgb: '200, 174, 123',
    icon: Building2,
    systemApp: false,
    removable: true,
    available: true,
    catalogueStatus: 'available',
    version: '1.0',
    installSize: 'System service',
    features: ['Home-currency account', 'Server-quoted cross-city payments', 'Realtime account history'],
    defaultWindow: { width: 1040, height: 700, minWidth: 520, minHeight: 420 },
    subtitle: 'ALTARA // GLOBAL FINANCE',
    onlineNotice: 'ALTARA BANK // SECURE BANKING ONLINE',
  },
  {
    id: 'altara-news',
    scope: 'altara-only',
    name: ALTARA_NEWS_PRODUCT_NAME,
    owner: 'ALTARA',
    category: 'NEWS',
    description: 'A premium global newsroom for multi-city reporting, breaking coverage, live incident timelines, and private saved reading.',
    shortDescription: 'Global multi-city newsroom',
    searchAliases: ['news', 'world', 'local', 'live', 'culture', 'business', 'technology'],
    accentRgb: '215, 180, 120',
    icon: Newspaper,
    systemApp: false,
    removable: true,
    available: true,
    catalogueStatus: 'available',
    version: '1.0',
    installSize: 'System service',
    features: ['Global and local editions', 'Live incident coverage', 'Private saved articles'],
    defaultWindow: { width: 1160, height: 740, minWidth: 560, minHeight: 430 },
    subtitle: 'ALTARA // GLOBAL NEWSROOM',
    onlineNotice: 'NEWS // GLOBAL EDITION ONLINE',
    gmSystemAccess: {
      entryPoint: 'newsroom-control',
      statusLabel: 'NEWSROOM',
      actionLabel: 'Open NEWSROOM',
      description: 'GM System opens the authoritative ALTARA newsroom without creating a fictional reader identity.',
      onlineNotice: 'NEWSROOM // EDITORIAL CONTROL ONLINE',
    },
  },
  {
    id: 'altara-store',
    scope: 'altara-only',
    name: 'ALTARA STORE',
    owner: 'ALTARA',
    category: 'SYSTEM',
    description: 'The authoritative ALTARA OS software catalogue for compatible system and third-party applications.',
    shortDescription: 'ALTARA OS software catalogue',
    searchAliases: ['altara', 'store', 'software', 'applications', 'install'],
    accentRgb: '224, 200, 153',
    icon: Store,
    systemApp: true,
    removable: false,
    available: true,
    catalogueStatus: 'available',
    version: '1.0.0',
    installSize: 'System image',
    features: ['OS-scoped catalogue', 'Authoritative installations', 'Third-party ready'],
    defaultWindow: { width: 900, height: 620, minWidth: 520, minHeight: 410 },
    subtitle: 'ALTARA OS // SOFTWARE CATALOGUE',
    onlineNotice: 'ALTARA STORE // CATALOGUE READY',
  },
  {
    id: 'altara-settings',
    scope: 'altara-only',
    name: 'SETTINGS',
    owner: 'ALTARA OS',
    category: 'SYSTEM',
    description: 'ALTARA OS identity and persistent desktop appearance settings.',
    shortDescription: 'ALTARA OS preferences',
    searchAliases: ['settings', 'wallpaper', 'appearance', 'identity', 'altara'],
    accentRgb: '193, 188, 178',
    icon: Settings2,
    systemApp: true,
    removable: false,
    available: true,
    catalogueStatus: 'available',
    version: '1.0.0',
    installSize: 'System image',
    features: ['Identity-scoped wallpapers', 'Wallpaper fit and position', 'System identity'],
    defaultWindow: { width: 760, height: 650, minWidth: 480, minHeight: 440 },
    subtitle: 'ALTARA OS // SYSTEM PREFERENCES',
    onlineNotice: 'SETTINGS // IDENTITY PROFILE READY',
  },
]

export const systemNetAppIds = netAppCatalog
  .filter((app) => app.systemApp && app.available)
  .map((app) => app.id) as readonly NetAppId[]

export const optionalNetAppIds = [
  'echo',
  'pulse',
  'nvn',
  'vox-bank',
  'shneider-bank',
  'altara-bank',
  'altara-news',
] as const satisfies readonly NetOptionalAppId[]

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
  osId: NetOsId,
): NetAppAccessMode | null {
  if (!netAppScopeAllows(app.scope, osId)) return null
  if (isAuthoritativeGm && app.gmSystemAccess) return 'gm-system'
  if (installed) return 'player'
  return null
}
