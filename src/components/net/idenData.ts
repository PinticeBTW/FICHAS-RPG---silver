export type IdentityType =
  | 'citizen'
  | 'corporation'
  | 'organisation'
  | 'authority'
  | 'unresolved'

export type VerificationState =
  | 'verified'
  | 'pending'
  | 'anomalous'
  | 'infrastructure-authority'
  | 'authority-verified'
  | 'unverified'

export type TrustBand = 'high' | 'stable' | 'review' | 'restricted' | 'unknown'

export type SecurityRisk = 'low' | 'monitored' | 'elevated' | 'critical' | 'unknown'

export type NetworkReputation = 'stable' | 'volatile' | 'unknown'

export interface IdenFlag {
  id: string
  label: string
  severity: 'info' | 'warning' | 'critical'
}

export interface NetworkIdentityRef {
  service: string
  handle?: string
  status: string
}

export interface KnownOrganisation {
  id: string
  name: string
  relationship: string
}

export interface Identity {
  id: string
  displayId: string
  name: string
  handle: string
  type: IdentityType
  district?: string
  bio: string
  verification: VerificationState
  trustScore?: number
  trustBand: TrustBand
  corporateTrust?: 'very-high' | 'high' | 'standard'
  networkReputation?: NetworkReputation
  securityRisk: SecurityRisk
  credentialNames?: string[]
  networkIdentities?: NetworkIdentityRef[]
  organisations?: KnownOrganisation[]
  connections?: string[]
  flags?: IdenFlag[]
  publicProfile: boolean
  limitedVisibility?: boolean
  lastVerified: string
  corrupted?: boolean
  restrictedSections?: string[]
  avatarUrl?: string
}

export type CredentialStatus = 'active' | 'expiring' | 'suspended' | 'expired'

export interface Credential {
  id: string
  name: string
  issuer: string
  status: CredentialStatus
  issued: string
  expires: string
  scope: string
  lastVerified: string
  classification: string
  mandatory?: boolean
  publicVisible: boolean
}

export interface TrustFactor {
  id: string
  label: string
  value: number
  weight: number
  direction: 'up' | 'down' | 'flat'
  explanation: string
  lastUpdated: string
  relatedEventIds?: string[]
}

export interface TrustHistoryPoint {
  label: string
  score: number
}

export type ConnectionStatus = 'connected' | 'limited' | 'inactive' | 'revoked'

export interface IdenConnectionRecord {
  id: string
  service: string
  owner: string
  description: string
  status: ConnectionStatus
  dataCategories: string[]
  lastAccess: string
  permissions: string[]
  required: boolean
  route: string
}

export type AccessEventType =
  | 'identity-check'
  | 'credential'
  | 'location'
  | 'trust'
  | 'security'
  | 'session'

export type AccessResult = 'granted' | 'denied' | 'flagged'
export type AccessRisk = 'normal' | 'elevated' | 'suspicious'

export interface AccessEvent {
  id: string
  service: string
  owner: string
  minutesAgo: number
  timestamp: string
  type: AccessEventType
  dataRequested: string
  result: AccessResult
  relay: string
  risk: AccessRisk
  auditId: string
  relatedConnectionId?: string
  reviewed?: boolean
  flaggedLocally?: boolean
}

export type PrivacyCategory = 'public' | 'conditional' | 'private' | 'mandatory'

export interface PrivacyField {
  id: string
  label: string
  category: PrivacyCategory
  value: string
  defaultPublic: boolean
}

export type IdenNav =
  | 'overview'
  | 'directory'
  | 'credentials'
  | 'trust'
  | 'connections'
  | 'access'
  | 'privacy'

export function generateDisplayId(seed: string): string {
  let hash = 0

  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }

  const part1 = (hash % 0xffff).toString(16).toUpperCase().padStart(4, '0')
  const part2 = (Math.floor(hash / 0xffff) % 1000).toString().padStart(3, '0')

  return `NV-${part1}-${part2}`
}

export function trustBandForScore(score: number): TrustBand {
  if (score >= 80) return 'high'
  if (score >= 60) return 'stable'
  if (score >= 40) return 'review'
  return 'restricted'
}

