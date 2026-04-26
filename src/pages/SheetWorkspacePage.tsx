import { ChevronDown, ChevronLeft, ChevronRight, Folder, FolderOpen, GripVertical, LogOut, Pencil, Plus, RefreshCcw, Save, Search, StickyNote, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { CyberwareCatalogManager } from '../components/character/CyberwareCatalogManager'
import { PdfSheetEditor } from '../components/character/PdfSheetEditor'
import { RelationsBoard } from '../components/character/RelationsBoard'
import { EmptyState } from '../components/common/EmptyState'
import { LoadingScreen } from '../components/common/LoadingScreen'
import { PlayerInboxPanel } from '../components/notes/PlayerMessagesPanel'
import { PlayerNotebookPanel } from '../components/notes/PlayerNotebookPanel'
import {
  SilverNotebook,
  type SilverBoardInsertRequest,
  type SilverBoardProfileSummary,
} from '../components/notes/SilverNotebook'
import { useAuth } from '../hooks/useAuth'
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning'
import { formatTimestamp } from '../lib/utils'
import {
  createNpcCard,
  deleteNpcCard,
  fetchGlobalCyberwareCatalog,
  fetchSheetSnapshot,
  fetchNpcSheet,
  fetchOrCreateSheet,
  getCachedSheetRecord,
  isGlobalCyberwareCatalogUnavailableError,
  isNpcProfile,
  isSheetSharingUnavailableError,
  listSheetProfiles,
  listSheetShareViewerIds,
  loadGmGroups,
  saveGmGroups,
  saveGlobalCyberwareCatalog,
  saveNpcSheet,
  saveSheetFields,
  subscribeToGlobalCyberwareCatalog,
  subscribeToNpcSheet,
  subscribeToSheetDirectory,
  subscribeToSheet,
  subscribeToSheetShareAccess,
  updateNpcCardDisplayName,
  updateProfileDisplayName,
  updateSheetShareAccess,
  type ProfileGroup,
} from '../lib/webSheetService'
import { CYBERWARE_CATALOG_FIELD_KEY } from '../lib/cyberwareSheetLayout'
import {
  PLAYER_MESSAGES_FIELD_KEY,
  buildPlayerInboxMessage,
  parsePlayerInboxMessages,
  serializePlayerInboxMessages,
  type SilverMessageRecipientOption,
} from '../lib/playerInbox'
import { parseRelationsData, stringifyRelationsData } from '../lib/relationsTypes'
import type { Profile, WebSheetRecord } from '../types/domain'

const UNSAVED_CHANGES_LEAVE_MESSAGE =
  'Tens alteracoes por guardar. Clica em Guardar antes de fechar para nao perderes o teu progresso.'
const SAVING_LEAVE_MESSAGE =
  'Ainda estamos a guardar a ficha. Espera um momento ou guarda antes de sair.'
const LOCAL_DRAFT_STORAGE_PREFIX = 'rpgsilver-sheet-draft:'
const GLOBAL_CYBERWARE_SETUP_MESSAGE =
  'Falta ativar o catalogo global de cyberware: corre supabase/global-cyberware-catalog.sql no Supabase SQL Editor.'
const SAVE_QUEUE_DELAY_MS = 1000
const KARMA_FIELD_ALIASES = ['KARMA', 'Karma', 'karma', 'K4rma', 'K4RMA'] as const
const RELATIONS_FIELD_KEY = 'RELATIONS_DATA'
const RELATIONS_FALLBACK_FIELD_KEYS = [
  'RELACOES_DATA',
  'RELACOES',
  'RELATIONS',
  'AMIZADES',
  'FRIENDS_DATA',
] as const

function serializeFieldData(fieldData: Record<string, string>) {
  return JSON.stringify(
    Object.keys(fieldData)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, fieldData[key] ?? '']),
  )
}

function serializeViewerIds(ids: string[]) {
  return JSON.stringify([...new Set(ids)].sort((left, right) => left.localeCompare(right)))
}

function serializeGroups(groups: ProfileGroup[]) {
  return JSON.stringify(
    groups.map((group) => ({
      id: group.id,
      name: group.name,
      profileIds: [...new Set(group.profileIds)].sort((left, right) => left.localeCompare(right)),
    })),
  )
}

function buildLocalDraftStorageKey(profileId: string) {
  return `${LOCAL_DRAFT_STORAGE_PREFIX}${profileId}`
}

function buildEmptyGlobalCyberwareCatalogRecord(): WebSheetRecord {
  return {
    id: 'global',
    profileId: 'global',
    templateKey: 'global-cyberware-v1',
    fieldData: {
      [CYBERWARE_CATALOG_FIELD_KEY]: '[]',
    },
    updatedAt: new Date().toISOString(),
  }
}

function extractBoardSheetProfileIds(pagesValue: string) {
  if (!pagesValue.trim()) {
    return []
  }

  try {
    const parsed = JSON.parse(pagesValue) as unknown

    if (!Array.isArray(parsed)) {
      return []
    }

    const profileIds = new Set<string>()

    for (const page of parsed) {
      if (!page || typeof page !== 'object' || Array.isArray(page)) {
        continue
      }

      const stickies = (page as { stickies?: unknown }).stickies

      if (!Array.isArray(stickies)) {
        continue
      }

      for (const sticky of stickies) {
        if (!sticky || typeof sticky !== 'object' || Array.isArray(sticky)) {
          continue
        }

        const entry = sticky as { kind?: unknown; linkedProfileId?: unknown }

        if (entry.kind === 'sheet' && typeof entry.linkedProfileId === 'string') {
          profileIds.add(entry.linkedProfileId)
        }
      }
    }

    return [...profileIds].sort((left, right) => left.localeCompare(right))
  } catch {
    return []
  }
}

function readLocalDraft(profileId: string) {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const rawDraft = window.sessionStorage.getItem(buildLocalDraftStorageKey(profileId))

    if (!rawDraft) {
      return null
    }

    const parsedDraft = JSON.parse(rawDraft) as unknown

    if (!parsedDraft || typeof parsedDraft !== 'object' || Array.isArray(parsedDraft)) {
      return null
    }

    return Object.fromEntries(
      Object.entries(parsedDraft as Record<string, unknown>).map(([fieldName, value]) => [
        fieldName,
        typeof value === 'string' ? value : value == null ? '' : String(value),
      ]),
    ) as Record<string, string>
  } catch {
    return null
  }
}

function writeLocalDraft(profileId: string, fieldData: Record<string, string>) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage.setItem(
      buildLocalDraftStorageKey(profileId),
      JSON.stringify(fieldData),
    )
  } catch {
    return
  }
}

function clearLocalDraft(profileId: string) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage.removeItem(buildLocalDraftStorageKey(profileId))
  } catch {
    return
  }
}

function getSaveErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  if (error && typeof error === 'object') {
    const candidate = error as {
      code?: string
      message?: string
      details?: string
      hint?: string
    }

    return [
      candidate.code,
      candidate.message,
      candidate.details,
      candidate.hint,
    ]
      .filter(Boolean)
      .join(' ')
  }

  return ''
}

function buildSaveErrorMessage(error: unknown, profileToSave: Profile) {
  const rawMessage = getSaveErrorMessage(error)
  const normalizedMessage = rawMessage.toLowerCase()

  if (normalizedMessage.includes('57014') || normalizedMessage.includes('statement timeout')) {
    return [
      rawMessage || 'O Supabase demorou demasiado a guardar esta ficha.',
      'Tenta guardar outra vez. Se voltar a acontecer, remove logos/imagens muito pesadas desta ficha.',
    ].join(' ')
  }

  if (isNpcProfile(profileToSave)) {
    const looksLikePolicyError =
      normalizedMessage.includes('row-level security') ||
      normalizedMessage.includes('permission denied') ||
      normalizedMessage.includes('owner_profile_id') ||
      normalizedMessage.includes('42501')

    if (!looksLikePolicyError) {
      return rawMessage || 'O Supabase recusou guardar esta ficha extra.'
    }

    return [
      rawMessage || 'O Supabase recusou guardar esta ficha extra.',
      'Falta ativar o dono/policy desta ficha: corre supabase/own-extra-player-sheets.sql no Supabase SQL Editor.',
    ].join(' ')
  }

  return rawMessage || 'Nao foi possivel guardar a ficha.'
}

function readSheetField(fieldData: Record<string, string> | undefined, ...keys: string[]) {
  if (!fieldData) {
    return ''
  }

  for (const key of keys) {
    const value = fieldData[key]

    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return ''
}

function isKarmaFieldAlias(fieldName: string) {
  return KARMA_FIELD_ALIASES.includes(fieldName as (typeof KARMA_FIELD_ALIASES)[number])
}

function resolveKarmaTone(fieldData: Record<string, string>) {
  const raw = readSheetField(fieldData, ...KARMA_FIELD_ALIASES)
  const compact = raw.normalize('NFKC').trim().replace(/\s+/g, '')

  if (!compact) {
    return 'grey' as const
  }

  if (/[+\uFF0B\uFE62]/u.test(compact)) {
    return 'blue' as const
  }

  return 'red' as const
}

function parseLegacyRelationsData(raw: string | undefined) {
  if (!raw || !raw.trim()) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as unknown

    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      'groups' in parsed &&
      'npcs' in parsed &&
      Array.isArray((parsed as { groups: unknown }).groups) &&
      Array.isArray((parsed as { npcs: unknown }).npcs)
    ) {
      return parseRelationsData(raw)
    }
  } catch {
    return null
  }

  return null
}

function resolveRelationsFieldKey(fieldData: Record<string, string>) {
  if (parseLegacyRelationsData(fieldData[RELATIONS_FIELD_KEY])) {
    return RELATIONS_FIELD_KEY
  }

  for (const key of RELATIONS_FALLBACK_FIELD_KEYS) {
    if (parseLegacyRelationsData(fieldData[key])) {
      return key
    }
  }

  for (const [key, value] of Object.entries(fieldData)) {
    if (key === CYBERWARE_CATALOG_FIELD_KEY) {
      continue
    }

    const parsed = parseLegacyRelationsData(value)
    if (parsed && parsed.npcs.length) {
      return key
    }
  }

  return RELATIONS_FIELD_KEY
}

function isPlayerOwnedNpcProfile(profile: Profile) {
  return isNpcProfile(profile) && Boolean(profile.ownerProfileId)
}

function getOwnedNpcSheetLabel(profile: Profile) {
  return profile.ownerSheetNumber ? `Personagem ${profile.ownerSheetNumber}` : 'Personagem'
}

