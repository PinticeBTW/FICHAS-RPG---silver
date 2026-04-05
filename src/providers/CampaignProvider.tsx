import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type {
  AbilityItem,
  Campaign,
  Character,
  CharacterNotes,
  CharacterStats,
  CyberwareItem,
  EditableCollectionKey,
  InventoryItem,
  Profile,
  SkillItem,
} from '../types/domain'
import {
  deleteCollectionItem,
  fetchCampaignBundle,
  saveCharacterBasics,
  saveCharacterNotes,
  saveCharacterStats,
  saveCollectionItem,
} from '../lib/dataService'
import { useAuthContext } from './AuthProvider'

type CollectionItem = SkillItem | AbilityItem | InventoryItem | CyberwareItem

interface CampaignContextValue {
  campaign: Campaign | null
  profiles: Profile[]
  characters: Character[]
  activity: { id: string; timestamp: string; label: string; detail: string; tone: Character['alignment'] }[]
  loading: boolean
  error: string | null
  pendingAction: string | null
  refresh: () => Promise<void>
  updateCharacterBasics: (
    characterId: string,
    payload: Parameters<typeof saveCharacterBasics>[1],
  ) => Promise<void>
  updateCharacterStats: (characterId: string, payload: CharacterStats) => Promise<void>
  updateCharacterNotes: (characterId: string, payload: CharacterNotes) => Promise<void>
  updateCollectionItem: (
    kind: EditableCollectionKey,
    characterId: string,
    payload: CollectionItem,
  ) => Promise<void>
  removeCollectionItem: (
    kind: EditableCollectionKey,
    characterId: string,
    itemId: string,
  ) => Promise<void>
}

const CampaignContext = createContext<CampaignContextValue | null>(null)

export function CampaignProvider({ children }: PropsWithChildren) {
  const { profile } = useAuthContext()
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [characters, setCharacters] = useState<Character[]>([])
  const [activity, setActivity] = useState<CampaignContextValue['activity']>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)

  const hydrate = useCallback(async (activeProfile: Profile) => {
    setLoading(true)
    setError(null)

    try {
      const bundle = await fetchCampaignBundle(activeProfile)
      setCampaign(bundle.campaign)
      setProfiles(bundle.profiles)
      setCharacters(bundle.characters)
      setActivity(bundle.activity)
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : 'Nao foi possivel carregar os dados da campanha.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!profile) {
      setCampaign(null)
      setProfiles([])
      setCharacters([])
      setActivity([])
      setLoading(false)
      return
    }

    void hydrate(profile)
  }, [profile, hydrate])

  const refresh = useCallback(async () => {
    if (!profile) {
      return
    }

    await hydrate(profile)
  }, [hydrate, profile])

  const runMutation = useCallback(async (label: string, action: () => Promise<void>) => {
    setPendingAction(label)
    setError(null)

    try {
      await action()
      await refresh()
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : 'Nao foi possivel guardar as alteracoes.'
      setError(message)
      throw caughtError
    } finally {
      setPendingAction(null)
    }
  }, [refresh])

  const value = useMemo<CampaignContextValue>(
    () => ({
      campaign,
      profiles,
      characters,
      activity,
      loading,
      error,
      pendingAction,
      refresh,
      updateCharacterBasics: async (characterId, payload) =>
        runMutation('character-basics', () => saveCharacterBasics(characterId, payload)),
      updateCharacterStats: async (characterId, payload) =>
        runMutation('character-stats', () => saveCharacterStats(characterId, payload)),
      updateCharacterNotes: async (characterId, payload) =>
        runMutation('character-notes', () => saveCharacterNotes(characterId, payload)),
      updateCollectionItem: async (kind, characterId, payload) =>
        runMutation(`${kind}-save`, () => saveCollectionItem(kind, characterId, payload)),
      removeCollectionItem: async (kind, characterId, itemId) =>
        runMutation(`${kind}-delete`, () => deleteCollectionItem(kind, characterId, itemId)),
    }),
    [
      activity,
      campaign,
      characters,
      error,
      loading,
      pendingAction,
      profiles,
      refresh,
      runMutation,
    ],
  )

  return <CampaignContext.Provider value={value}>{children}</CampaignContext.Provider>
}

export function useCampaignContext() {
  const context = useContext(CampaignContext)

  if (!context) {
    throw new Error('useCampaignContext must be used within CampaignProvider.')
  }

  return context
}
