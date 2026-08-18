export const NET_ECHO_MAP_NODE_LIMIT = 100
export const NET_ECHO_MAP_EDGE_LIMIT = 200
export const NET_ECHO_TITLE_MAX_LENGTH = 120
export const NET_ECHO_SUMMARY_MAX_LENGTH = 280
export const NET_ECHO_BODY_MAX_LENGTH = 4000
export const NET_ECHO_LOCKED_TEASER_MAX_LENGTH = 160
export const NET_ECHO_GM_DIRECTORY_LIMIT = 200
export const NET_ECHO_GM_LINK_LIMIT = 200
export const NET_ECHO_GM_GRANT_TARGET_LIMIT = 200

export const netEchoSignalKinds = [
  'fragment',
  'transmission',
  'rumor',
  'incident',
  'location-trace',
  'leaked-record',
  'memory-fragment',
  'identity-clue',
  'faction-activity',
  'dead',
  'corrupted',
  'encrypted',
] as const

export const netEchoReliabilities = [
  'unknown',
  'unverified',
  'contested',
  'corroborated',
  'verified',
  'compromised',
] as const

export const netEchoIntensities = ['low', 'medium', 'high', 'critical'] as const

export const netEchoRelationshipKinds = [
  'related',
  'supports',
  'contradicts',
  'origin',
  'requires',
] as const

export const netEchoSignalStatuses = ['draft', 'revealed', 'archived'] as const
export const netEchoVisibilityModes = ['global', 'granted', 'prerequisite'] as const

export type NetEchoSignalKind = typeof netEchoSignalKinds[number]
export type NetEchoReliability = typeof netEchoReliabilities[number]
export type NetEchoIntensity = typeof netEchoIntensities[number]
export type NetEchoRelationshipKind = typeof netEchoRelationshipKinds[number]
export type NetEchoSignalStatus = typeof netEchoSignalStatuses[number]
export type NetEchoVisibilityMode = typeof netEchoVisibilityModes[number]
export type NetEchoAccountStatus = 'active' | 'suspended' | 'disabled'

export interface NetEchoRequestContext {
  /** Comparison-only assertion. PostgreSQL still derives the active account. */
  readonly expectedAccountId: string
}

export interface NetEchoProvisionedAccount {
  readonly accountId: string
  readonly handle: string
  readonly status: NetEchoAccountStatus
  readonly createdAt: string
  readonly updatedAt: string
}

interface NetEchoMapNodeBase {
  readonly id: string
  readonly mapX: number
  readonly mapY: number
}

export interface NetEchoVisibleMapNode extends NetEchoMapNodeBase {
  readonly accessState: 'visible'
  readonly title: string
  readonly kind: NetEchoSignalKind
  readonly intensity: NetEchoIntensity
  readonly frequencies: readonly string[]
  readonly reliability: NetEchoReliability
  readonly districtLabel?: string
  readonly viewerDiscovered: boolean
  readonly viewerSaved: boolean
  readonly revealedAt: string
}

export interface NetEchoLockedMapNode extends NetEchoMapNodeBase {
  readonly accessState: 'locked'
  readonly lockedTeaser: string
  /** Locked nodes receive only this generic public visual kind. */
  readonly kind: 'encrypted'
  readonly viewerDiscovered: false
  readonly viewerSaved: false
}

export type NetEchoMapNode = NetEchoVisibleMapNode | NetEchoLockedMapNode

export interface NetEchoMapEdge {
  readonly fromSignalId: string
  readonly toSignalId: string
  readonly relationshipKind: NetEchoRelationshipKind
  readonly label?: string
}

export interface NetEchoMapProjection {
  readonly nodes: readonly NetEchoMapNode[]
  readonly edges: readonly NetEchoMapEdge[]
}

export interface NetEchoPrimaryReference {
  readonly appId: string
  readonly resourceKind: string
  readonly resourceId: string
}

