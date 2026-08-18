import { netDistricts } from './netDistricts'
import { netEntities } from './netEntities'
import { netEvents } from './netEvents'
import { netLocations } from './netLocations'
import { netOrganisations } from './netOrganisations'
import type {
  NetAppId,
  NetDistrict,
  NetDistrictId,
  NetEntity,
  NetEntityId,
  NetEvent,
  NetEventId,
  NetLocation,
  NetLocationId,
  NetOrganisation,
  NetOrganisationId,
} from './netWorldTypes'

export function getNetEntity(id: NetEntityId): NetEntity | undefined {
  return netEntities.find((entity) => entity.id === id)
}

export function getNetOrganisation(id: NetOrganisationId): NetOrganisation | undefined {
  return netOrganisations.find((organisation) => organisation.id === id)
}

export function getNetDistrict(id: NetDistrictId): NetDistrict | undefined {
  return netDistricts.find((district) => district.id === id)
}

export function getNetLocation(id: NetLocationId): NetLocation | undefined {
  return netLocations.find((location) => location.id === id)
}

export function getNetEvent(id: NetEventId): NetEvent | undefined {
  return netEvents.find((event) => event.id === id)
}

export function getEntityHandle(entityId: NetEntityId, appId: NetAppId): string | undefined {
  return getNetEntity(entityId)?.handlesByApp[appId]
}

export function getEntityOrganisations(entityId: NetEntityId): readonly NetOrganisation[] {
  const entity = getNetEntity(entityId)
  if (!entity) return []

  return entity.organisationIds
    .map((organisationId) => getNetOrganisation(organisationId))
    .filter((organisation): organisation is NetOrganisation => Boolean(organisation))
}

export function getLocationDistrict(locationId: NetLocationId): NetDistrict | undefined {
  const location = getNetLocation(locationId)
  return location ? getNetDistrict(location.districtId) : undefined
}

export function getEventParticipants(eventId: NetEventId) {
  const event = getNetEvent(eventId)
  if (!event) return undefined

  return {
    entities: event.participantEntityIds
      .map((entityId) => getNetEntity(entityId))
      .filter((entity): entity is NetEntity => Boolean(entity)),
    organisations: event.participantOrganisationIds
      .map((organisationId) => getNetOrganisation(organisationId))
      .filter((organisation): organisation is NetOrganisation => Boolean(organisation)),
  }
}

function collectDuplicateIds(
  label: string,
  records: readonly { readonly id: string }[],
  errors: string[],
) {
  const ids = new Set<string>()

  for (const record of records) {
    if (ids.has(record.id)) errors.push(`Duplicate ${label} id: ${record.id}`)
    ids.add(record.id)
  }
}

export function validateNetWorldData(): readonly string[] {
  const errors: string[] = []
  const entityIds = new Set<string>(netEntities.map((entity) => entity.id))
  const organisationIds = new Set<string>(netOrganisations.map((organisation) => organisation.id))
  const districtIds = new Set<string>(netDistricts.map((district) => district.id))
  const locationIds = new Set<string>(netLocations.map((location) => location.id))

  collectDuplicateIds('entity', netEntities, errors)
  collectDuplicateIds('organisation', netOrganisations, errors)
  collectDuplicateIds('district', netDistricts, errors)
  collectDuplicateIds('location', netLocations, errors)
  collectDuplicateIds('event', netEvents, errors)

  for (const entity of netEntities) {
    for (const organisationId of entity.organisationIds) {
      if (!organisationIds.has(organisationId)) {
        errors.push(`Entity ${entity.id} references unknown organisation: ${organisationId}`)
      }
    }

    if (entity.verificationAuthorityId && !organisationIds.has(entity.verificationAuthorityId)) {
      errors.push(`Entity ${entity.id} references unknown verification authority: ${entity.verificationAuthorityId}`)
    }

    if (entity.canonicalDistrictId && !districtIds.has(entity.canonicalDistrictId)) {
      errors.push(`Entity ${entity.id} references unknown district: ${entity.canonicalDistrictId}`)
    }
  }

  for (const location of netLocations) {
    if (!districtIds.has(location.districtId)) {
      errors.push(`Location ${location.id} references unknown district: ${location.districtId}`)
    }
  }

  for (const event of netEvents) {
    if (!districtIds.has(event.districtId)) {
      errors.push(`Event ${event.id} references unknown district: ${event.districtId}`)
    }

    if (event.locationId && !locationIds.has(event.locationId)) {
      errors.push(`Event ${event.id} references unknown location: ${event.locationId}`)
    }

    for (const entityId of event.participantEntityIds) {
      if (!entityIds.has(entityId)) {
        errors.push(`Event ${event.id} references unknown entity: ${entityId}`)
      }
    }

    for (const organisationId of event.participantOrganisationIds) {
      if (!organisationIds.has(organisationId)) {
        errors.push(`Event ${event.id} references unknown organisation: ${organisationId}`)
      }
    }
  }

  return errors
}