function getProfileTypeLabel(profile: Profile) {
  if (profile.role === 'gm') {
    return 'GM'
  }

  if (isPlayerOwnedNpcProfile(profile)) {
    return getOwnedNpcSheetLabel(profile)
  }

  return isNpcProfile(profile) ? 'NPC' : 'Jogador'
}

function getProfileSecondaryLine(profile: Profile) {
  if (isPlayerOwnedNpcProfile(profile)) {
    const ownerLabel = profile.ownerDisplayName || profile.ownerEmail
    return ownerLabel ? `Personagem de ${ownerLabel}` : 'Personagem de player'
  }

  if (profile.sheetAccess === 'shared') {
    return 'Ficha partilhada pelo Silver'
  }

  return isNpcProfile(profile) ? 'NPC' : profile.email
}

function buildBoardProfileSummary(
  profile: Profile,
  sheet: WebSheetRecord | null | undefined,
): SilverBoardProfileSummary {
  const fieldData = sheet?.fieldData
  const subtitle = getProfileTypeLabel(profile)

  return {
    profileId: profile.id,
    displayName: readSheetField(fieldData, 'NOME') || profile.displayName,
    subtitle,
    hpCurrent: readSheetField(fieldData, 'PV-ATUAL'),
    hpMax: readSheetField(fieldData, 'PV'),
    psCurrent: readSheetField(fieldData, 'PS-ATUAL'),
    psMax: readSheetField(fieldData, 'PS'),
    peCurrent: readSheetField(fieldData, 'PE-ATUAL'),
    peMax: readSheetField(fieldData, 'PE'),
    defense: readSheetField(fieldData, 'DEFESA'),
    block: readSheetField(fieldData, 'BLOQUEIO'),
    karma: readSheetField(fieldData, 'KARMA'),
    updatedAt: sheet?.updatedAt ?? '',
  }
}

function resolveDefaultAccessibleProfile(viewer: Profile | null, entries: Profile[]) {
  if (!viewer || viewer.role === 'gm') {
    return entries[0] ?? null
  }

  return (
    entries.find((entry) => entry.sheetAccess === 'owner' && isNpcProfile(entry)) ??
    entries.find((entry) => entry.sheetAccess === 'shared' && isNpcProfile(entry)) ??
    entries[0] ??
    null
  )
}