export interface NetEchoSignalSource {
  readonly accountId?: string
  readonly handle?: string
  readonly displayName?: string
  readonly avatarUrl?: string
  readonly label?: string
}

export interface NetEchoSignalDetail {
  readonly id: string
  readonly kind: NetEchoSignalKind
  readonly title: string
  readonly summary?: string
  readonly body: string
  readonly reliability: NetEchoReliability
  readonly intensity: NetEchoIntensity
  readonly frequencies: readonly string[]
  readonly mapX: number
  readonly mapY: number
  readonly integrityPercent?: number
  readonly source?: NetEchoSignalSource
  readonly locationLabel?: string
  readonly districtLabel?: string
  readonly occurredAt?: string
  readonly primaryReference?: NetEchoPrimaryReference
  readonly revealedAt: string
  readonly viewerDiscovered: true
  readonly viewerSaved: boolean
}

export interface NetEchoSaveResult {
  readonly signalId: string
  readonly viewerSaved: boolean
  readonly savedAt?: string
}

export interface NetEchoGmSignalDirectoryRow {
  readonly id: string
  readonly title: string
  readonly kind: NetEchoSignalKind
  readonly status: NetEchoSignalStatus
  readonly visibilityMode: NetEchoVisibilityMode
  readonly reliability: NetEchoReliability
  readonly intensity: NetEchoIntensity
  readonly mapX: number
  readonly mapY: number
  readonly lockedTeaser?: string
  readonly linkCount: number
  /** Outgoing `requires` links: this signal's direct prerequisites. */
  readonly requiresCount: number
  readonly updatedAt: string
  readonly revealedAt?: string
}

export interface NetEchoGmSignalLink {
  readonly fromSignalId: string
  readonly toSignalId: string
  readonly relationshipKind: NetEchoRelationshipKind
  readonly label?: string
  readonly createdAt: string
}

export interface NetEchoGmSignalInput {
  readonly kind: NetEchoSignalKind
  readonly visibilityMode: NetEchoVisibilityMode
  readonly title: string
  readonly summary?: string
  readonly body: string
  readonly reliability: NetEchoReliability
  readonly intensity: NetEchoIntensity
  readonly frequencies: readonly string[]
  readonly mapX: number
  readonly mapY: number
  readonly integrityPercent?: number
  readonly lockedTeaser?: string
  readonly sourceAccountId?: string
  readonly sourceLabel?: string
  readonly locationLabel?: string
  readonly districtLabel?: string
  readonly occurredAt?: string
  readonly primaryReference?: NetEchoPrimaryReference
}

export interface NetEchoGmSignalDetail extends NetEchoGmSignalInput {
  readonly id: string
  readonly status: NetEchoSignalStatus
  readonly createdAt: string
  readonly updatedAt: string
  readonly revealedAt?: string
  readonly links: readonly NetEchoGmSignalLink[]
}

export interface NetEchoGmGrantTarget {
  readonly accountId: string
  readonly handle: string
  readonly displayName: string
  readonly avatarUrl?: string
  readonly subjectKind: string
  readonly subjectId: string
  readonly granted: boolean
}

export interface NetEchoGmGrantResult {
  readonly signalId: string
  readonly accountId: string
  readonly granted: boolean
}

export class NetEchoPrerequisiteRequiredError extends Error {
  constructor() {
    super('Add at least one prerequisite before revealing this signal.')
    this.name = 'NetEchoPrerequisiteRequiredError'
  }
}

export function isNetEchoPrerequisiteRequiredError(
  error: unknown,
): error is NetEchoPrerequisiteRequiredError {
  return error instanceof NetEchoPrerequisiteRequiredError
}

export class NetEchoContextChangedError extends Error {
  constructor() {
    super('Character changed before this ECHO request completed.')
    this.name = 'NetEchoContextChangedError'
  }
}

export function isNetEchoContextChangedError(
  error: unknown,
): error is NetEchoContextChangedError {
  return error instanceof NetEchoContextChangedError
}