function formatAgo(minutesAgo: number): string {
  if (minutesAgo < 1) return 'NOW'
  if (minutesAgo < 60) return `${minutesAgo}M AGO`
  if (minutesAgo < 60 * 24) return `${Math.round(minutesAgo / 60)}H AGO`
  return `${Math.round(minutesAgo / (60 * 24))}D AGO`
}

export const identities: Identity[] = [
  {
    id: 'adrian',
    displayId: 'NV-4C21-887',
    name: 'Adrian Vale',
    handle: 'adrian',
    type: 'citizen',
    district: 'Neon Row',
    bio: 'Rooftop signals, night shifts, and public activity across PULSE and ECHO. Frequently active after 22:00 local.',
    verification: 'verified',
    trustScore: 64,
    trustBand: 'stable',
    networkReputation: 'volatile',
    securityRisk: 'monitored',
    credentialNames: ['Citizen Identity Credential', 'District Residence Credential'],
    networkIdentities: [
      { service: 'PULSE', handle: '@adrian', status: 'Active, public' },
      { service: 'ECHO', handle: '@adrian', status: 'Resonance activity detected' },
    ],
    connections: ['maya', 'sable', 'kenji'],
    flags: [
      { id: 'f-adrian-1', label: 'Behavioural volatility monitored', severity: 'warning' },
    ],
    publicProfile: true,
    lastVerified: '4D AGO',
  },
  {
    id: 'maya',
    displayId: 'NV-9F02-341',
    name: 'Maya Serrin',
    handle: 'maya',
    type: 'citizen',
    district: 'Old Quarter',
    bio: 'Old Quarter archivist. Long-standing residence credential, minimal public exposure by choice.',
    verification: 'verified',
    trustScore: 82,
    trustBand: 'high',
    networkReputation: 'stable',
    securityRisk: 'low',
    credentialNames: ['Citizen Identity Credential', 'District Residence Credential — Verified 2Y'],
    networkIdentities: [{ service: 'PULSE', handle: '@maya', status: 'Active, limited visibility' }],
    connections: ['adrian', 'sable'],
    publicProfile: true,
    limitedVisibility: true,
    lastVerified: '11D AGO',
  },
  {
    id: 'ghost',
    displayId: 'NV-????-???',
    name: 'Ghost in the Net',
    handle: 'ghost_in_the_net',
    type: 'unresolved',
    district: undefined,
    bio: '[IDENTITY RECORD PARTIALLY CORRUPTED] ...route origin could not be resolved to a registered NetWatch node—',
    verification: 'anomalous',
    trustScore: undefined,
    trustBand: 'unknown',
    securityRisk: 'critical',
    corrupted: true,
    restrictedSections: ['Residence history', 'Institutional record', 'Biometric baseline'],
    flags: [
      { id: 'f-ghost-1', label: 'Conflicting identifiers detected', severity: 'critical' },
      { id: 'f-ghost-2', label: 'No issuing authority on record', severity: 'critical' },
      { id: 'f-ghost-3', label: 'Anomalous network route', severity: 'warning' },
    ],
    publicProfile: false,
    lastVerified: 'NEVER VERIFIED',
  },
  {
    id: 'lucid',
    displayId: 'NV-0022-ECH',
    name: 'Lucid Interactive',
    handle: 'lucid',
    type: 'corporation',
    bio: 'Operator of ECHO, the resonance-based social layer. Identity handshake and public handle linkage are authenticated through VEGA MESH.',
    verification: 'verified',
    corporateTrust: 'high',
    trustBand: 'high',
    securityRisk: 'low',
    organisations: [{ id: 'o-echo', name: 'ECHO', relationship: 'Public social layer' }],
    connections: [],
    publicProfile: true,
    lastVerified: '2D AGO',
  },
  {
    id: 'voxnet',
    displayId: 'NV-0031-PUL',
    name: 'VOX NET',
    handle: 'VoxNet',
    type: 'corporation',
    bio: 'Operator of PULSE, the citywide public network. Ranks public content while VEGA MESH provides local service trust and routing.',
    verification: 'verified',
    corporateTrust: 'high',
    trustBand: 'high',
    securityRisk: 'low',
    organisations: [{ id: 'o-pulse', name: 'PULSE', relationship: 'Public network' }],
    connections: [],
    publicProfile: true,
    lastVerified: '2D AGO',
  },
  {
    id: 'nvn',
    displayId: 'NV-0044-NWS',
    name: 'NVN',
    handle: 'NVN',
    type: 'organisation',
    bio: 'New Vega News. Verified press organisation with standing profile-lookup authorisation for public-interest reporting.',
    verification: 'verified',
    corporateTrust: 'standard',
    trustBand: 'stable',
    securityRisk: 'low',
    publicProfile: true,
    lastVerified: '3D AGO',
  },
  {
    id: 'nvps',
    displayId: 'NV-0007-GOV',
    name: 'New Vega Public Safety',
    handle: 'NVPS',
    type: 'authority',
    bio: 'Public-safety authority for New Vega districts. Authority-verified identity with standing NetWatch data relationship.',
    verification: 'authority-verified',
    corporateTrust: 'very-high',
    trustBand: 'high',
    securityRisk: 'low',
    publicProfile: true,
    lastVerified: '6H AGO',
  },
  {
    id: 'netwatch',
    displayId: 'NV-0000-NWX',
    name: 'NetWatch',
    handle: 'netwatch',
    type: 'authority',
    bio: 'Operator of IDEN. Issuing and monitoring authority for citizen and corporate identity across New Vega. "Trust through transparency."',
    verification: 'authority-verified',
    corporateTrust: 'very-high',
    trustBand: 'high',
    securityRisk: 'low',
    organisations: [{ id: 'o-iden', name: 'IDEN', relationship: 'Identity, credential and trust platform' }],
    publicProfile: true,
    lastVerified: 'CONTINUOUS',
  },
  {
    id: 'sable',
    displayId: 'NV-5512-664',
    name: 'Sable',
    handle: 'sable',
    type: 'citizen',
    district: 'Chrome Docks',
    bio: 'Chrome Docks resident. Standard verified citizen record.',
    verification: 'verified',
    trustScore: 57,
    trustBand: 'review',
    networkReputation: 'stable',
    securityRisk: 'monitored',
    connections: ['adrian', 'maya', 'kenji'],
    publicProfile: true,
    lastVerified: '9D AGO',
  },
  {
    id: 'kenji',
    displayId: 'NV-6630-129',
    name: 'Kenji',
    handle: 'kenji_v',
    type: 'citizen',
    district: 'District 04',
    bio: 'District 04 — Undercroft. Verified citizen, frequent cross-district travel logged.',
    verification: 'verified',
    trustScore: 61,
    trustBand: 'stable',
    networkReputation: 'stable',
    securityRisk: 'low',
    connections: ['adrian', 'sable'],
    publicProfile: true,
    lastVerified: '5D AGO',
  },
]

