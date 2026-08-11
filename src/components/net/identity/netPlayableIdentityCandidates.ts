import type { Character, Profile, WebSheetRecord } from '../../../types/domain'
import type {
  NetPlayableIdentityAccessKind,
  NetPlayableIdentityCandidate,
} from './netIdentityTypes'

type CandidateSheetFields = Pick<
  NetPlayableIdentityCandidate,
  'age' | 'avatarUrl' | 'city' | 'displayName' | 'displayNameSource' | 'gender' | 'occupation' | 'summaryStatus'
>

function readField(fieldData: Record<string, string> | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = fieldData?.[key]?.trim()
    if (value) return value
  }

  return undefined
}

/**
 * Mirrors the live PDF sheet vocabulary. FOTO2 is the current portrait zone;
 * FOTO is retained as the existing legacy fallback when it contains a value.
 */
export function extractNetSheetCandidateFields(
  sheet: Pick<WebSheetRecord, 'fieldData'> | null | undefined,
  fallbackDisplayName: string,
  summaryStatus: NetPlayableIdentityCandidate['summaryStatus'] = 'ready',
): CandidateSheetFields {
  if (summaryStatus !== 'ready') {
    return {
      displayName: 'SYNCING CHARACTER',
      displayNameSource: 'pending',
      summaryStatus,
    }
  }

  const fieldData = sheet?.fieldData
  const sheetDisplayName = readField(fieldData, 'NOME')

  return {
    displayName: sheetDisplayName ?? fallbackDisplayName,
    displayNameSource: sheetDisplayName ? 'sheet' : 'account-fallback',
    summaryStatus: 'ready',
    ...(readField(fieldData, 'FOTO2', 'FOTO') ? { avatarUrl: readField(fieldData, 'FOTO2', 'FOTO') } : {}),
    ...(readField(fieldData, 'IDADE') ? { age: readField(fieldData, 'IDADE') } : {}),
    ...(readField(fieldData, 'SEXO') ? { gender: readField(fieldData, 'SEXO') } : {}),
    ...(readField(fieldData, 'OCUPAÇÃO', 'OCUPACAO')
      ? { occupation: readField(fieldData, 'OCUPAÇÃO', 'OCUPACAO') }
      : {}),
    ...(readField(fieldData, 'CIDADE') ? { city: readField(fieldData, 'CIDADE') } : {}),
  }
}

export function createProfileSheetIdentityCandidate(
  profile: Pick<Profile, 'id' | 'displayName' | 'handle'>,
  sheet: Pick<WebSheetRecord, 'fieldData'> | null | undefined,
  accessKind: Extract<NetPlayableIdentityAccessKind, 'self-profile' | 'gm'> = 'self-profile',
  playability: NetPlayableIdentityCandidate['playability'] = 'confirmed',
  summaryStatus: NetPlayableIdentityCandidate['summaryStatus'] = 'ready',
): NetPlayableIdentityCandidate {
  return {
    subject: { kind: 'profile-sheet', profileId: profile.id },
    sourceKind: 'profile-sheet',
    ...extractNetSheetCandidateFields(sheet, profile.displayName, summaryStatus),
    ownerProfileId: profile.id,
    ownerDisplayName: profile.displayName,
    ...(profile.handle ? { ownerHandle: profile.handle } : {}),
    accessKind,
    playability,
  }
}

export function createNpcCardIdentityCandidate(
  profile: Pick<Profile, 'id' | 'displayName' | 'ownerProfileId' | 'ownerDisplayName'>,
  sheet: Pick<WebSheetRecord, 'fieldData'> | null | undefined,
  accessKind: Extract<NetPlayableIdentityAccessKind, 'owner' | 'shared' | 'gm'>,
  playability: NetPlayableIdentityCandidate['playability'],
  summaryStatus: NetPlayableIdentityCandidate['summaryStatus'] = 'ready',
): NetPlayableIdentityCandidate {
  return {
    subject: { kind: 'npc-card', npcCardId: profile.id },
    sourceKind: 'npc-card',
    ...extractNetSheetCandidateFields(sheet, profile.displayName, summaryStatus),
    ...(profile.ownerProfileId ? { ownerProfileId: profile.ownerProfileId } : {}),
    ...(profile.ownerDisplayName ? { ownerDisplayName: profile.ownerDisplayName } : {}),
    accessKind,
    playability,
  }
}

/** Campaign characters remain supported without making them the live workspace source. */
export function createCampaignCharacterIdentityCandidate(
  character: Pick<
    Character,
    'id' | 'campaignId' | 'ownerProfileId' | 'name' | 'alias' | 'portraitUrl'
  >,
  accessKind: Extract<NetPlayableIdentityAccessKind, 'owner' | 'gm'>,
  playability: NetPlayableIdentityCandidate['playability'] = 'candidate',
): NetPlayableIdentityCandidate {
  return {
    subject: { kind: 'character', characterId: character.id },
    sourceKind: 'character',
    displayName: character.name,
    displayNameSource: 'campaign',
    summaryStatus: 'ready',
    ...(character.portraitUrl ? { avatarUrl: character.portraitUrl } : {}),
    ...(character.alias ? { alias: character.alias } : {}),
    ownerProfileId: character.ownerProfileId,
    campaignId: character.campaignId,
    accessKind,
    playability,
  }
}
