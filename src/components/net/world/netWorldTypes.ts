export type NetEntityId = string
export type NetOrganisationId = string
export type NetDistrictId = string
export type NetLocationId = string
export type NetEventId = string

export type NetAppId = 'pulse' | 'nvn' | 'loop'

export type NetEntityType =
  | 'person'
  | 'unresolved'
  | 'organisation'
  | 'authority'
  | 'service'

export type NetOrganisationType = 'corporation' | 'authority' | 'publisher'

export type NetDistrictType = 'district' | 'sector'

export type NetLocationType = 'rooftop' | 'transit-platform' | 'rail-spur'

export type NetEventStatus =
  | 'reported'
  | 'developing'
  | 'announced'
  | 'archived'

export interface NetEntity {
  readonly id: NetEntityId
  readonly type: NetEntityType
  readonly displayName: string
  readonly shortName?: string
  readonly aliases: readonly string[]
  readonly organisationIds: readonly NetOrganisationId[]
  readonly handlesByApp: Partial<Record<NetAppId, string>>
  readonly canonicalDistrictId?: NetDistrictId
  readonly verificationAuthorityId?: NetOrganisationId
}

export interface NetOrganisation {
  readonly id: NetOrganisationId
  readonly displayName: string
  readonly shortName?: string
  readonly type: NetOrganisationType
  readonly aliases: readonly string[]
  readonly parentOrganisationId?: NetOrganisationId
}

export interface NetDistrict {
  readonly id: NetDistrictId
  readonly displayName: string
  readonly aliases: readonly string[]
  readonly type?: NetDistrictType
}

export interface NetLocation {
  readonly id: NetLocationId
  readonly displayName: string
  readonly districtId: NetDistrictId
  readonly aliases: readonly string[]
  readonly type: NetLocationType
}

export interface NetEvent {
  readonly id: NetEventId
  readonly title: string
  readonly districtId: NetDistrictId
  readonly locationId?: NetLocationId
  readonly participantEntityIds: readonly NetEntityId[]
  readonly participantOrganisationIds: readonly NetOrganisationId[]
  readonly status: NetEventStatus
  readonly aliases: readonly string[]
  readonly topicTags: readonly string[]
}