export const identitiesById = new Map(identities.map((identity) => [identity.id, identity]))

// ---- Current-user (self) mock records ----

export const selfCredentials: Credential[] = [
  {
    id: 'cred-citizen',
    name: 'Citizen Identity Credential',
    issuer: 'NetWatch / New Vega Registry',
    status: 'active',
    issued: '3Y AGO',
    expires: 'NO EXPIRY',
    scope: 'Core identity, network authentication',
    lastVerified: '4H AGO',
    classification: 'Core',
    mandatory: true,
    publicVisible: true,
  },
  {
    id: 'cred-residence',
    name: 'District Residence Credential',
    issuer: 'Central District Authority',
    status: 'active',
    issued: '1Y AGO',
    expires: '11MO REMAINING',
    scope: 'Residence verification, district services',
    lastVerified: '6D AGO',
    classification: 'Standard',
    publicVisible: true,
  },
  {
    id: 'cred-mesh-token',
    name: 'VEGA MESH Identity Token',
    issuer: 'New Vega Civic Systems',
    status: 'active',
    issued: '3Y AGO',
    expires: 'AUTO-RENEWING',
    scope: 'Secure session handshake, cross-app authentication',
    lastVerified: '2H AGO',
    classification: 'Infrastructure',
    mandatory: true,
    publicVisible: false,
  },
  {
    id: 'cred-network-licence',
    name: 'Public Network Access Licence',
    issuer: 'NetWatch',
    status: 'active',
    issued: '2Y AGO',
    expires: '5MO REMAINING',
    scope: 'PULSE, ECHO and IDEN directory participation',
    lastVerified: '1D AGO',
    classification: 'Standard',
    publicVisible: true,
  },
  {
    id: 'cred-operative',
    name: 'Operative Field Credential',
    issuer: 'Lucid Interactive',
    status: 'expiring',
    issued: '11MO AGO',
    expires: '9D REMAINING',
    scope: 'Field relay access, ECHO operations clearance',
    lastVerified: '18D AGO',
    classification: 'Restricted',
    publicVisible: false,
  },
  {
    id: 'cred-legacy',
    name: 'Legacy Access Badge',
    issuer: 'NetWatch',
    status: 'suspended',
    issued: '5Y AGO',
    expires: 'EXPIRED',
    scope: 'Deprecated district relay access',
    lastVerified: '2Y AGO',
    classification: 'Deprecated',
    publicVisible: false,
  },
]