function ProfileCard({
  entry,
  selected,
  isGm,
  groups,
  openMoveDropdown,
  onNavigate,
  onToggleDropdown,
  onToggleGroup,
  onRemoveFromAll,
  renaming,
  renameValue,
  renameSaving,
  onStartRename,
  onRenameChange,
  onSaveRename,
  onCancelRename,
  onDeleteNpc,
  onPinToBoard,
}: {
  entry: Profile
  selected: boolean
  isGm: boolean
  groups: ProfileGroup[]
  openMoveDropdown: string | null
  onNavigate: () => void
  onToggleDropdown: () => void
  onToggleGroup: (groupId: string) => void
  onRemoveFromAll: () => void
  renaming: boolean
  renameValue: string
  renameSaving: boolean
  onStartRename: () => void
  onRenameChange: (value: string) => void
  onSaveRename: () => void
  onCancelRename: () => void
  onDeleteNpc?: () => void
  onPinToBoard?: () => void
}) {
  const isNpc = entry.email.startsWith('npc:')
  const assignedGroupIds = new Set(groups.filter((g) => g.profileIds.includes(entry.id)).map((g) => g.id))
  const isInAnyGroup = assignedGroupIds.size > 0
  const accessLabel = getProfileTypeLabel(entry)
  const secondaryLine = getProfileSecondaryLine(entry)

  return (
    <div className="group/card relative">
      <button
        type="button"
        onClick={onNavigate}
        className={`w-full border px-4 py-3 text-left transition ${
          selected
            ? 'border-[#f3e600] bg-[#f3e600]/10'
            : 'border-white/10 bg-black/25 hover:border-white/20'
        }`}
      >
        <p className="truncate pr-6 text-sm font-semibold text-white">{entry.displayName}</p>
        <p className="mt-1 truncate text-xs text-stone-400">{secondaryLine}</p>
        <p className="mt-2 text-[0.68rem] uppercase tracking-[0.22em] text-stone-500">
          {accessLabel}
        </p>
      </button>

      {/* Folder toggle button */}
      {isGm && groups.length > 0 && (
        <div className="absolute right-1.5 top-1.5 flex items-center gap-1">
          {onPinToBoard ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onPinToBoard() }}
              className="p-1 text-stone-600 transition hover:text-[#f3e600]"
              title="Meter no quadro"
            >
              <StickyNote size={11} />
            </button>
          ) : null}

          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onStartRename() }}
            className="p-1 text-stone-600 transition hover:text-stone-300"
            title="Mudar nome"
          >
            <Pencil size={11} />
          </button>

          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleDropdown() }}
            className="p-1 text-stone-600 transition hover:text-stone-300"
            title="Pastas"
          >
            <Folder size={11} />
          </button>

          {openMoveDropdown === entry.id && (
            <div className="absolute right-0 top-full z-10 mt-1 min-w-[150px] border border-white/15 bg-[#111] py-1 shadow-lg">
              {groups.map((g) => {
                const inGroup = assignedGroupIds.has(g.id)
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onToggleGroup(g.id) }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition hover:bg-white/5 ${
                      inGroup ? 'text-[#f3e600]' : 'text-stone-300'
                    }`}
                  >
                    <span className={`text-[0.6rem] ${inGroup ? 'text-[#f3e600]' : 'text-stone-600'}`}>
                      {inGroup ? '✓' : '○'}
                    </span>
                    {g.name}
                  </button>
                )
              })}
              {isInAnyGroup && (
                <>
                  <div className="my-1 border-t border-white/10" />
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onRemoveFromAll() }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-stone-500 transition hover:bg-white/5 hover:text-stone-300"
                  >
                    <X size={11} />
                    Remover de todas
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {isGm && !groups.length ? (
        <div className="absolute right-1.5 top-1.5">
          <div className="flex items-center gap-1">
            {onPinToBoard ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onPinToBoard() }}
                className="p-1 text-stone-600 transition hover:text-[#f3e600]"
                title="Meter no quadro"
              >
                <StickyNote size={11} />
              </button>
            ) : null}

            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onStartRename() }}
              className="p-1 text-stone-600 transition hover:text-stone-300"
              title="Mudar nome"
            >
              <Pencil size={11} />
            </button>
          </div>
        </div>
      ) : null}

      {/* Delete NPC button */}
      {isGm && isNpc && onDeleteNpc && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDeleteNpc() }}
          className="absolute bottom-1.5 right-1.5 p-1 text-stone-700 opacity-0 transition hover:text-rose-400 group-hover/card:opacity-100"
          title="Apagar ficha"
        >
          <X size={11} />
        </button>
      )}

      {renaming ? (
        <div className="border-x border-b border-white/10 bg-black/35 px-3 py-2">
          <div className="flex items-center gap-1">
            <input
              autoFocus
              type="text"
              value={renameValue}
              onChange={(event) => onRenameChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  onSaveRename()
                }
                if (event.key === 'Escape') {
                  onCancelRename()
                }
              }}
              className="min-w-0 flex-1 border border-white/20 bg-black/40 px-2 py-1 text-xs text-white outline-none focus:border-[#f3e600]/50"
            />
            <button
              type="button"
              onClick={onSaveRename}
              disabled={renameSaving}
              className="signal-button px-2 py-1 text-xs"
            >
              <Save size={11} />
            </button>
            <button
              type="button"
              onClick={onCancelRename}
              className="signal-button px-2 py-1 text-xs"
              data-variant="ghost"
            >
              <X size={11} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function SheetWorkspacePage() {
  const { profileId } = useParams()
  const navigate = useNavigate()
  const { profile, signOut, updateDisplayName } = useAuth()
  const authProfileId = profile?.id ?? null
  const authProfileRole = profile?.role ?? null
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [sheet, setSheet] = useState<WebSheetRecord | null>(null)
  const [draftFields, setDraftFields] = useState<Record<string, string>>({})
  const [globalCyberwareCatalog, setGlobalCyberwareCatalog] = useState<WebSheetRecord | null>(null)
  const [globalCyberwareDraftFields, setGlobalCyberwareDraftFields] = useState<Record<string, string>>({})
  const [loadingProfiles, setLoadingProfiles] = useState(true)
  const [loadingSheet, setLoadingSheet] = useState(false)
  const [loadingGlobalCyberwareCatalog, setLoadingGlobalCyberwareCatalog] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingGlobalCyberwareCatalog, setSavingGlobalCyberwareCatalog] = useState(false)
  const [syncLabel, setSyncLabel] = useState('Guardar manual')
  const [error, setError] = useState<string | null>(null)
  const sheetRef = useRef<WebSheetRecord | null>(null)
  const draftFieldsRef = useRef<Record<string, string>>({})
  const profileRef = useRef<Profile | null>(null)
  const selectedProfileRef = useRef<Profile | null>(null)
  const accessibleProfilesRef = useRef<Profile[]>([])
  const isDirtyRef = useRef(false)
  const savingRef = useRef(false)
  const isGlobalCyberwareDirtyRef = useRef(false)
  const savingGlobalCyberwareCatalogRef = useRef(false)
  const queuedSaveRef = useRef(false)
  const directoryRefreshTimerRef = useRef<number | null>(null)
  const [groups, setGroups] = useState<ProfileGroup[]>([])
  const groupsLoadedRef = useRef(false)
  const groupsLastSavedSignatureRef = useRef('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [newGroupName, setNewGroupName] = useState('')
  const [addingGroup, setAddingGroup] = useState(false)
  const [openMoveDropdown, setOpenMoveDropdown] = useState<string | null>(null)
  const [confirmDeleteGroupId, setConfirmDeleteGroupId] = useState<string | null>(null)
  const [confirmDeleteNpcId, setConfirmDeleteNpcId] = useState<string | null>(null)
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null)
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    return parseInt(localStorage.getItem('sidebar-width') ?? '280', 10)
  })
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    return localStorage.getItem('sidebar-hidden') === '1'
  })
  const isResizingRef = useRef(false)
  const [newFichaName, setNewFichaName] = useState('')
  const [newFichaViewerId, setNewFichaViewerId] = useState('')
  const [addingFicha, setAddingFicha] = useState(false)
  const [creatingFicha, setCreatingFicha] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [renamingProfileId, setRenamingProfileId] = useState<string | null>(null)
  const [renamingValue, setRenamingValue] = useState('')
  const [renamingSaving, setRenamingSaving] = useState(false)
  const [boardSheetSnapshots, setBoardSheetSnapshots] = useState<Record<string, WebSheetRecord | null>>({})
  const [pendingBoardProfileCard, setPendingBoardProfileCard] =
    useState<SilverBoardInsertRequest | null>(null)
  const [profileSearchQuery, setProfileSearchQuery] = useState('')
  const [sendingPlayerMessage, setSendingPlayerMessage] = useState(false)
  const [playerMessageError, setPlayerMessageError] = useState<string | null>(null)
  const [shareViewerIds, setShareViewerIds] = useState<string[]>([])
  const [loadedShareViewerIds, setLoadedShareViewerIds] = useState<string[]>([])
  const [loadingShareAccess, setLoadingShareAccess] = useState(false)
  const [savingShareAccess, setSavingShareAccess] = useState(false)
  const [shareAccessError, setShareAccessError] = useState<string | null>(null)
  const [sheetSharingUnavailable, setSheetSharingUnavailable] = useState(false)
  const [gmWorkspaceView, setGmWorkspaceView] = useState<'sheet' | 'cyberware'>('sheet')

  const accessibleProfiles = useMemo(() => {
    if (!authProfileId) {
      return []
    }
    return profiles
  }, [authProfileId, profiles])
  const accessibleProfileIdsSignature = useMemo(
    () =>
      accessibleProfiles
        .map((entry) => entry.id)
        .sort((left, right) => left.localeCompare(right))
        .join('|'),
    [accessibleProfiles],
  )
  const boardLinkedProfileIdSignature = useMemo(
    () => extractBoardSheetProfileIds(draftFields.GM_NOTE_PAGES ?? '').join('|'),
    [draftFields.GM_NOTE_PAGES],
  )

  const selectedProfile =
    accessibleProfiles.find((entry) => entry.id === profileId) ??
    resolveDefaultAccessibleProfile(profile, accessibleProfiles)
  const selectedProfileId = selectedProfile?.id ?? null
  const isOwnSelectedProfile = Boolean(profile && selectedProfile && selectedProfile.id === profile.id)
  const isOwnerOfSelectedNpcProfile = Boolean(
    profile &&
    selectedProfile &&
    isNpcProfile(selectedProfile) &&
    selectedProfile.ownerProfileId === profile.id,
  )

  const isSilverWorkspace = Boolean(
    profile &&
    selectedProfile &&
    profile.role === 'gm' &&
    selectedProfile.id === profile.id &&
    selectedProfile.role === 'gm',
  )

  const canEditPlayerNpcSheet = Boolean(
    profile &&
    selectedProfile &&
    profile.role !== 'gm' &&
    (selectedProfile.sheetAccess === 'owner' || selectedProfile.sheetAccess === 'shared') &&
    isNpcProfile(selectedProfile),
  )
  const canEdit = Boolean(
    profile &&
    selectedProfile &&
    (profile.role === 'gm' || selectedProfile.id === profile.id || canEditPlayerNpcSheet),
  )
  const canManageCyberwareCatalog = profile?.role === 'gm'
  const canConfigureShareAccess = Boolean(
    profile &&
    selectedProfile &&
    profile.role === 'gm' &&
    selectedProfile.id !== profile.id,
  )
  const shareablePlayers = useMemo(
    () =>
      profiles.filter(
        (entry) =>
          entry.role !== 'gm' &&
          !isNpcProfile(entry) &&
          entry.id !== selectedProfile?.id,
      ),
    [profiles, selectedProfile?.id],
  )
  const newFichaPlayerOptions = useMemo(
    () =>
      profiles.filter(
        (entry) =>
          entry.role !== 'gm' &&
          !isNpcProfile(entry),
      ),
    [profiles],
  )
  const cyberwarePlayerOptions = useMemo(() => {
    return profiles
      .filter(
        (entry) =>
          entry.role !== 'gm' &&
          !isNpcProfile(entry),
      )
      .map((entry) => ({
        id: entry.id,
        label: entry.displayName,
        detail: entry.email,
      }))
  }, [profiles])
  const shareAccessDirty =
    serializeViewerIds(shareViewerIds) !== serializeViewerIds(loadedShareViewerIds)
  const normalizedProfileSearchQuery = profileSearchQuery.trim().toLowerCase()
  const filteredAccessibleProfiles = useMemo(() => {
    if (!normalizedProfileSearchQuery) {
      return accessibleProfiles
    }

    return accessibleProfiles.filter((entry) =>
      [
        entry.displayName,
        entry.email,
        entry.handle,
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedProfileSearchQuery),
    )
  }, [accessibleProfiles, normalizedProfileSearchQuery])
  const boardProfiles = useMemo(
    () =>
      accessibleProfiles.map((entry) => buildBoardProfileSummary(entry, boardSheetSnapshots[entry.id])),
    [accessibleProfiles, boardSheetSnapshots],
  )
  const boardProfileFieldData = useMemo(
    () =>
      Object.fromEntries(
        accessibleProfiles.map((entry) => [entry.id, boardSheetSnapshots[entry.id]?.fieldData ?? {}]),
      ) as Record<string, Record<string, string>>,
    [accessibleProfiles, boardSheetSnapshots],
  )
  const playerMessageRecipients = useMemo<SilverMessageRecipientOption[]>(() => {
    const players = accessibleProfiles.filter(
      (entry) => entry.role !== 'gm' && !isNpcProfile(entry),
    )

    if (!players.length) {
      return []
    }

    return [
      { id: '__all_players__', label: 'Todos os players' },
      ...players.map((entry) => ({
        id: entry.id,
        label: entry.displayName,
      })),
    ]
  }, [accessibleProfiles])
  const sheetSignature = useMemo(
    () => serializeFieldData(sheet?.fieldData ?? {}),
    [sheet],
  )
  const draftSignature = useMemo(
    () => serializeFieldData(draftFields),
    [draftFields],
  )
  const globalCyberwareCatalogSignature = useMemo(
    () => serializeFieldData(globalCyberwareCatalog?.fieldData ?? {}),
    [globalCyberwareCatalog],
  )
  const globalCyberwareDraftSignature = useMemo(
    () => serializeFieldData(globalCyberwareDraftFields),
    [globalCyberwareDraftFields],
  )
  const isDirty = sheet !== null && sheetSignature !== draftSignature
  const isGlobalCyberwareDirty =
    globalCyberwareCatalog !== null &&
    globalCyberwareCatalogSignature !== globalCyberwareDraftSignature
  const hasPendingUnsavedChanges =
    (canEdit && (isDirty || saving)) ||
    (canManageCyberwareCatalog && (isGlobalCyberwareDirty || savingGlobalCyberwareCatalog))
  const cyberwareViewerRole: 'gm' | 'owner' | 'shared' = profile?.role === 'gm'
    ? 'gm'
    : isOwnSelectedProfile || isOwnerOfSelectedNpcProfile
      ? 'owner'
      : 'shared'
  const showingCyberwareManager = canManageCyberwareCatalog && gmWorkspaceView === 'cyberware'
  const globalCyberwareCatalogValue =
    globalCyberwareDraftFields[CYBERWARE_CATALOG_FIELD_KEY] ??
    globalCyberwareCatalog?.fieldData[CYBERWARE_CATALOG_FIELD_KEY] ??
    '[]'
  const sheetEditorFieldData: Record<string, string> = useMemo(
    () => ({
      ...draftFields,
      [CYBERWARE_CATALOG_FIELD_KEY]: globalCyberwareCatalogValue,
    }),
    [draftFields, globalCyberwareCatalogValue],
  )
  const relationsFieldKey = useMemo(
    () => resolveRelationsFieldKey(sheetEditorFieldData),
    [sheetEditorFieldData],
  )
  const relationsData = useMemo(
    () => parseLegacyRelationsData(sheetEditorFieldData[relationsFieldKey]) ?? parseRelationsData(''),
    [relationsFieldKey, sheetEditorFieldData],
  )
  const relationsTone = useMemo(
    () => resolveKarmaTone(sheetEditorFieldData),
    [sheetEditorFieldData],
  )

  useUnsavedChangesWarning(
    hasPendingUnsavedChanges,
    saving || savingGlobalCyberwareCatalog
      ? SAVING_LEAVE_MESSAGE
      : UNSAVED_CHANGES_LEAVE_MESSAGE,
  )

  useEffect(() => {
    sheetRef.current = sheet
  }, [sheet])

  useEffect(() => {
    draftFieldsRef.current = draftFields
  }, [draftFields])

  useEffect(() => {
    profileRef.current = profile
  }, [profile])

  useEffect(() => {
    selectedProfileRef.current = selectedProfile
  }, [selectedProfile])

  useEffect(() => {
    accessibleProfilesRef.current = accessibleProfiles
  }, [accessibleProfiles])

  useEffect(() => {
    isDirtyRef.current = isDirty
  }, [isDirty])

  useEffect(() => {
    savingRef.current = saving
  }, [saving])

  useEffect(() => {
    isGlobalCyberwareDirtyRef.current = isGlobalCyberwareDirty
  }, [isGlobalCyberwareDirty])

  useEffect(() => {
    savingGlobalCyberwareCatalogRef.current = savingGlobalCyberwareCatalog
  }, [savingGlobalCyberwareCatalog])

  useEffect(() => {
    setPlayerMessageError(null)
  }, [selectedProfile?.id])

  useEffect(() => {
    setGmWorkspaceView('sheet')
  }, [authProfileId])

  const refreshProfiles = useCallback(async (options?: { showLoading?: boolean }) => {
    const activeProfile = profileRef.current

    if (!activeProfile) {
      return
    }

    const showLoading = options?.showLoading ?? true

    if (showLoading) {
      setLoadingProfiles(true)
    }

    setError(null)

    try {
      const nextProfiles = await listSheetProfiles(activeProfile)
      setProfiles(nextProfiles)
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : 'Nao foi possivel carregar as fichas do grupo.'
      setError(message)
    } finally {
      if (showLoading) {
        setLoadingProfiles(false)
      }
    }
  }, [])

  const scheduleProfilesRefresh = useCallback(() => {
    if (directoryRefreshTimerRef.current) {
      window.clearTimeout(directoryRefreshTimerRef.current)
    }

    directoryRefreshTimerRef.current = window.setTimeout(() => {
      directoryRefreshTimerRef.current = null
      void refreshProfiles({ showLoading: false })
    }, 1500)
  }, [refreshProfiles])

  useEffect(() => () => {
    if (directoryRefreshTimerRef.current) {
      window.clearTimeout(directoryRefreshTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!authProfileId) {
      return
    }

    void refreshProfiles()
  }, [authProfileId, refreshProfiles])

  useEffect(() => {
    if (!authProfileId) {
      setGlobalCyberwareCatalog(null)
      setGlobalCyberwareDraftFields({})
      return
    }

    let cancelled = false

    const loadGlobalCyberwareCatalog = async () => {
      setLoadingGlobalCyberwareCatalog(true)

      try {
        const nextCatalog = await fetchGlobalCyberwareCatalog()

        if (cancelled) {
          return
        }

        setGlobalCyberwareCatalog(nextCatalog)
        setGlobalCyberwareDraftFields(nextCatalog.fieldData)
      } catch (caughtError) {
        if (cancelled) {
          return
        }

        const fallbackCatalog = buildEmptyGlobalCyberwareCatalogRecord()
        setGlobalCyberwareCatalog(fallbackCatalog)
        setGlobalCyberwareDraftFields(fallbackCatalog.fieldData)
        setError(
          isGlobalCyberwareCatalogUnavailableError(caughtError)
            ? GLOBAL_CYBERWARE_SETUP_MESSAGE
            : caughtError instanceof Error
              ? caughtError.message
              : 'Nao foi possivel carregar o catalogo global de cyberware.',
        )
      } finally {
        if (!cancelled) {
          setLoadingGlobalCyberwareCatalog(false)
        }
      }
    }

    void loadGlobalCyberwareCatalog()

    return () => {
      cancelled = true
    }
  }, [authProfileId])

  useEffect(() => {
    if (!authProfileId) {
      return
    }

    const unsubscribeDirectory = subscribeToSheetDirectory(scheduleProfilesRefresh)
    const unsubscribeShareAccess = subscribeToSheetShareAccess(scheduleProfilesRefresh)

    return () => {
      if (directoryRefreshTimerRef.current) {
        window.clearTimeout(directoryRefreshTimerRef.current)
        directoryRefreshTimerRef.current = null
      }

      unsubscribeDirectory()
      unsubscribeShareAccess()
    }
  }, [authProfileId, scheduleProfilesRefresh])

  useEffect(() => {
    if (!authProfileId) {
      return
    }

    return subscribeToGlobalCyberwareCatalog((nextCatalog) => {
      setGlobalCyberwareCatalog(nextCatalog)
      setGlobalCyberwareDraftFields((current) => {
        if (savingGlobalCyberwareCatalogRef.current || isGlobalCyberwareDirtyRef.current) {
          return current
        }

        return nextCatalog.fieldData
      })
    })
  }, [authProfileId])

  useEffect(() => {
    if (!loadingProfiles && selectedProfile && selectedProfile.id !== profileId) {
      navigate(`/app/sheets/${selectedProfile.id}`, { replace: true })
    }
  }, [loadingProfiles, navigate, profileId, selectedProfile])

  useEffect(() => {
    if (!selectedProfileId) {
      setSheet(null)
      setDraftFields({})
      setSyncLabel('Guardar manual')
      return
    }

    let cancelled = false
    const activeProfile = selectedProfileRef.current

    if (!activeProfile || activeProfile.id !== selectedProfileId) {
      return
    }

    const cachedSheet = getCachedSheetRecord(selectedProfileId)
    const localDraft = canEdit ? readLocalDraft(selectedProfileId) : null
    const restoredLocalDraft = localDraft ? serializeFieldData(localDraft) !== serializeFieldData(cachedSheet?.fieldData ?? {}) : false

    const loadSheet = async () => {
      setError(null)

      if (cachedSheet) {
        setSheet(cachedSheet)
        setDraftFields(localDraft ?? cachedSheet.fieldData)
        setSyncLabel(restoredLocalDraft ? 'Rascunho local restaurado. Clica em Guardar.' : 'Ficha pronta')
        setLoadingSheet(false)
        return
      }

      setLoadingSheet(true)

      try {
        const nextSheet = isNpcProfile(activeProfile)
          ? await fetchNpcSheet(selectedProfileId)
          : canEdit
            ? await fetchOrCreateSheet(activeProfile)
            : await fetchSheetSnapshot(activeProfile)

        if (cancelled) {
          return
        }

        if (!nextSheet) {
          if (cachedSheet) {
            setSyncLabel('A mostrar a ultima versao guardada')
            return
          }

          setSheet(null)
          setDraftFields({})
          setSyncLabel('Ficha partilhada indisponivel')
          return
        }

        setSheet(nextSheet)
        setDraftFields(localDraft ?? nextSheet.fieldData)
        setSyncLabel(restoredLocalDraft ? 'Rascunho local restaurado. Clica em Guardar.' : 'Ficha pronta')
      } catch (caughtError) {
        if (cancelled) {
          return
        }

        if (cachedSheet) {
          setSyncLabel('A mostrar a ultima versao guardada')
          return
        }

        const message =
          caughtError instanceof Error
            ? caughtError.message
            : 'Nao foi possivel abrir a ficha web.'
        setError(message)
        setSheet(null)
        setDraftFields({})
      } finally {
        if (!cancelled && !cachedSheet) {
          setLoadingSheet(false)
        }
      }
    }

    void loadSheet()

    return () => {
      cancelled = true
    }
  }, [canEdit, selectedProfileId])

  useEffect(() => {
    if (!canEdit || !selectedProfileId || !sheet) {
      return
    }

    if (saving || isDirty) {
      writeLocalDraft(selectedProfileId, draftFields)
      return
    }

    clearLocalDraft(selectedProfileId)
  }, [canEdit, draftFields, isDirty, saving, selectedProfileId, sheet])

  useEffect(() => {
    if (!selectedProfileId) {
      return
    }

    const activeProfile = selectedProfileRef.current

    if (!activeProfile || activeProfile.id !== selectedProfileId) {
      return
    }

    const handleIncomingSheet = (nextSheet: WebSheetRecord) => {
      const nextSignature = serializeFieldData(nextSheet.fieldData)

      setSheet((current) => {
        if (
          current &&
          current.updatedAt === nextSheet.updatedAt &&
          serializeFieldData(current.fieldData) === nextSignature
        ) {
          return current
        }

        return nextSheet
      })

      setDraftFields((current) => {
        const currentSignature = serializeFieldData(current)
        const loadedSheetSignature = serializeFieldData(sheetRef.current?.fieldData ?? {})
        const hasLocalUnsavedChanges = currentSignature !== loadedSheetSignature

        if (currentSignature === nextSignature) {
          return current
        }

        if (savingRef.current || isDirtyRef.current || hasLocalUnsavedChanges) {
          return current
        }

        return nextSheet.fieldData
      })

      setSyncLabel(
        savingRef.current || isDirtyRef.current
          ? 'Alteracoes locais por guardar. Clica em Guardar.'
          : 'Atualizado em tempo real',
      )
    }

    const unsubscribe = isNpcProfile(activeProfile)
      ? subscribeToNpcSheet(selectedProfileId, handleIncomingSheet)
      : subscribeToSheet(selectedProfileId, handleIncomingSheet)

    return () => {
      unsubscribe()
    }
  }, [selectedProfileId])

  useEffect(() => {
    if (!isSilverWorkspace || !boardLinkedProfileIdSignature) {
      setBoardSheetSnapshots({})
      return
    }

    const linkedProfileIds = boardLinkedProfileIdSignature.split('|').filter(Boolean)
    const linkedProfiles = linkedProfileIds
      .map((profileId) =>
        accessibleProfilesRef.current.find((entry) => entry.id === profileId) ?? null,
      )
      .filter((entry): entry is Profile => Boolean(entry))

    if (!linkedProfiles.length) {
      setBoardSheetSnapshots({})
      return
    }

    let cancelled = false

    void Promise.all(
      linkedProfiles.map(async (entry) => {
        try {
          const snapshot = await fetchSheetSnapshot(entry, {
            preferCache: true,
          })
          return [entry.id, snapshot] as const
        } catch {
          return [entry.id, null] as const
        }
      }),
    ).then((entries) => {
      if (cancelled) {
        return
      }

      const fetchedSnapshots = Object.fromEntries(entries)

      setBoardSheetSnapshots((current) =>
        Object.fromEntries(
          linkedProfileIds.map((profileId) => {
            const currentSnapshot = current[profileId]
            const fetchedSnapshot = fetchedSnapshots[profileId] ?? null

            if (!currentSnapshot) {
              return [profileId, fetchedSnapshot]
            }

            if (!fetchedSnapshot) {
              return [profileId, currentSnapshot]
            }

            return [
              profileId,
              fetchedSnapshot.updatedAt >= currentSnapshot.updatedAt
                ? fetchedSnapshot
                : currentSnapshot,
            ]
          }),
        ),
      )
    })

    const unsubscribeCallbacks = linkedProfiles.map((entry) => {
      const subscribe = isNpcProfile(entry) ? subscribeToNpcSheet : subscribeToSheet

      return subscribe(entry.id, (nextSheet) => {
        setBoardSheetSnapshots((current) => ({
          ...current,
          [entry.id]: nextSheet,
        }))
      })
    })

    return () => {
      cancelled = true
      unsubscribeCallbacks.forEach((unsubscribe) => unsubscribe())
    }
  }, [accessibleProfileIdsSignature, boardLinkedProfileIdSignature, isSilverWorkspace])

  useEffect(() => {
    const targetProfile = selectedProfileRef.current

    if (!canConfigureShareAccess || !targetProfile) {
      setShareViewerIds([])
      setLoadedShareViewerIds([])
      setLoadingShareAccess(false)
      setShareAccessError(null)
      setSheetSharingUnavailable(false)
      return
    }

    let cancelled = false

    const loadShareAccess = async () => {
      setLoadingShareAccess(true)
      setShareAccessError(null)

      try {
        const nextViewerIds = await listSheetShareViewerIds(targetProfile)

        if (cancelled) {
          return
        }

        setSheetSharingUnavailable(false)
        setShareViewerIds(nextViewerIds)
        setLoadedShareViewerIds(nextViewerIds)
      } catch (caughtError) {
        if (cancelled) {
          return
        }

        if (isSheetSharingUnavailableError(caughtError)) {
          setSheetSharingUnavailable(true)
          setShareAccessError(null)
        } else {
          setShareAccessError(
            caughtError instanceof Error
              ? caughtError.message
              : 'Nao foi possivel carregar a partilha desta ficha.',
          )
        }
        setShareViewerIds([])
        setLoadedShareViewerIds([])
      } finally {
        if (!cancelled) {
          setLoadingShareAccess(false)
        }
      }
    }

    void loadShareAccess()

    return () => {
      cancelled = true
    }
  }, [canConfigureShareAccess, selectedProfile?.email, selectedProfile?.id])

  const queueBoardProfileCard = useCallback((profileId: string) => {
    setPendingBoardProfileCard({
      profileId,
      nonce: crypto.randomUUID(),
    })
  }, [])

  const handleSendPlayerMessage = useCallback(
    async (recipientId: string, title: string, body: string) => {
      if (!profile || !isSilverWorkspace) {
        return
      }

      const recipients =
        recipientId === '__all_players__'
          ? accessibleProfiles.filter((entry) => entry.role !== 'gm' && !isNpcProfile(entry))
          : accessibleProfiles.filter(
              (entry) =>
                entry.id === recipientId && entry.role !== 'gm' && !isNpcProfile(entry),
            )

      if (!recipients.length) {
        setPlayerMessageError('Nao encontrei nenhum player valido para receber essa mensagem.')
        return
      }

      setSendingPlayerMessage(true)
      setPlayerMessageError(null)

      try {
        const senderName = selectedProfile?.displayName || profile.displayName || 'Silver'

        const savedSheets = await Promise.all(
          recipients.map(async (recipient) => {
            const currentSheet = await fetchOrCreateSheet(recipient)
            const currentMessages = parsePlayerInboxMessages(
              currentSheet.fieldData[PLAYER_MESSAGES_FIELD_KEY] ?? '',
            )
            const nextMessage = buildPlayerInboxMessage({
              title,
              body,
              senderProfileId: profile.id,
              senderName,
            })
            const nextFieldData = {
              ...currentSheet.fieldData,
              [PLAYER_MESSAGES_FIELD_KEY]: serializePlayerInboxMessages([
                ...currentMessages,
                nextMessage,
              ]),
            }

            return saveSheetFields(recipient.id, nextFieldData)
          }),
        )

        setBoardSheetSnapshots((current) => {
          const nextSnapshots = { ...current }

          savedSheets.forEach((savedSheet) => {
            nextSnapshots[savedSheet.profileId] = savedSheet
          })

          return nextSnapshots
        })
      } catch (caughtError) {
        const message =
          caughtError instanceof Error
            ? caughtError.message
            : 'Nao foi possivel enviar a mensagem para os players.'
        setPlayerMessageError(message)
        throw caughtError
      } finally {
        setSendingPlayerMessage(false)
      }
    },
    [accessibleProfiles, isSilverWorkspace, profile, selectedProfile],
  )

  const handleSaveShareAccess = useCallback(async () => {
    if (!selectedProfile) {
      return
    }

    setSavingShareAccess(true)
    setShareAccessError(null)

    try {
      await updateSheetShareAccess(selectedProfile, shareViewerIds)
      setLoadedShareViewerIds(shareViewerIds)
      setSheetSharingUnavailable(false)
      await refreshProfiles()
    } catch (caughtError) {
      if (isSheetSharingUnavailableError(caughtError)) {
        setSheetSharingUnavailable(true)
        setShareAccessError(
          'A partilha ainda nao esta ativa no Supabase. Corre o ficheiro supabase/sheet-sharing.sql.',
        )
      } else {
        setShareAccessError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Nao foi possivel guardar a partilha desta ficha.',
        )
      }
    } finally {
      setSavingShareAccess(false)
    }
  }, [refreshProfiles, selectedProfile, shareViewerIds])

  const handleSave = useCallback(async () => {
    if (savingRef.current) {
      queuedSaveRef.current = true
      return
    }

    const profileToSave = selectedProfileRef.current
    const draftToSave = draftFieldsRef.current

    if (!profileToSave) {
      return
    }

    if (!isDirtyRef.current) {
      setSyncLabel('Sem alteracoes por guardar')
      return
    }

    const saveProfileId = profileToSave.id
    const draftSigAtSave = serializeFieldData(draftToSave)

    savingRef.current = true
    setSaving(true)
    setSyncLabel('A guardar...')
    setError(null)

    try {
      const savedSheet = isNpcProfile(profileToSave)
        ? await saveNpcSheet(profileToSave.id, draftToSave, {
            previousFieldData: sheetRef.current?.fieldData ?? null,
            currentUpdatedAt: sheetRef.current?.updatedAt ?? null,
          })
        : await saveSheetFields(profileToSave.id, draftToSave)
      const optimisticSavedSheet = {
        ...savedSheet,
        fieldData: draftToSave,
      }

      if (selectedProfileRef.current?.id === saveProfileId) {
        setSheet(optimisticSavedSheet)
        setDraftFields((current) => {
          const currentSig = serializeFieldData(current)

          // If user made changes during the save, preserve them
          if (currentSig !== draftSigAtSave) return current

          return current
        })
        setSyncLabel('Guardado manualmente')
      }

      if (serializeFieldData(draftFieldsRef.current) === draftSigAtSave) {
        clearLocalDraft(saveProfileId)
      }
    } catch (caughtError) {
      setError(buildSaveErrorMessage(caughtError, profileToSave))
      setSyncLabel('Falha ao guardar')
    } finally {
      savingRef.current = false
      setSaving(false)

      if (queuedSaveRef.current) {
        queuedSaveRef.current = false
        window.setTimeout(() => {
          void handleSave()
        }, SAVE_QUEUE_DELAY_MS)
      }
    }
  }, [])

  const handleSaveGlobalCyberwareCatalog = useCallback(async () => {
    if (!canManageCyberwareCatalog || savingGlobalCyberwareCatalog) {
      return
    }

    if (!isGlobalCyberwareDirty) {
      setSyncLabel('Sem alteracoes por guardar')
      return
    }

    setSavingGlobalCyberwareCatalog(true)
    setSyncLabel('A guardar catalogo...')
    setError(null)

    try {
      const savedCatalog = await saveGlobalCyberwareCatalog(globalCyberwareDraftFields)

      setGlobalCyberwareCatalog(savedCatalog)
      setGlobalCyberwareDraftFields(savedCatalog.fieldData)
      setSyncLabel('Catalogo guardado')
    } catch (caughtError) {
      setError(
        isGlobalCyberwareCatalogUnavailableError(caughtError)
          ? GLOBAL_CYBERWARE_SETUP_MESSAGE
          : caughtError instanceof Error
            ? caughtError.message
            : 'Nao foi possivel guardar o catalogo global de cyberware.',
      )
      setSyncLabel('Falha ao guardar')
    } finally {
      setSavingGlobalCyberwareCatalog(false)
    }
  }, [
    canManageCyberwareCatalog,
    globalCyberwareDraftFields,
    isGlobalCyberwareDirty,
    savingGlobalCyberwareCatalog,
  ])

  useEffect(() => {
    if (!canEdit || !selectedProfile || !sheet || !isDirty || saving) {
      return
    }

    setSyncLabel('Alteracoes por guardar. Clica em Guardar.')
  }, [canEdit, isDirty, saving, selectedProfile, sheet])

  useEffect(() => {
    if (!showingCyberwareManager || !isGlobalCyberwareDirty || savingGlobalCyberwareCatalog) {
      return
    }

    setSyncLabel('Catalogo com alteracoes. Clica em Guardar.')
  }, [isGlobalCyberwareDirty, savingGlobalCyberwareCatalog, showingCyberwareManager])

  // Carregar grupos do Supabase quando o GM entra
  useEffect(() => {
    if (!authProfileId || authProfileRole !== 'gm') return
    groupsLoadedRef.current = false
    void loadGmGroups(authProfileId).then((loaded) => {
      groupsLastSavedSignatureRef.current = serializeGroups(loaded)
      setGroups(loaded)
      groupsLoadedRef.current = true
    }).catch(() => { groupsLoadedRef.current = true })
  }, [authProfileId, authProfileRole])

  // Guardar grupos no Supabase apenas após o carregamento inicial
  useEffect(() => {
    if (!authProfileId || authProfileRole !== 'gm' || !groupsLoadedRef.current) return
    const nextSignature = serializeGroups(groups)

    if (nextSignature === groupsLastSavedSignatureRef.current) {
      return
    }

    const timer = window.setTimeout(() => {
      void saveGmGroups(authProfileId, groups)
        .then(() => {
          groupsLastSavedSignatureRef.current = nextSignature
        })
        .catch(() => {})
    }, 2000)

    return () => {
      window.clearTimeout(timer)
    }
  }, [groups, authProfileId, authProfileRole])

  useEffect(() => {
    if (!openMoveDropdown) return
    const close = () => setOpenMoveDropdown(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openMoveDropdown])

  const isGm = profile?.role === 'gm'

  const createGroup = useCallback((name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const id = crypto.randomUUID()
    setGroups((prev) => [...prev, { id, name: trimmed, profileIds: [] }])
    setExpandedGroups((prev) => new Set([...prev, id]))
    setNewGroupName('')
    setAddingGroup(false)
  }, [])

  const deleteGroup = useCallback((groupId: string) => {
    setGroups((prev) => prev.filter((g) => g.id !== groupId))
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      next.delete(groupId)
      return next
    })
    setConfirmDeleteGroupId(null)
  }, [])

  const reorderGroups = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return
    setGroups((prev) => {
      const next = [...prev]
      const fromIdx = next.findIndex((g) => g.id === fromId)
      const toIdx = next.findIndex((g) => g.id === toId)
      if (fromIdx === -1 || toIdx === -1) return prev
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      return next
    })
  }, [])

  const toggleProfileInGroup = useCallback((profileId: string, groupId: string) => {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g
        return {
          ...g,
          profileIds: g.profileIds.includes(profileId)
            ? g.profileIds.filter((id) => id !== profileId)
            : [...g.profileIds, profileId],
        }
      }),
    )
  }, [])

  const removeFromAllGroups = useCallback((profileId: string) => {
    setGroups((prev) =>
      prev.map((g) => ({ ...g, profileIds: g.profileIds.filter((id) => id !== profileId) })),
    )
    setOpenMoveDropdown(null)
  }, [])

  const handleDeleteNpc = useCallback(async (npcId: string) => {
    try {
      await deleteNpcCard(npcId)
      if (selectedProfile?.id === npcId) {
        navigate('/app/sheets', { replace: true })
      }
      removeFromAllGroups(npcId)
      await refreshProfiles()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao apagar ficha.')
    } finally {
      setConfirmDeleteNpcId(null)
    }
  }, [selectedProfile, navigate, removeFromAllGroups, refreshProfiles])

  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }, [])

  // Resizable sidebar
  useEffect(() => {
    localStorage.setItem('sidebar-width', String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    localStorage.setItem('sidebar-hidden', sidebarHidden ? '1' : '0')
  }, [sidebarHidden])

  const toggleSidebar = useCallback(() => {
    setSidebarHidden((current) => !current)
  }, [])

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 's' || !event.altKey || event.ctrlKey || event.metaKey) {
        return
      }

      event.preventDefault()
      setSidebarHidden((current) => !current)
    }

    window.addEventListener('keydown', handleKeydown)
    return () => {
      window.removeEventListener('keydown', handleKeydown)
    }
  }, [])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizingRef.current = true
    const startX = e.clientX
    const startWidth = sidebarWidth

    const onMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return
      const next = Math.min(500, Math.max(180, startWidth + ev.clientX - startX))
      setSidebarWidth(next)
    }
    const onUp = () => {
      isResizingRef.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [sidebarWidth])

  const handleStartCreateFicha = useCallback(() => {
    const defaultViewer =
      selectedProfile && selectedProfile.role !== 'gm' && !isNpcProfile(selectedProfile)
        ? selectedProfile
        : null

    setNewFichaViewerId(defaultViewer?.id ?? '')
    setNewFichaName(defaultViewer ? `${defaultViewer.displayName} - ficha extra` : '')
    setAddingFicha(true)
  }, [selectedProfile])

  const handleCancelCreateFicha = useCallback(() => {
    setAddingFicha(false)
    setNewFichaName('')
    setNewFichaViewerId('')
  }, [])

  // Nova Ficha (NPC)
  const handleCreateFicha = useCallback(async () => {
    const name = newFichaName.trim()
    if (!name) return
    const viewerId = newFichaViewerId.trim()
    setCreatingFicha(true)
    let shareWarning: string | null = null

    try {
      const newProfile = await createNpcCard(name, viewerId || undefined)

      if (viewerId) {
        try {
          await updateSheetShareAccess(newProfile, [viewerId])
        } catch (shareError) {
          shareWarning =
            shareError instanceof Error
              ? `Ficha criada, mas nao consegui atribuir ao player: ${shareError.message}`
              : 'Ficha criada, mas nao consegui atribuir ao player.'
        }
      }

      await refreshProfiles()
      navigate(`/app/sheets/${newProfile.id}`)
      setAddingFicha(false)
      setNewFichaName('')
      setNewFichaViewerId('')
      setError(shareWarning)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar ficha.')
    } finally {
      setCreatingFicha(false)
    }
  }, [newFichaName, newFichaViewerId, navigate, refreshProfiles])

  const handleSignOut = useCallback(async () => {
    if (hasPendingUnsavedChanges) {
      const shouldLeave = window.confirm(
        saving ? SAVING_LEAVE_MESSAGE : UNSAVED_CHANGES_LEAVE_MESSAGE,
      )

      if (!shouldLeave) {
        return
      }
    }

    await signOut()
    navigate('/', { replace: true })
  }, [hasPendingUnsavedChanges, navigate, saving, signOut])

  const applyProfileDisplayName = useCallback((targetProfileId: string, nextDisplayName: string) => {
    setProfiles((current) =>
      current.map((entry) =>
        entry.id === targetProfileId ? { ...entry, displayName: nextDisplayName } : entry,
      ),
    )
  }, [])

  const handlePlayerOwnRename = useCallback(async () => {
    const trimmed = nameInput.trim()

    if (!profile || !trimmed) {
      return
    }

    setError(null)

    try {
      await updateDisplayName(trimmed)
      applyProfileDisplayName(profile.id, trimmed)
      setEditingName(false)
      await refreshProfiles()
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Nao foi possivel mudar o teu nome.',
      )
    }
  }, [applyProfileDisplayName, nameInput, profile, refreshProfiles, updateDisplayName])

  const handleStartRename = useCallback((target: Profile) => {
    setOpenMoveDropdown(null)
    setRenamingProfileId(target.id)
    setRenamingValue(target.displayName)
  }, [])

  const handleCancelRename = useCallback(() => {
    setRenamingProfileId(null)
    setRenamingValue('')
    setRenamingSaving(false)
  }, [])

  const handleSaveRename = useCallback(async (target: Profile) => {
    const trimmed = renamingValue.trim()
    if (!trimmed) {
      return
    }

    setRenamingSaving(true)
    setError(null)

    try {
      if (isNpcProfile(target)) {
        await updateNpcCardDisplayName(target.id, trimmed)
      } else if (profile && target.id === profile.id) {
        await updateDisplayName(trimmed)
      } else {
        await updateProfileDisplayName(target.id, trimmed)
      }

      applyProfileDisplayName(target.id, trimmed)
      await refreshProfiles()
      setRenamingProfileId(null)
      setRenamingValue('')
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Nao foi possivel mudar o nome desta pessoa.',
        )
    } finally {
      setRenamingSaving(false)
    }
  }, [applyProfileDisplayName, profile, refreshProfiles, renamingValue, updateDisplayName])

  if (!profile) {
    return <Navigate to="/" replace />
  }

  if (loadingProfiles) {
    return <LoadingScreen label="A carregar fichas web..." />
  }

  if (!accessibleProfiles.length) {
    return (
      <EmptyState
        title="Sem fichas disponiveis"
        detail="Ainda nao ha utilizadores com ficha web preparada."
      />
    )
  }

  const activeSaving = showingCyberwareManager ? savingGlobalCyberwareCatalog : saving
  const activeSaveDisabled = activeSaving || (showingCyberwareManager ? !isGlobalCyberwareDirty : !isDirty)
  const activeUpdatedAt = showingCyberwareManager ? globalCyberwareCatalog?.updatedAt : sheet?.updatedAt

  return (
    <main className={isSilverWorkspace ? 'w-full min-w-0' : 'mx-auto w-full min-w-0 max-w-[2800px]'}>
      {error ? (
        <div className="mt-2 border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: sidebarHidden ? '1fr' : `${sidebarWidth}px 1fr` }}
      >
        {!sidebarHidden ? (
        <aside className="hud-panel relative rounded-[28px] p-4 self-start sticky top-2" style={{ maxHeight: 'calc(100vh - 16px)', overflowY: 'auto' }}>
          {/* Drag handle */}
          <div
            onMouseDown={handleResizeStart}
            className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 hover:opacity-100 hover:bg-white/20 transition-opacity"
            title="Arrastar para redimensionar"
          />
          {/* Estado da ficha + Sair — topo */}
          <div className="border border-white/10 bg-black/25 px-4 py-3">
            <p className="panel-title">Estado da ficha</p>
            <p className="mt-3 text-sm text-stone-200">{activeSaving ? 'A guardar...' : syncLabel}</p>
            <p className="mt-2 text-xs text-stone-500">
              Ultima gravacao:{' '}
              <span className="text-stone-300">
                {activeUpdatedAt ? formatTimestamp(activeUpdatedAt) : 'por criar'}
              </span>
            </p>
          </div>

          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="signal-button mt-2 inline-flex w-full items-center justify-center gap-2 px-3 py-2 text-xs"
            data-tone="danger"
          >
            <LogOut size={14} />
            Sair
          </button>

          <div className="mt-4 flex items-start justify-between gap-3">
            <div>
              <p className="panel-title">Operativos</p>
              <p className="mt-2 text-lg font-semibold text-white">
                {filteredAccessibleProfiles.length === accessibleProfiles.length
                  ? `${accessibleProfiles.length} ficha(s)`
                  : `${filteredAccessibleProfiles.length}/${accessibleProfiles.length} ficha(s)`}
              </p>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              {canManageCyberwareCatalog ? (
                <>
                  <button
                    type="button"
                    onClick={() => setGmWorkspaceView('sheet')}
                    className="signal-button inline-flex items-center gap-2 px-3 py-1.5 text-xs"
                    data-variant={gmWorkspaceView === 'sheet' ? undefined : 'ghost'}
                  >
                    Ficha
                  </button>

                  <button
                    type="button"
                    onClick={() => setGmWorkspaceView('cyberware')}
                    className="signal-button inline-flex items-center gap-2 px-3 py-1.5 text-xs"
                    data-variant={gmWorkspaceView === 'cyberware' ? undefined : 'ghost'}
                  >
                    Cyberware
                  </button>
                </>
              ) : null}

              <button
                type="button"
                onClick={() => void refreshProfiles()}
                className="signal-button inline-flex items-center gap-2 px-3 py-1.5 text-xs"
                data-variant="ghost"
                disabled={loadingProfiles || loadingSheet}
              >
                <RefreshCcw size={14} />
                Atualizar
              </button>

              {canEdit ? (
                <button
                  type="button"
                  onClick={() => {
                    if (showingCyberwareManager) {
                      void handleSaveGlobalCyberwareCatalog()
                    } else {
                      void handleSave()
                    }
                  }}
                  className="signal-button inline-flex items-center gap-2 px-3 py-1.5 text-xs"
                  disabled={activeSaveDisabled}
                >
                  <Save size={14} />
                  {activeSaving ? 'A guardar...' : 'Guardar'}
                </button>
              ) : null}
            </div>
          </div>

          {isGm ? (
            <div className="relative mt-3">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-500"
              />
              <input
                type="text"
                value={profileSearchQuery}
                onChange={(event) => setProfileSearchQuery(event.target.value)}
                placeholder="Pesquisar fichas, emails ou handles"
                className="w-full border border-white/10 bg-black/30 py-2 pl-9 pr-3 text-xs text-white outline-none focus:border-[#f3e600]/45"
              />
            </div>
          ) : null}

          <div className="mt-4 space-y-1">
            {!isGm && accessibleProfiles.length > 1 ? (
              <div className="mb-3 space-y-2">
                <p className="px-1 text-[0.62rem] uppercase tracking-[0.22em] text-stone-600">
                  Fichas acessiveis
                </p>

                {accessibleProfiles.map((entry) => {
                  const isSelected = entry.id === selectedProfile?.id
                  const isOwnEntry = entry.id === profile.id
                  const isAccessibleNpcEntry = isNpcProfile(entry) && (
                    entry.sheetAccess === 'owner' ||
                    entry.sheetAccess === 'shared'
                  )
                  const isOwnedExtraEntry =
                    isPlayerOwnedNpcProfile(entry) && entry.ownerProfileId === profile.id
                  const extraSheetLabel = getOwnedNpcSheetLabel(entry)

                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => navigate(`/app/sheets/${entry.id}`)}
                      className={`w-full border px-4 py-3 text-left transition ${
                        isSelected
                          ? 'border-[#f3e600] bg-[#f3e600]/10'
                          : 'border-white/10 bg-black/25 hover:border-white/20'
                      }`}
                    >
                      <p className="truncate text-sm font-semibold text-white">{entry.displayName}</p>
                      <p className="mt-1 truncate text-xs text-stone-400">
                        {isOwnEntry
                          ? entry.email
                          : isOwnedExtraEntry
                            ? `${extraSheetLabel} de ${profile.displayName}`
                            : isAccessibleNpcEntry
                              ? getProfileSecondaryLine(entry)
                            : 'Ficha partilhada pelo Silver'}
                      </p>
                      <p className="mt-2 text-[0.68rem] uppercase tracking-[0.22em] text-stone-500">
                        {isOwnEntry
                          ? 'Jogador'
                          : isOwnedExtraEntry
                            ? extraSheetLabel
                            : isAccessibleNpcEntry
                              ? getProfileTypeLabel(entry)
                              : 'Partilhada'}
                      </p>
                    </button>
                  )
                })}
              </div>
            ) : null}
            {/* Player: só o seu card */}
            {!isGm && selectedProfile && (isOwnSelectedProfile || canEditPlayerNpcSheet) && (
              <>
                {accessibleProfiles.length <= 1 ? (
                  <div className="border border-[#f3e600] bg-[#f3e600]/10 px-4 py-3">
                  {editingName ? (
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        type="text"
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            void handlePlayerOwnRename()
                          }
                          if (e.key === 'Escape') setEditingName(false)
                        }}
                        className="min-w-0 flex-1 border border-white/20 bg-black/40 px-2 py-1 text-xs text-white outline-none focus:border-[#f3e600]/50"
                      />
                      <button
                        type="button"
                        onClick={() => void handlePlayerOwnRename()}
                        className="signal-button px-2 py-1 text-xs"
                      >
                        <Save size={11} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingName(false)}
                        className="signal-button px-2 py-1 text-xs"
                        data-variant="ghost"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() => { setNameInput(selectedProfile.displayName); setEditingName(true) }}
                    >
                      <p className="truncate text-sm font-semibold text-white">{selectedProfile.displayName}</p>
                      <p className="mt-1 text-[0.62rem] text-stone-500">clica para mudar o nome</p>
                    </button>
                  )}
                  <p className="mt-2 truncate text-xs text-stone-400">{selectedProfile.email}</p>
                  <p className="mt-1 text-[0.68rem] uppercase tracking-[0.22em] text-stone-500">Jogador</p>
                  </div>
                ) : null}

                <PlayerNotebookPanel
                  value={draftFields.PLAYER_NOTES ?? ''}
                  pagesValue={draftFields.PLAYER_NOTE_PAGES ?? ''}
                  onChange={(value) => {
                    setDraftFields((current) => ({
                      ...current,
                      PLAYER_NOTES: value,
                    }))
                  }}
                  onPagesChange={(value) => {
                    setDraftFields((current) => ({
                      ...current,
                      PLAYER_NOTE_PAGES: value,
                    }))
                  }}
                  canEdit={canEdit}
                />

                <PlayerInboxPanel
                  value={draftFields[PLAYER_MESSAGES_FIELD_KEY] ?? ''}
                  onChange={(value) => {
                    setDraftFields((current) => ({
                      ...current,
                      [PLAYER_MESSAGES_FIELD_KEY]: value,
                    }))
                  }}
                  canEdit={canEdit}
                />
              </>
            )}

            {!isGm && selectedProfile && !isOwnSelectedProfile && !canEditPlayerNpcSheet ? (
              <div className="border border-sky-500/30 bg-sky-500/10 px-4 py-3">
                <p className="truncate text-sm font-semibold text-white">{selectedProfile.displayName}</p>
                <p className="mt-2 text-xs leading-6 text-stone-300">
                  {canEdit
                    ? 'Ficha extra partilhada pelo Silver. Podes editar e guardar no teu terminal.'
                    : 'Ficha partilhada pelo Silver. Esta vista aparece no teu terminal, mas fica em modo leitura.'}
                </p>
              </div>
            ) : null}

            {/* GM: nova ficha */}
            {isGm && (
              <div className="mb-3">
                {addingFicha ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        type="text"
                        value={newFichaName}
                        onChange={(e) => setNewFichaName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleCreateFicha()
                          if (e.key === 'Escape') handleCancelCreateFicha()
                        }}
                        placeholder="Nome da ficha..."
                        className="min-w-0 flex-1 border border-white/20 bg-black/40 px-2 py-1 text-xs text-white placeholder-stone-500 outline-none focus:border-[#f3e600]/50"
                      />
                      <button
                        type="button"
                        onClick={() => void handleCreateFicha()}
                        disabled={creatingFicha}
                        className="signal-button px-2 py-1 text-xs"
                      >
                        <Plus size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelCreateFicha}
                        className="signal-button px-2 py-1 text-xs"
                        data-variant="ghost"
                      >
                        <X size={12} />
                      </button>
                    </div>

                    {newFichaPlayerOptions.length > 0 ? (
                      <select
                        value={newFichaViewerId}
                        onChange={(event) => setNewFichaViewerId(event.target.value)}
                        className="w-full border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-stone-200 outline-none focus:border-[#f3e600]/50"
                        title="Atribuir ficha extra a um player"
                      >
                        <option value="">Sem atribuir a player</option>
                        {newFichaPlayerOptions.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.displayName} - {person.email}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleStartCreateFicha}
                    className="signal-button inline-flex w-full items-center justify-center gap-1.5 px-3 py-1.5 text-xs"
                  >
                    <Plus size={12} />
                    Nova Ficha
                  </button>
                )}
              </div>
            )}

            {/* GM: botão nova pasta */}
            {isGm && (
              <div className="mb-2">
                {addingGroup ? (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      type="text"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') createGroup(newGroupName)
                        if (e.key === 'Escape') { setAddingGroup(false); setNewGroupName('') }
                      }}
                      placeholder="Nome da pasta..."
                      className="min-w-0 flex-1 border border-white/20 bg-black/40 px-2 py-1 text-xs text-white placeholder-stone-500 outline-none focus:border-[#f3e600]/50"
                    />
                    <button
                      type="button"
                      onClick={() => createGroup(newGroupName)}
                      className="signal-button px-2 py-1 text-xs"
                    >
                      <Plus size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => { setAddingGroup(false); setNewGroupName('') }}
                      className="signal-button px-2 py-1 text-xs"
                      data-variant="ghost"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingGroup(true)}
                    className="signal-button inline-flex w-full items-center justify-center gap-1.5 px-3 py-1.5 text-xs"
                    data-variant="ghost"
                  >
                    <Plus size={12} />
                    Nova Pasta
                  </button>
                )}
              </div>
            )}

            {/* GM: secção fixa do próprio GM */}
            {isGm && profile && (() => {
              const gmEntry = filteredAccessibleProfiles.find((p) => p.id === profile.id)
              if (!gmEntry) return null
              return (
                <div className="mb-3">
                  <p className="mb-1 text-[0.62rem] uppercase tracking-[0.22em] text-stone-600">Mestre de Jogo</p>
                  <ProfileCard
                    entry={gmEntry}
                    selected={gmEntry.id === selectedProfile?.id}
                    isGm={isGm}
                    groups={groups}
                    openMoveDropdown={openMoveDropdown}
                    onNavigate={() => navigate(`/app/sheets/${gmEntry.id}`)}
                    onToggleDropdown={() => setOpenMoveDropdown((prev) => prev === gmEntry.id ? null : gmEntry.id)}
                    onToggleGroup={(gid) => toggleProfileInGroup(gmEntry.id, gid)}
                    onRemoveFromAll={() => removeFromAllGroups(gmEntry.id)}
                    renaming={renamingProfileId === gmEntry.id}
                    renameValue={renamingProfileId === gmEntry.id ? renamingValue : gmEntry.displayName}
                    renameSaving={renamingSaving && renamingProfileId === gmEntry.id}
                    onStartRename={() => handleStartRename(gmEntry)}
                    onRenameChange={setRenamingValue}
                    onSaveRename={() => void handleSaveRename(gmEntry)}
                    onCancelRename={handleCancelRename}
                    onPinToBoard={isSilverWorkspace ? () => queueBoardProfileCard(gmEntry.id) : undefined}
                  />
                </div>
              )
            })()}

            {/* GM: pastas e lista */}
            {isGm && groups.map((group) => {
              const isExpanded = expandedGroups.has(group.id)
              const membersInGroup = filteredAccessibleProfiles.filter((p) => group.profileIds.includes(p.id))
              const isConfirming = confirmDeleteGroupId === group.id
              const isDragOver = dragOverGroupId === group.id

              return (
                <div
                  key={group.id}
                  draggable={isGm}
                  onDragStart={() => { setDraggingGroupId(group.id) }}
                  onDragOver={(e) => { e.preventDefault(); setDragOverGroupId(group.id) }}
                  onDrop={() => {
                    if (draggingGroupId) reorderGroups(draggingGroupId, group.id)
                    setDraggingGroupId(null)
                    setDragOverGroupId(null)
                  }}
                  onDragEnd={() => { setDraggingGroupId(null); setDragOverGroupId(null) }}
                  className={`transition ${draggingGroupId === group.id ? 'opacity-40' : ''} ${isDragOver && draggingGroupId !== group.id ? 'border-t border-[#f3e600]/50' : 'border-t border-transparent'}`}
                >
                  <div className="group/folder flex items-center gap-1">
                    {isGm && (
                      <span className="shrink-0 cursor-grab p-1 text-stone-700 opacity-0 transition group-hover/folder:opacity-100 active:cursor-grabbing">
                        <GripVertical size={12} />
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.id)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 px-1 py-1.5 text-left text-[0.68rem] uppercase tracking-[0.18em] text-stone-400 hover:text-stone-200 transition"
                    >
                      {isExpanded ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
                      {isExpanded ? <FolderOpen size={12} className="shrink-0 text-[#f3e600]/70" /> : <Folder size={12} className="shrink-0 text-[#f3e600]/70" />}
                      <span className="truncate">{group.name}</span>
                      <span className="text-stone-600">({membersInGroup.length})</span>
                    </button>
                    {isGm && (
                      isConfirming ? (
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[0.6rem] text-rose-400">apagar?</span>
                          <button
                            type="button"
                            onClick={() => deleteGroup(group.id)}
                            className="px-1.5 py-0.5 text-[0.6rem] text-rose-400 border border-rose-500/40 hover:bg-rose-500/10 transition"
                          >
                            sim
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteGroupId(null)}
                            className="px-1.5 py-0.5 text-[0.6rem] text-stone-400 border border-white/10 hover:bg-white/5 transition"
                          >
                            não
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteGroupId(group.id)}
                          className="shrink-0 p-1 text-stone-600 opacity-0 transition hover:text-rose-400 group-hover/folder:opacity-100"
                          title="Apagar pasta"
                        >
                          <X size={11} />
                        </button>
                      )
                    )}
                  </div>

                  {isExpanded && (
                    <div className="ml-2 space-y-1 border-l border-white/10 pl-2">
                      {membersInGroup.length === 0 ? (
                        <p className="py-2 text-center text-[0.65rem] text-stone-600">Pasta vazia</p>
                      ) : (
                        membersInGroup.map((entry) => (
                          <ProfileCard
                            key={entry.id}
                            entry={entry}
                            selected={entry.id === selectedProfile?.id}
                            isGm={isGm}
                            groups={groups}
                            openMoveDropdown={openMoveDropdown}
                            onNavigate={() => navigate(`/app/sheets/${entry.id}`)}
                            onToggleDropdown={() => setOpenMoveDropdown((prev) => prev === entry.id ? null : entry.id)}
                            onToggleGroup={(gid) => toggleProfileInGroup(entry.id, gid)}
                            onRemoveFromAll={() => removeFromAllGroups(entry.id)}
                            renaming={renamingProfileId === entry.id}
                            renameValue={renamingProfileId === entry.id ? renamingValue : entry.displayName}
                            renameSaving={renamingSaving && renamingProfileId === entry.id}
                            onStartRename={() => handleStartRename(entry)}
                            onRenameChange={setRenamingValue}
                            onSaveRename={() => void handleSaveRename(entry)}
                            onCancelRename={handleCancelRename}
                            onDeleteNpc={entry.email.startsWith('npc:') ? () => setConfirmDeleteNpcId(entry.id) : undefined}
                            onPinToBoard={isSilverWorkspace ? () => queueBoardProfileCard(entry.id) : undefined}
                          />
                        ))
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {/* GM: profiles sem pasta (excluindo o próprio GM) */}
            {isGm && (() => {
              const assignedIds = new Set(groups.flatMap((g) => g.profileIds))
              const ungrouped = filteredAccessibleProfiles.filter((p) => !assignedIds.has(p.id) && p.id !== profile?.id)
              return ungrouped.map((entry) => (
                <ProfileCard
                  key={entry.id}
                  entry={entry}
                  selected={entry.id === selectedProfile?.id}
                  isGm={isGm}
                  groups={groups}
                  openMoveDropdown={openMoveDropdown}
                  onNavigate={() => navigate(`/app/sheets/${entry.id}`)}
                  onToggleDropdown={() => setOpenMoveDropdown((prev) => prev === entry.id ? null : entry.id)}
                  onToggleGroup={(gid) => toggleProfileInGroup(entry.id, gid)}
                  onRemoveFromAll={() => removeFromAllGroups(entry.id)}
                  renaming={renamingProfileId === entry.id}
                  renameValue={renamingProfileId === entry.id ? renamingValue : entry.displayName}
                  renameSaving={renamingSaving && renamingProfileId === entry.id}
                  onStartRename={() => handleStartRename(entry)}
                  onRenameChange={setRenamingValue}
                  onSaveRename={() => void handleSaveRename(entry)}
                  onCancelRename={handleCancelRename}
                  onDeleteNpc={entry.email.startsWith('npc:') ? () => setConfirmDeleteNpcId(entry.id) : undefined}
                  onPinToBoard={isSilverWorkspace ? () => queueBoardProfileCard(entry.id) : undefined}
                />
              ))
            })()}

            {isGm && filteredAccessibleProfiles.length === 0 ? (
              <div className="border border-dashed border-white/10 bg-black/20 px-4 py-4 text-xs leading-6 text-stone-500">
                Nenhuma ficha bate com essa pesquisa.
              </div>
            ) : null}
          </div>

        </aside>
        ) : null}

        <section className="relative min-w-0 space-y-4">
          <button
            type="button"
            onClick={toggleSidebar}
            className="signal-button absolute left-2 top-2 z-20 inline-flex items-center gap-2 px-3 py-2 text-xs"
            data-variant="ghost"
            title={sidebarHidden ? 'Mostrar sidebar (Alt+S)' : 'Esconder sidebar (Alt+S)'}
          >
            {sidebarHidden ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            <span className="hidden md:inline">
              {sidebarHidden ? 'Mostrar sidebar' : 'Esconder sidebar'}
            </span>
          </button>

          {showingCyberwareManager ? (
            loadingGlobalCyberwareCatalog ? (
              <LoadingScreen label="A abrir catalogo de cyberware..." />
            ) : (
              <CyberwareCatalogManager
                fieldData={globalCyberwareDraftFields}
                onFieldChange={(fieldName, value) => {
                  setGlobalCyberwareDraftFields((current) => ({
                    ...current,
                    [fieldName]: value,
                  }))
                }}
                playerOptions={cyberwarePlayerOptions}
              />
            )
          ) : loadingSheet || !selectedProfile ? (
            <LoadingScreen label="A abrir a ficha..." />
          ) : sheet ? (
            isSilverWorkspace ? (
              <SilverNotebook
                value={draftFields.GM_NOTES ?? ''}
                pagesValue={draftFields.GM_NOTE_PAGES ?? ''}
                remindersValue={draftFields.GM_REMINDERS ?? ''}
                workspaceStorageKey={selectedProfile.id}
                onQuickSave={() => void handleSave()}
                canQuickSave={isDirty}
                quickSaveBusy={saving}
                playerMessageRecipients={playerMessageRecipients}
                onSendPlayerMessage={handleSendPlayerMessage}
                sendingPlayerMessage={sendingPlayerMessage}
                playerMessageError={playerMessageError}
                boardProfiles={boardProfiles}
                boardProfileFieldData={boardProfileFieldData}
                pendingBoardProfileCard={pendingBoardProfileCard}
                onChange={(value) => {
                  setDraftFields((current) => ({
                    ...current,
                    GM_NOTES: value,
                  }))
                }}
                onPagesChange={(value) => {
                  setDraftFields((current) => ({
                    ...current,
                    GM_NOTE_PAGES: value,
                  }))
                }}
                onRemindersChange={(value) => {
                  setDraftFields((current) => ({
                    ...current,
                    GM_REMINDERS: value,
                  }))
                }}
                canEdit={canEdit}
              />
            ) : (
              <>
                <PdfSheetEditor
                  fieldData={sheetEditorFieldData}
                  onFieldChange={(fieldName, value) => {
                    setDraftFields((current) => {
                      if (!isKarmaFieldAlias(fieldName)) {
                        return {
                          ...current,
                          [fieldName]: value,
                        }
                      }

                      const next: Record<string, string> = {
                        ...current,
                        KARMA: value,
                      }

                      for (const alias of KARMA_FIELD_ALIASES) {
                        next[alias] = value
                      }

                      return next
                    })
                  }}
                  canEdit={canEdit}
                  cyberwareViewerRole={cyberwareViewerRole}
                  cyberwareViewerProfileId={profile?.id ?? null}
                />

                <section className="hud-panel rounded-[28px] p-4">
                  <RelationsBoard
                    data={relationsData}
                    canEdit={canEdit}
                    tone={relationsTone}
                    onChange={(updated) => {
                      const serialized = stringifyRelationsData(updated)
                      setDraftFields((current) => ({
                        ...current,
                        [relationsFieldKey]: serialized,
                        [RELATIONS_FIELD_KEY]: serialized,
                      }))
                    }}
                  />
                </section>

                {canConfigureShareAccess ? (
                  <section className="hud-panel rounded-[28px] p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="panel-title">Partilha</p>
                        <p className="mt-2 text-lg font-semibold text-white">
                          Quem pode abrir esta ficha
                        </p>
                        <p className="mt-1 text-sm leading-7 text-stone-400">
                          {isNpcProfile(selectedProfile)
                            ? 'Escolhe que players vao ver esta ficha de NPC no terminal deles.'
                            : `O dono (${selectedProfile.displayName}) continua com acesso proprio. Marca quem mais a pode ver.`}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleSaveShareAccess()}
                        className="signal-button px-4 py-2 text-sm"
                        disabled={
                          loadingShareAccess ||
                          savingShareAccess ||
                          sheetSharingUnavailable ||
                          !shareAccessDirty
                        }
                      >
                        {savingShareAccess ? 'A guardar...' : 'Guardar partilha'}
                      </button>
                    </div>

                    {shareAccessError ? (
                      <div className="mt-4 border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                        {shareAccessError}
                      </div>
                    ) : null}

                    {sheetSharingUnavailable ? (
                      <div className="mt-4 border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                        A partilha ainda nao esta ativa no Supabase. Corre `supabase/sheet-sharing.sql`
                        para ligar esta feature.
                      </div>
                    ) : null}

                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {loadingShareAccess ? (
                        <div className="border border-white/10 bg-black/25 px-4 py-3 text-sm text-stone-300">
                          A carregar acessos desta ficha...
                        </div>
                      ) : sheetSharingUnavailable ? (
                        <div className="border border-white/10 bg-black/25 px-4 py-3 text-sm text-stone-300">
                          Quando o SQL estiver aplicado, vais poder escolher aqui exatamente que
                          players podem ver esta ficha.
                        </div>
                      ) : !shareablePlayers.length ? (
                        <div className="border border-white/10 bg-black/25 px-4 py-3 text-sm text-stone-300">
                          Ainda nao ha players disponiveis para receber esta ficha.
                        </div>
                      ) : (
                        shareablePlayers.map((person) => {
                          const checked = shareViewerIds.includes(person.id)

                          return (
                            <label
                              key={person.id}
                              className={`flex cursor-pointer items-start gap-3 border px-4 py-3 transition ${
                                checked
                                  ? 'border-[#f3e600]/60 bg-[#f3e600]/10'
                                  : 'border-white/10 bg-black/25 hover:border-white/20'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={sheetSharingUnavailable || savingShareAccess}
                                onChange={() =>
                                  setShareViewerIds((current) =>
                                    current.includes(person.id)
                                      ? current.filter((entry) => entry !== person.id)
                                      : [...current, person.id],
                                  )
                                }
                                className="mt-1 h-4 w-4 accent-[#f3e600]"
                              />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-white">
                                  {person.displayName}
                                </p>
                                <p className="truncate text-xs text-stone-400">{person.email}</p>
                              </div>
                            </label>
                          )
                        })
                      )}
                    </div>
                  </section>
                    ) : null}
              </>
            )
          ) : (
            <EmptyState
              title="Ficha indisponivel"
              detail="Nao foi possivel criar ou carregar esta ficha."
            />
          )}
        </section>
      </div>

      {/* Confirmação apagar NPC */}
      {confirmDeleteNpcId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="border border-rose-500/40 bg-[#0e0e0e] px-8 py-6 shadow-2xl">
            <p className="text-sm font-semibold text-white">Apagar esta ficha?</p>
            <p className="mt-1 text-xs text-stone-400">Esta ação não pode ser desfeita.</p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => void handleDeleteNpc(confirmDeleteNpcId)}
                className="signal-button flex-1 px-4 py-2 text-xs"
                data-tone="danger"
              >
                Apagar
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteNpcId(null)}
                className="signal-button flex-1 px-4 py-2 text-xs"
                data-variant="ghost"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
