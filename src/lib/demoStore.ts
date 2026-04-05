import {
  APP_NAME,
  createEmptyNotes,
  createEmptyStats,
  defaultPortrait,
  seedCampaign,
  seedCharacters,
  seedProfiles,
} from './constants'
import { alignmentFromKarma, createActivityDetail } from './utils'
import type {
  AbilityItem,
  CampaignBundle,
  Character,
  CharacterNotes,
  CharacterStats,
  CyberwareItem,
  EditableCollectionKey,
  InventoryItem,
  Profile,
  SkillItem,
} from '../types/domain'

interface DemoState {
  campaign: CampaignBundle['campaign']
  profiles: Profile[]
  characters: Character[]
  activity: CampaignBundle['activity']
}

const STORE_KEY = `${APP_NAME.toLowerCase().replace(/\s+/g, '-')}-demo-store`
const SESSION_KEY = `${APP_NAME.toLowerCase().replace(/\s+/g, '-')}-demo-session`

function createInitialState(): DemoState {
  return structuredClone({
    campaign: seedCampaign,
    profiles: seedProfiles,
    characters: seedCharacters,
    activity: [
      createActivityDetail(
        'Log de missao atualizado',
        'O Silver registou um novo briefing no arquivo.',
        'gray',
      ),
      createActivityDetail(
        'Orion sinalizado',
        'A ficha do Orion entrou no arquivo principal da campanha.',
        'blue',
      ),
      createActivityDetail(
        'Jeff sincronizado',
        'A ficha do Jeff foi importada para o modo demo.',
        'red',
      ),
    ],
  })
}

function canUseStorage() {
  return typeof window !== 'undefined'
}

function readState() {
  if (!canUseStorage()) {
    return createInitialState()
  }

  const raw = window.localStorage.getItem(STORE_KEY)

  if (!raw) {
    const fresh = createInitialState()
    writeState(fresh)
    return fresh
  }

  return JSON.parse(raw) as DemoState
}

function writeState(state: DemoState) {
  if (!canUseStorage()) {
    return
  }

  window.localStorage.setItem(STORE_KEY, JSON.stringify(state))
}

function setSession(profileId: string | null) {
  if (!canUseStorage()) {
    return
  }

  if (profileId) {
    window.localStorage.setItem(SESSION_KEY, profileId)
    return
  }

  window.localStorage.removeItem(SESSION_KEY)
}

function getCollectionMap(
  kind: EditableCollectionKey,
): keyof Pick<Character, EditableCollectionKey> {
  return kind
}

function pushActivity(state: DemoState, label: string, detail: string, tone: Character['alignment']) {
  state.activity = [createActivityDetail(label, detail, tone), ...state.activity].slice(0, 12)
}

const collectionLabels: Record<EditableCollectionKey, { plural: string; singular: string }> = {
  skills: { plural: 'Pericias', singular: 'pericia' },
  abilities: { plural: 'Capacidades', singular: 'capacidade' },
  inventory: { plural: 'Inventario', singular: 'item' },
  cyberware: { plural: 'Cyberware', singular: 'implante' },
}

function findCharacter(state: DemoState, characterId: string) {
  const character = state.characters.find((entry) => entry.id === characterId)

  if (!character) {
    throw new Error('Personagem nao encontrada no modo demo.')
  }

  return character
}

function updateCharacterStamp(character: Character) {
  character.updatedAt = new Date().toISOString()
}

export function listDemoProfiles() {
  return readState().profiles
}

export function getDemoSessionProfile() {
  if (!canUseStorage()) {
    return null
  }

  const profileId = window.localStorage.getItem(SESSION_KEY)

  if (!profileId) {
    return null
  }

  return readState().profiles.find((profile) => profile.id === profileId) ?? null
}

export function signInDemo(email: string) {
  const state = readState()
  const profile = state.profiles.find(
    (entry) => entry.email.toLowerCase() === email.trim().toLowerCase(),
  )

  if (!profile) {
    const available = state.profiles.map((entry) => entry.displayName).join(', ')
    throw new Error(`No modo demo usa uma das contas disponiveis: ${available}.`)
  }

  setSession(profile.id)
  return profile
}