export const selfTrustScore = 71
export const selfTrustBand = trustBandForScore(selfTrustScore)

export const selfTrustHistory: TrustHistoryPoint[] = [
  { label: '12MO', score: 63 },
  { label: '11MO', score: 65 },
  { label: '10MO', score: 64 },
  { label: '9MO', score: 66 },
  { label: '8MO', score: 68 },
  { label: '7MO', score: 67 },
  { label: '6MO', score: 69 },
  { label: '5MO', score: 70 },
  { label: '4MO', score: 68 },
  { label: '3MO', score: 72 },
  { label: '2MO', score: 70 },
  { label: '1MO', score: 71 },
]

export const selfTrustFactors: TrustFactor[] = [
  {
    id: 'factor-identity',
    label: 'Identity confidence',
    value: 88,
    weight: 25,
    direction: 'flat',
    explanation: 'Based on credential consistency and verification recency.',
    lastUpdated: '4H AGO',
  },
  {
    id: 'factor-civic',
    label: 'Civic record',
    value: 74,
    weight: 20,
    direction: 'up',
    explanation: 'Residence and district participation history.',
    lastUpdated: '6D AGO',
  },
  {
    id: 'factor-financial',
    label: 'Financial stability',
    value: 60,
    weight: 15,
    direction: 'down',
    explanation: 'Derived from licensed financial-service reporting.',
    lastUpdated: '3D AGO',
  },
  {
    id: 'factor-conduct',
    label: 'Network conduct',
    value: 66,
    weight: 20,
    direction: 'up',
    explanation: 'Behavioural pattern across connected public networks.',
    lastUpdated: '1D AGO',
    relatedEventIds: ['evt-pulse-check'],
  },
  {
    id: 'factor-security',
    label: 'Security risk',
    value: 81,
    weight: 10,
    direction: 'flat',
    explanation: 'Inverse of flagged or suspicious access events.',
    lastUpdated: '1D AGO',
    relatedEventIds: ['evt-unknown'],
  },
  {
    id: 'factor-institutional',
    label: 'Institutional verification',
    value: 70,
    weight: 10,
    direction: 'up',
    explanation: 'Credentials verified by institutions participating in IDEN.',
    lastUpdated: '18D AGO',
    relatedEventIds: ['evt-credential'],
  },
]

export const trustImpactAreas = [
  'Employment screening',
  'Housing applications',
  'Travel clearance',
  'Security access',
  'Credit eligibility',
  'Corporate onboarding',
]

export const trustReviewReasons = [
  'Incorrect civic record',
  'Outdated financial data',
  'Disputed network conduct event',
  'Identity verification error',
  'Other',
]

