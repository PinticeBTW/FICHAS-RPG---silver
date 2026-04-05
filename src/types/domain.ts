export type AppRole = 'gm' | 'player'
export type KarmaMode = 'blue' | 'red' | 'gray'
export type EditableCollectionKey =
  | 'skills'
  | 'abilities'
  | 'inventory'
  | 'cyberware'

export interface Campaign {
  id: string
  name: string
  codeName: string
  description: string
  timeline: string
  season: string
}

export interface Profile {
  id: string
  email: string
  displayName: string
  handle: string
  role: AppRole
  avatarUrl?: string
  activeCampaignId?: string
}

export interface CharacterStats {
  hpCurrent: number
  hpMax: number
  ramCurrent: number
  ramMax: number
  karma: number
  cyberpsychosis: number
  humanity: number
  armor: number
  initiative: number
  reflex: number
  tech: number
  cool: number
  body: number
  intelligence: number
  empathy: number
  luck: number
}

export interface SkillItem {
  id: string
  name: string
  category: string
  rating: number
  notes: string
}

export interface AbilityItem {
  id: string
  name: string
  cost: string
  effect: string
  source: string
  notes: string
}

export interface InventoryItem {
  id: string
  name: string
  category: string
  quantity: number
  equipped: boolean
  notes: string
}

export interface CyberwareItem {
  id: string
  slot: string
  name: string
  tier: string
  effect: string
  cost: string
  notes: string
  stability: number
}

export interface CharacterNotes {
  playerJournal: string
  gmIntel: string
  missionLog: string
}

export interface SheetValueItem {
  label: string
  value: string
}

export interface SheetAttackItem {
  name: string
  test: string
  damage: string
}

export interface SheetAbilityItem {
  name: string
  cost: string
  description: string
}

export interface SheetInventoryItem {
  name: string
  slots: string
}

export interface CharacterSheetData {
  source: string
  info: SheetValueItem[]
  resources: SheetValueItem[]
  attributes: SheetValueItem[]
  skills: SheetValueItem[]
  attacks: SheetAttackItem[]
  abilities: SheetAbilityItem[]
  inventory: SheetInventoryItem[]
}

export interface Character {
  id: string
  campaignId: string
  ownerProfileId: string
  ownerName: string
  ownerHandle: string
  name: string
  alias: string
  archetype: string
  biography: string
  portraitUrl: string
  statusLabel: string
  alignment: KarmaMode
  allowPlayerStatEdits: boolean
  updatedAt: string
  stats: CharacterStats
  skills: SkillItem[]
  abilities: AbilityItem[]
  inventory: InventoryItem[]
  cyberware: CyberwareItem[]
  notes: CharacterNotes
  sheet?: CharacterSheetData
}

export interface ActivityItem {
  id: string
  timestamp: string
  label: string
  detail: string
  tone: KarmaMode
}

export interface CampaignBundle {
  campaign: Campaign | null
  profiles: Profile[]
  characters: Character[]
  activity: ActivityItem[]
}

export interface PdfArchiveFile {
  id: string
  path: string
  name: string
  displayName: string
  size: number | null
  createdAt: string | null
  updatedAt: string | null
  viewers: PdfArchiveViewer[]
}

export interface PdfArchiveViewer {
  id: string
  email: string
  displayName: string
  handle: string
  role: AppRole
}

export interface WebSheetRecord {
  id: string
  profileId: string
  templateKey: string
  fieldData: Record<string, string>
  updatedAt: string
}

export interface AuthFormInput {
  email: string
  password: string
  displayName?: string
  handle?: string
}
