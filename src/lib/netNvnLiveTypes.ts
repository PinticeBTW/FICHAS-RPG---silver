import type { NetNvnCategory } from './netNvnTypes'

export const NET_NVN_LIVE_DIRECTORY_MAX_LIMIT = 100
export const NET_NVN_LIVE_UPDATE_MAX_ITEMS = 100
export const NET_NVN_LIVE_HEADLINE_MAX_LENGTH = 180
export const NET_NVN_LIVE_SUMMARY_MAX_LENGTH = 600
export const NET_NVN_LIVE_BYLINE_MAX_LENGTH = 100
export const NET_NVN_LIVE_LOCATION_MAX_LENGTH = 120
export const NET_NVN_LIVE_UPDATE_BODY_MAX_LENGTH = 1200

export const netNvnIncidentStatuses = ['draft', 'live', 'closed', 'archived'] as const
export const netNvnIncidentVerificationStatuses = [
  'developing',
  'verified',
  'multiple-sources',
  'official-statement',
  'unconfirmed',
] as const
export const netNvnIncidentUpdateKinds = [
  'update',
  'confirmation',
  'warning',
  'correction',
] as const
export const netNvnIncidentUpdateVerificationStatuses = [
  'confirmed',
  'developing',
  'unconfirmed',
] as const
export const netNvnIncidentLifecycleActions = ['start', 'close', 'archive', 'restore'] as const

export type NetNvnIncidentStatus = typeof netNvnIncidentStatuses[number]
export type NetNvnIncidentVerificationStatus =
  typeof netNvnIncidentVerificationStatuses[number]
export type NetNvnIncidentUpdateKind = typeof netNvnIncidentUpdateKinds[number]
export type NetNvnIncidentUpdateVerificationStatus =
  typeof netNvnIncidentUpdateVerificationStatuses[number]
export type NetNvnIncidentLifecycleAction = typeof netNvnIncidentLifecycleActions[number]
export type NetNvnIncidentDirectoryFilter = 'all' | NetNvnIncidentStatus

export interface NetNvnIncidentUpdate {
  readonly id: string
  readonly sequence: number
  readonly updateKind: NetNvnIncidentUpdateKind
  readonly verificationStatus: NetNvnIncidentUpdateVerificationStatus
  readonly body: string
  readonly publishedAt: string
}

export interface NetNvnLiveIncident {
  readonly id: string
  readonly headline: string
  readonly summary?: string
  readonly category: NetNvnCategory
  readonly verificationStatus: NetNvnIncidentVerificationStatus
  readonly bylineName: string
  readonly bylineRole?: string
  readonly districtLabel?: string
  readonly locationLabel?: string
  readonly occurredAt?: string
  readonly startedAt: string
  readonly updatedAt: string
}

export interface NetNvnLiveDesk {
  readonly incident: NetNvnLiveIncident | null
  readonly updates: readonly NetNvnIncidentUpdate[]
}

export interface NetNvnGmIncidentInput {
  readonly headline: string
  readonly summary?: string
  readonly category: NetNvnCategory
  readonly verificationStatus: NetNvnIncidentVerificationStatus
  readonly bylineName: string
  readonly bylineRole?: string
  readonly districtLabel?: string
  readonly locationLabel?: string
  readonly occurredAt?: string
}

export interface NetNvnGmIncidentDirectoryRow {
  readonly id: string
  readonly status: NetNvnIncidentStatus
  readonly headline: string
  readonly category: NetNvnCategory
  readonly verificationStatus: NetNvnIncidentVerificationStatus
  readonly bylineName: string
  readonly updatedAt: string
  readonly startedAt?: string
  readonly closedAt?: string
  readonly archivedAt?: string
  readonly updateCount: number
}

export interface NetNvnGmIncidentDetail extends NetNvnGmIncidentInput {
  readonly id: string
  readonly status: NetNvnIncidentStatus
  readonly createdAt: string
  readonly updatedAt: string
  readonly startedAt?: string
  readonly closedAt?: string
  readonly archivedAt?: string
  readonly updates: readonly NetNvnIncidentUpdate[]
}

export interface NetNvnGmIncidentUpdateInput {
  readonly updateKind: NetNvnIncidentUpdateKind
  readonly verificationStatus: NetNvnIncidentUpdateVerificationStatus
  readonly body: string
}

export type NetNvnLiveRequestErrorCode =
  | 'authentication-required'
  | 'permission-denied'
  | 'incident-not-found'
  | 'live-desk-busy'
  | 'invalid-lifecycle'
  | 'update-limit'
  | 'invalid-input'
  | 'invalid-server-response'
  | 'request-failed'

export class NetNvnLiveRequestError extends Error {
  readonly code: NetNvnLiveRequestErrorCode

  constructor(code: NetNvnLiveRequestErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'NetNvnLiveRequestError'
    this.code = code
  }
}

export function isNetNvnLiveRequestError(error: unknown): error is NetNvnLiveRequestError {
  return error instanceof NetNvnLiveRequestError
}