export const selfConnections: IdenConnectionRecord[] = [
  {
    id: 'conn-iden-core',
    service: 'IDEN Core',
    owner: 'NetWatch',
    description: 'Core identity platform. Required for network participation.',
    status: 'connected',
    dataCategories: ['Legal identity', 'Verification state', 'Trust Index'],
    lastAccess: 'CONTINUOUS',
    permissions: ['Core identity read/write', 'Trust Index computation'],
    required: true,
    route: 'NetWatch internal network',
  },
  {
    id: 'conn-vega-mesh',
    service: 'VEGA MESH',
    owner: 'New Vega Civic Systems',
    description: 'Local identity handshake, secure-session transport and resilient district routing.',
    status: 'connected',
    dataCategories: ['Session identity', 'Device handoff'],
    lastAccess: '2H AGO',
    permissions: ['Session handshake', 'Encrypted relay routing'],
    required: true,
    route: 'VEGA MESH secure city backbone',
  },
  {
    id: 'conn-echo',
    service: 'ECHO',
    owner: 'Lucid Interactive',
    description: 'Public handle linkage and optional location proof for resonance posts.',
    status: 'connected',
    dataCategories: ['Public handle', 'District location proof (optional)'],
    lastAccess: '5H AGO',
    permissions: ['Public handle read', 'Location proof (optional)'],
    required: false,
    route: 'VEGA MESH // ECHO service trust',
  },
  {
    id: 'conn-pulse',
    service: 'PULSE',
    owner: 'VOX NET',
    description: 'Public identity, verification badge and profile linkage.',
    status: 'connected',
    dataCategories: ['Public handle', 'Verification badge'],
    lastAccess: '1D AGO',
    permissions: ['Public handle read', 'Verification badge sync'],
    required: false,
    route: 'VEGA MESH // PULSE service trust',
  },
  {
    id: 'conn-partners',
    service: 'Local Grid Services',
    owner: 'New Vega Civic Systems',
    description: 'Limited identity handshake for approved local services.',
    status: 'limited',
    dataCategories: ['Handshake token only'],
    lastAccess: '4D AGO',
    permissions: ['Handshake token issuance'],
    required: false,
    route: 'VEGA MESH // approved service layer',
  },
  {
    id: 'conn-nvn',
    service: 'NVN',
    owner: 'NVN',
    description: 'Optional news and public-profile relationship.',
    status: 'limited',
    dataCategories: ['Public profile lookup'],
    lastAccess: '9D AGO',
    permissions: ['Public profile read'],
    required: false,
    route: 'VEGA MESH // NVN service trust',
  },
  {
    id: 'conn-loop',
    service: 'LOOP',
    owner: 'VOX NET',
    description: 'Future creator-profile relationship. Currently inactive.',
    status: 'inactive',
    dataCategories: [],
    lastAccess: 'NEVER',
    permissions: [],
    required: false,
    route: 'Not established',
  },
]

const accessSeeds: Omit<AccessEvent, 'timestamp'>[] = [
  {
    id: 'evt-session',
    service: 'VEIL OS',
    owner: 'New Vega Civic Systems / NetWatch',
    minutesAgo: 3,
    type: 'session',
    dataRequested: 'Session identity, presence',
    result: 'granted',
    relay: 'NV-01 // Local grid',
    risk: 'normal',
    auditId: 'AX-88213',
  },
  {
    id: 'evt-mesh-session',
    service: 'VEGA MESH',
    owner: 'New Vega Civic Systems',
    minutesAgo: 90,
    type: 'identity-check',
    dataRequested: 'Identity handshake, device handoff',
    result: 'granted',
    relay: 'VEGA MESH secure node',
    risk: 'normal',
    auditId: 'AX-88190',
    relatedConnectionId: 'conn-vega-mesh',
  },
  {
    id: 'evt-echo-location',
    service: 'ECHO',
    owner: 'Lucid Interactive',
    minutesAgo: 300,
    type: 'location',
    dataRequested: 'District-level location proof',
    result: 'granted',
    relay: 'VEGA MESH // ECHO service trust',
    risk: 'normal',
    auditId: 'AX-87990',
    relatedConnectionId: 'conn-echo',
  },
  {
    id: 'evt-pulse-check',
    service: 'PULSE',
    owner: 'VOX NET',
    minutesAgo: 500,
    type: 'identity-check',
    dataRequested: 'Verification badge sync',
    result: 'granted',
    relay: 'VEGA MESH // PULSE service trust',
    risk: 'normal',
    auditId: 'AX-87801',
    relatedConnectionId: 'conn-pulse',
  },
  {
    id: 'evt-risk-analysis',
    service: 'NetWatch Risk Analysis',
    owner: 'NetWatch',
    minutesAgo: 60,
    type: 'security',
    dataRequested: 'Network conduct pattern review',
    result: 'granted',
    relay: 'NetWatch internal network',
    risk: 'normal',
    auditId: 'AX-88201',
  },
  {
    id: 'evt-nvn-lookup',
    service: 'NVN',
    owner: 'NVN',
    minutesAgo: 800,
    type: 'identity-check',
    dataRequested: 'Public profile lookup',
    result: 'granted',
    relay: 'VEGA MESH // NVN service trust',
    risk: 'normal',
    auditId: 'AX-87511',
    relatedConnectionId: 'conn-nvn',
  },
  {
    id: 'evt-unknown',
    service: 'Unknown relay',
    owner: 'Unregistered',
    minutesAgo: 45,
    type: 'security',
    dataRequested: 'Full identity export (attempted)',
    result: 'denied',
    relay: 'Unresolved external node',
    risk: 'suspicious',
    auditId: 'AX-88205',
  },
  {
    id: 'evt-credential',
    service: 'Credential Verification',
    owner: 'NetWatch',
    minutesAgo: 240,
    type: 'credential',
    dataRequested: 'Operative Field Credential re-check',
    result: 'granted',
    relay: 'NetWatch internal network',
    risk: 'normal',
    auditId: 'AX-88011',
  },
  {
    id: 'evt-trust-refresh',
    service: 'Trust Index Engine',
    owner: 'NetWatch',
    minutesAgo: 1440,
    type: 'trust',
    dataRequested: 'Scheduled score recomputation',
    result: 'granted',
    relay: 'NetWatch internal network',
    risk: 'normal',
    auditId: 'AX-86920',
  },
]