export function signUpDemo(input: {
  email: string
  displayName: string
  handle?: string
}) {
  const state = readState()
  const email = input.email.trim().toLowerCase()

  if (state.profiles.some((profile) => profile.email.toLowerCase() === email)) {
    throw new Error('Esse email ja existe no modo demo.')
  }

  const id = crypto.randomUUID()
  const displayName = input.displayName.trim() || 'Novo Jogador'
  const handle =
    input.handle?.trim() ||
    `@${displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`

  const profile: Profile = {
    id,
    email,
    displayName,
    handle,
    role: 'player',
    activeCampaignId: seedCampaign.id,
  }

  const character: Character = {
    id: `char-${id}`,
    campaignId: seedCampaign.id,
    ownerProfileId: id,
    ownerName: displayName,
    ownerHandle: handle,
    name: displayName,
    alias: displayName,
    archetype: 'Operativo',
    biography: 'Novo membro a entrar na rede com chrome instavel e muita ambicao.',
    portraitUrl: defaultPortrait,
    statusLabel: 'A aguardar calibracao',
    alignment: 'gray',
    allowPlayerStatEdits: false,
    updatedAt: new Date().toISOString(),
    stats: createEmptyStats(),
    skills: [],
    abilities: [],
    inventory: [],
    cyberware: [],
    notes: createEmptyNotes(),
  }

  state.profiles.push(profile)
  state.characters.push(character)
  pushActivity(state, 'Novo membro', `${displayName} entrou na campanha.`, 'gray')
  writeState(state)
  setSession(profile.id)

  return profile
}

export function signOutDemo() {
  setSession(null)
}

export function fetchDemoCampaignBundle(profile: Profile): CampaignBundle {
  const state = readState()

  return {
    campaign: state.campaign,
    profiles: state.profiles,
    characters:
      profile.role === 'gm'
        ? state.characters
        : state.characters.filter((character) => character.ownerProfileId === profile.id),
    activity: state.activity,
  }
}

export function saveDemoCharacterBasics(
  characterId: string,
  payload: Partial<
    Pick<
      Character,
      | 'name'
      | 'alias'
      | 'archetype'
      | 'biography'
      | 'portraitUrl'
      | 'statusLabel'
      | 'alignment'
      | 'allowPlayerStatEdits'
    >
  >,
) {
  const state = readState()
  const character = findCharacter(state, characterId)

  Object.assign(character, payload)
  updateCharacterStamp(character)
  pushActivity(
    state,
    'Perfil atualizado',
    `${character.alias} teve os dados base atualizados.`,
    character.alignment,
  )
  writeState(state)
}

export function saveDemoCharacterStats(characterId: string, payload: CharacterStats) {
  const state = readState()
  const character = findCharacter(state, characterId)
  character.stats = payload
  character.alignment = alignmentFromKarma(payload.karma)
  updateCharacterStamp(character)
  pushActivity(
    state,
    'Stats atualizados',
    `${character.alias} teve os valores revistos.`,
    character.alignment,
  )
  writeState(state)
}

export function saveDemoCharacterNotes(characterId: string, payload: CharacterNotes) {
  const state = readState()
  const character = findCharacter(state, characterId)
  character.notes = payload
  updateCharacterStamp(character)
  pushActivity(
    state,
    'Notas atualizadas',
    `${character.alias} tem novas notas no registo.`,
    character.alignment,
  )
  writeState(state)
}

export function saveDemoCollectionItem(
  kind: EditableCollectionKey,
  characterId: string,
  payload: SkillItem | AbilityItem | InventoryItem | CyberwareItem,
) {
  const state = readState()
  const character = findCharacter(state, characterId)
  const key = getCollectionMap(kind)
  const collection = character[key] as Array<
    SkillItem | AbilityItem | InventoryItem | CyberwareItem
  >
  const nextIndex = collection.findIndex((entry) => entry.id === payload.id)

  if (nextIndex >= 0) {
    collection[nextIndex] = payload
  } else {
    collection.push(payload)
  }

  updateCharacterStamp(character)
  pushActivity(
    state,
    `${collectionLabels[kind].plural} atualizadas`,
    `${character.alias} recebeu uma alteracao em ${collectionLabels[kind].singular}.`,
    character.alignment,
  )
  writeState(state)
}

export function deleteDemoCollectionItem(
  kind: EditableCollectionKey,
  characterId: string,
  itemId: string,
) {
  const state = readState()
  const character = findCharacter(state, characterId)

  switch (kind) {
    case 'skills':
      character.skills = character.skills.filter((entry) => entry.id !== itemId)
      break
    case 'abilities':
      character.abilities = character.abilities.filter((entry) => entry.id !== itemId)
      break
    case 'inventory':
      character.inventory = character.inventory.filter((entry) => entry.id !== itemId)
      break
    case 'cyberware':
      character.cyberware = character.cyberware.filter((entry) => entry.id !== itemId)
      break
  }

  updateCharacterStamp(character)
  pushActivity(
    state,
    `${collectionLabels[kind].plural} alteradas`,
    `${character.alias} removeu uma entrada de ${collectionLabels[kind].singular}.`,
    character.alignment,
  )
  writeState(state)
}
