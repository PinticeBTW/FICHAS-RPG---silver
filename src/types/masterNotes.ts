export const MASTER_NOTE_TYPES = [
  'note',
  'session',
  'npc',
  'location',
  'quest',
  'secret',
  'rule',
] as const

export type MasterNoteType = (typeof MASTER_NOTE_TYPES)[number]

export const MASTER_NOTE_VISIBILITIES = [
  'private',
  'all_players',
  'selected_players',
] as const

export type MasterNoteVisibility = (typeof MASTER_NOTE_VISIBILITIES)[number]

export type MasterNoteListItem = {
  id: string
  userId: string
  title: string
  noteType: MasterNoteType
  folderId: string | null
  tags: string[]
  visibility: MasterNoteVisibility
  isFavorite: boolean
  createdAt: string
  updatedAt: string
}

export type MasterNote = MasterNoteListItem & {
  content: string
}

export type MasterNoteFolder = {
  id: string
  userId: string
  name: string
  parentId: string | null
  createdAt: string
  updatedAt: string
}

export type MasterNoteRecipient = {
  id: string
  noteId: string
  ownerUserId: string
  recipientUserId: string
  createdAt: string
}

export type ShareableMasterNotePlayer = {
  profileId: string
  displayName: string
  email: string
  handle: string
  linkedUserId: string | null
  canReceiveSharedNotes: boolean
}