export const selfAccessEvents: AccessEvent[] = accessSeeds.map((seed) => ({
  ...seed,
  timestamp: formatAgo(seed.minutesAgo),
}))

export const selfPrivacyFields: PrivacyField[] = [
  { id: 'p-name', label: 'Display name', category: 'public', value: 'Set from profile', defaultPublic: true },
  { id: 'p-handle', label: 'Handle', category: 'public', value: 'Set from profile', defaultPublic: true },
  { id: 'p-avatar', label: 'Avatar', category: 'public', value: 'Set from profile', defaultPublic: true },
  { id: 'p-verification', label: 'Verification', category: 'public', value: 'Verified citizen', defaultPublic: true },
  { id: 'p-org', label: 'Public organisation', category: 'public', value: 'None on record', defaultPublic: true },

  { id: 'c-district', label: 'District', category: 'conditional', value: 'Central', defaultPublic: true },
  { id: 'c-trust-band', label: 'Trust band', category: 'conditional', value: selfTrustBand, defaultPublic: false },
  { id: 'c-employment', label: 'Employment status', category: 'conditional', value: 'Operative (Lucid Interactive)', defaultPublic: false },
  { id: 'c-networks', label: 'Connected networks', category: 'conditional', value: 'VEGA MESH, ECHO, PULSE', defaultPublic: true },
  { id: 'c-credentials', label: 'Public credentials', category: 'conditional', value: '2 of 6 marked public', defaultPublic: true },

  { id: 'pr-residence', label: 'Exact residence', category: 'private', value: 'Withheld', defaultPublic: false },
  { id: 'pr-history', label: 'Full trust-factor history', category: 'private', value: 'Withheld', defaultPublic: false },
  { id: 'pr-security', label: 'Security events', category: 'private', value: 'Withheld', defaultPublic: false },
  { id: 'pr-credentials', label: 'Private credentials', category: 'private', value: 'Withheld', defaultPublic: false },
  { id: 'pr-recovery', label: 'Identity recovery data', category: 'private', value: 'Withheld', defaultPublic: false },

  { id: 'm-legal', label: 'Legal identity classification', category: 'mandatory', value: 'Verified Citizen', defaultPublic: true },
  { id: 'm-verification', label: 'Verification state', category: 'mandatory', value: 'Verified', defaultPublic: true },
  { id: 'm-core-id', label: 'Core NetWatch identifier', category: 'mandatory', value: 'Sealed', defaultPublic: true },
  { id: 'm-flags', label: 'Regulatory flags', category: 'mandatory', value: 'None on record', defaultPublic: true },
]
