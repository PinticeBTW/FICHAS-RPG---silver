import { ChevronDown, ChevronLeft, ChevronRight, Folder, FolderOpen, GripVertical, LogOut, Pencil, Plus, RefreshCcw, Save, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { PdfSheetEditor } from '../components/character/PdfSheetEditor'
import { EmptyState } from '../components/common/EmptyState'
import { LoadingScreen } from '../components/common/LoadingScreen'
import { SilverNotebook } from '../components/notes/SilverNotebook'
import { useAuth } from '../hooks/useAuth'
import { formatTimestamp } from '../lib/utils'
import {
  createNpcCard,
  deleteNpcCard,
  fetchNpcSheet,
  fetchOrCreateSheet,
  isNpcProfile,
  listSheetProfiles,
  loadGmGroups,
  saveGmGroups,
  updateNpcCardDisplayName,
  updateProfileDisplayName,
  saveNpcSheet,
  saveSheetFields,
  subscribeToSheet,
  type ProfileGroup,
} from '../lib/webSheetService'
import type { Profile, WebSheetRecord } from '../types/domain'

const AUTOSAVE_DELAY_MS = 1200
const SILVER_AUTOSAVE_DELAY_MS = 60000

function serializeFieldData(fieldData: Record<string, string>) {
  return JSON.stringify(
    Object.keys(fieldData)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, fieldData[key] ?? '']),
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
}) {
  const isNpc = entry.email.startsWith('npc:')
  const assignedGroupIds = new Set(groups.filter((g) => g.profileIds.includes(entry.id)).map((g) => g.id))
  const isInAnyGroup = assignedGroupIds.size > 0

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
        <p className="mt-1 truncate text-xs text-stone-400">{isNpc ? 'NPC' : entry.email}</p>
        <p className="mt-2 text-[0.68rem] uppercase tracking-[0.22em] text-stone-500">
          {entry.role === 'gm' ? 'GM' : 'Jogador'}
        </p>
      </button>

      {/* Folder toggle button */}
      {isGm && groups.length > 0 && (
        <div className="absolute right-1.5 top-1.5 flex items-center gap-1">
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
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onStartRename() }}
            className="p-1 text-stone-600 transition hover:text-stone-300"
            title="Mudar nome"
          >
            <Pencil size={11} />
          </button>
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
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [sheet, setSheet] = useState<WebSheetRecord | null>(null)
  const [draftFields, setDraftFields] = useState<Record<string, string>>({})
  const [loadingProfiles, setLoadingProfiles] = useState(true)
  const [loadingSheet, setLoadingSheet] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncLabel, setSyncLabel] = useState('Auto-save ativo')
  const [error, setError] = useState<string | null>(null)
  const autosaveTimerRef = useRef<number | null>(null)
  const sheetSignatureRef = useRef('')
  const draftSignatureRef = useRef('')
  const [groups, setGroups] = useState<ProfileGroup[]>([])
  const groupsLoadedRef = useRef(false)
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
  const [addingFicha, setAddingFicha] = useState(false)
  const [creatingFicha, setCreatingFicha] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [renamingProfileId, setRenamingProfileId] = useState<string | null>(null)
  const [renamingValue, setRenamingValue] = useState('')
  const [renamingSaving, setRenamingSaving] = useState(false)

  const accessibleProfiles = useMemo(() => {
    if (!profile) {
      return []
    }

    return profile.role === 'gm'
      ? profiles
      : profiles.filter((entry) => entry.id === profile.id)
  }, [profile, profiles])

  const selectedProfile =
    accessibleProfiles.find((entry) => entry.id === profileId) ?? accessibleProfiles[0] ?? null

  const isSilverWorkspace = Boolean(
    profile &&
    selectedProfile &&
    profile.role === 'gm' &&
    selectedProfile.id === profile.id &&
    selectedProfile.role === 'gm',
  )

  const canEdit = Boolean(profile && selectedProfile && (profile.role === 'gm' || selectedProfile.id === profile.id))
  const autosaveDelayMs = isSilverWorkspace ? SILVER_AUTOSAVE_DELAY_MS : AUTOSAVE_DELAY_MS
  const sheetSignature = useMemo(
    () => serializeFieldData(sheet?.fieldData ?? {}),
    [sheet],
  )
  const draftSignature = useMemo(
    () => serializeFieldData(draftFields),
    [draftFields],
  )
  const isDirty = sheet !== null && sheetSignature !== draftSignature

  useEffect(() => {
    sheetSignatureRef.current = sheetSignature
  }, [sheetSignature])

  useEffect(() => {
    draftSignatureRef.current = draftSignature
  }, [draftSignature])

  const refreshProfiles = useCallback(async () => {
    setLoadingProfiles(true)
    setError(null)

    try {
      const nextProfiles = await listSheetProfiles()
      setProfiles(nextProfiles)
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : 'Nao foi possivel carregar as fichas do grupo.'
      setError(message)
    } finally {
      setLoadingProfiles(false)
    }
  }, [])

  useEffect(() => {
    void refreshProfiles()
  }, [refreshProfiles])

  useEffect(() => {
    if (!loadingProfiles && selectedProfile && selectedProfile.id !== profileId) {
      navigate(`/app/sheets/${selectedProfile.id}`, { replace: true })
    }
  }, [loadingProfiles, navigate, profileId, selectedProfile])

  useEffect(() => {
    if (!selectedProfile) {
      setSheet(null)
      setDraftFields({})
      setSyncLabel('Auto-save ativo')
      return
    }

    let cancelled = false

    const loadSheet = async () => {
      setLoadingSheet(true)
      setError(null)

      try {
        const nextSheet = isNpcProfile(selectedProfile)
          ? await fetchNpcSheet(selectedProfile.id)
          : await fetchOrCreateSheet(selectedProfile)

        if (cancelled) {
          return
        }

        setSheet(nextSheet)
        setDraftFields(nextSheet.fieldData)
        setSyncLabel('Ficha sincronizada')
      } catch (caughtError) {
        if (cancelled) {
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
        if (!cancelled) {
          setLoadingSheet(false)
        }
      }
    }

    void loadSheet()

    return () => {
      cancelled = true
    }
  }, [selectedProfile])

  useEffect(() => {
    if (!selectedProfile) {
      return
    }

    const unsubscribe = subscribeToSheet(selectedProfile.id, (nextSheet) => {
      const nextSignature = serializeFieldData(nextSheet.fieldData)
      const hasLocalChanges = draftSignatureRef.current !== sheetSignatureRef.current

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

        if (currentSignature === nextSignature) {
          return current
        }

        if (hasLocalChanges) {
          return current
        }

        return nextSheet.fieldData
      })

      setSyncLabel(hasLocalChanges ? 'Alteracoes locais por guardar...' : 'Atualizado em tempo real')

      if (!hasLocalChanges) {
        setSaving(false)
      }
    })

    return () => {
      unsubscribe()
    }
  }, [selectedProfile])

  const handleSave = useCallback(async () => {
    if (!selectedProfile) {
      return
    }

    if (!isDirty) {
      setSyncLabel('Sem alteracoes por guardar')
      return
    }

    setSaving(true)
    setSyncLabel('A guardar...')
    setError(null)

    try {
      const savedSheet = isNpcProfile(selectedProfile)
        ? await saveNpcSheet(selectedProfile.id, draftFields)
        : await saveSheetFields(selectedProfile.id, draftFields)
      setSheet(savedSheet)
      setDraftFields((current) =>
        serializeFieldData(current) === serializeFieldData(savedSheet.fieldData)
          ? current
          : savedSheet.fieldData,
      )
      setSyncLabel('Guardado automaticamente')
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : 'Nao foi possivel guardar a ficha.'
      setError(message)
      setSyncLabel('Falha no auto-save')
    } finally {
      setSaving(false)
    }
  }, [draftFields, isDirty, selectedProfile])

  useEffect(() => {
    if (!canEdit || !selectedProfile || !sheet || !isDirty) {
      return
    }

    setSyncLabel(
      isSilverWorkspace
        ? 'Alteracoes por guardar. Clica em Guardar ou espera 1 min sem mexer.'
        : 'Alteracoes por guardar...',
    )

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current)
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      void handleSave()
    }, autosaveDelayMs)

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
      }
    }
  }, [autosaveDelayMs, canEdit, handleSave, isDirty, isSilverWorkspace, selectedProfile, sheet])

  // Carregar grupos do Supabase quando o GM entra
  useEffect(() => {
    if (!profile || profile.role !== 'gm') return
    groupsLoadedRef.current = false
    void loadGmGroups(profile.id).then((loaded) => {
      setGroups(loaded)
      groupsLoadedRef.current = true
    }).catch(() => { groupsLoadedRef.current = true })
  }, [profile])

  // Guardar grupos no Supabase apenas após o carregamento inicial
  useEffect(() => {
    if (!profile || profile.role !== 'gm' || !groupsLoadedRef.current) return
    void saveGmGroups(profile.id, groups).catch(() => {})
  }, [groups, profile])

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

  // Nova Ficha (NPC)
  const handleCreateFicha = useCallback(async () => {
    const name = newFichaName.trim()
    if (!name) return
    setCreatingFicha(true)
    try {
      const newProfile = await createNpcCard(name)
      await refreshProfiles()
      navigate(`/app/sheets/${newProfile.id}`)
      setAddingFicha(false)
      setNewFichaName('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar ficha.')
    } finally {
      setCreatingFicha(false)
    }
  }, [newFichaName, navigate, refreshProfiles])

  const handleSignOut = useCallback(async () => {
    await signOut()
    navigate('/', { replace: true })
  }, [navigate, signOut])

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

      setProfiles((current) =>
        current.map((entry) =>
          entry.id === target.id ? { ...entry, displayName: trimmed } : entry,
        ),
      )
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
  }, [profile, renamingValue, updateDisplayName])

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

  return (
    <main className="mx-auto max-w-[1700px]">
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
        <aside className="hud-panel relative rounded-[28px] p-4">
          {/* Drag handle */}
          <div
            onMouseDown={handleResizeStart}
            className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 hover:opacity-100 hover:bg-white/20 transition-opacity"
            title="Arrastar para redimensionar"
          />
          {/* Estado da ficha + Sair — topo */}
          <div className="border border-white/10 bg-black/25 px-4 py-3">
            <p className="panel-title">Estado da ficha</p>
            <p className="mt-3 text-sm text-stone-200">{saving ? 'A guardar...' : syncLabel}</p>
            <p className="mt-2 text-xs text-stone-500">
              Ultima gravacao:{' '}
              <span className="text-stone-300">
                {sheet ? formatTimestamp(sheet.updatedAt) : 'por criar'}
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
                {accessibleProfiles.length} ficha(s)
              </p>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
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
                  onClick={() => void handleSave()}
                  className="signal-button inline-flex items-center gap-2 px-3 py-1.5 text-xs"
                  disabled={saving || !isDirty}
                >
                  <Save size={14} />
                  {saving ? 'A guardar...' : 'Guardar'}
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-4 space-y-1">
            {/* Player: só o seu card */}
            {!isGm && selectedProfile && (
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
                          void updateDisplayName(nameInput).then(() => setEditingName(false))
                        }
                        if (e.key === 'Escape') setEditingName(false)
                      }}
                      className="min-w-0 flex-1 border border-white/20 bg-black/40 px-2 py-1 text-xs text-white outline-none focus:border-[#f3e600]/50"
                    />
                    <button
                      type="button"
                      onClick={() => void updateDisplayName(nameInput).then(() => setEditingName(false))}
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
            )}

            {/* GM: nova ficha */}
            {isGm && (
              <div className="mb-3">
                {addingFicha ? (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      type="text"
                      value={newFichaName}
                      onChange={(e) => setNewFichaName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleCreateFicha()
                        if (e.key === 'Escape') { setAddingFicha(false); setNewFichaName('') }
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
                      onClick={() => { setAddingFicha(false); setNewFichaName('') }}
                      className="signal-button px-2 py-1 text-xs"
                      data-variant="ghost"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingFicha(true)}
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

            {/* GM: pastas e lista */}
            {isGm && groups.map((group) => {
              const isExpanded = expandedGroups.has(group.id)
              const membersInGroup = accessibleProfiles.filter((p) => group.profileIds.includes(p.id))
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
                          />
                        ))
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {/* GM: profiles sem pasta */}
            {isGm && (() => {
              const assignedIds = new Set(groups.flatMap((g) => g.profileIds))
              const ungrouped = accessibleProfiles.filter((p) => !assignedIds.has(p.id))
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
                />
              ))
            })()}
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

          {loadingSheet || !selectedProfile ? (
            <LoadingScreen label="A abrir a ficha..." />
          ) : sheet ? (
            isSilverWorkspace ? (
              <SilverNotebook
                value={draftFields.GM_NOTES ?? ''}
                pagesValue={draftFields.GM_NOTE_PAGES ?? ''}
                remindersValue={draftFields.GM_REMINDERS ?? ''}
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
              <PdfSheetEditor
                fieldData={draftFields}
                onFieldChange={(fieldName, value) => {
                  setDraftFields((current) => ({
                    ...current,
                    [fieldName]: value,
                  }))
                }}
                canEdit={canEdit}
              />
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
