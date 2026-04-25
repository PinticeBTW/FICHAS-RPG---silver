import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import type { AuthFormInput, Profile } from '../types/domain'
import { fetchAuthProfile } from '../lib/dataService'
import { isSupabaseEnabled, supabase, SUPABASE_CONFIG_ERROR } from '../lib/supabase'
import { logSupabaseFetch } from '../lib/supabaseQueries'

interface AuthContextValue {
  profile: Profile | null
  session: Session | null
  loading: boolean
  authConfigured: boolean
  signIn: (input: AuthFormInput) => Promise<void>
  signUp: (input: AuthFormInput) => Promise<{ needsEmailConfirmation: boolean }>
  signOut: () => Promise<void>
  updateDisplayName: (name: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

type AuthProfileRealtimeRow = {
  id: string
  email: string | null
  display_name: string | null
  handle: string | null
  role: Profile['role']
  avatar_url: string | null
  active_campaign_id: string | null
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(isSupabaseEnabled)

  useEffect(() => {
    if (!isSupabaseEnabled || !supabase) {
      setLoading(false)
      return
    }

    const authClient = supabase
    let mounted = true

    const syncProfile = async (nextSession: Session | null) => {
      setSession(nextSession)

      if (!nextSession?.user) {
        if (!mounted) {
          return
        }

        setProfile(null)
        setLoading(false)
        return
      }

      try {
        const nextProfile = await fetchAuthProfile(nextSession.user.id)

        if (!mounted) {
          return
        }

        setProfile(nextProfile)
      } catch {
        if (!mounted) {
          return
        }

        setProfile(null)
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    }

    const bootstrap = async () => {
      setLoading(true)
      const {
        data: { session: activeSession },
      } = await authClient.auth.getSession()

      await syncProfile(activeSession)
    }

    void bootstrap()

    const {
      data: { subscription },
    } = authClient.auth.onAuthStateChange((_event, nextSession) => {
      void syncProfile(nextSession)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!supabase || !profile?.id) {
      return
    }

    const authClient = supabase
    const channel = authClient
      .channel(`auth-profile:${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${profile.id}`,
        },
        (payload) => {
          if (payload.eventType === 'DELETE' || !payload.new) {
            return
          }

          const nextRow = payload.new as AuthProfileRealtimeRow

          setProfile((current) =>
            current && current.id === nextRow.id
              ? {
                  ...current,
                  email: nextRow.email ?? current.email,
                  displayName: nextRow.display_name ?? current.displayName,
                  handle: nextRow.handle ?? current.handle,
                  role: nextRow.role ?? current.role,
                  avatarUrl: nextRow.avatar_url ?? current.avatarUrl,
                  activeCampaignId: nextRow.active_campaign_id ?? current.activeCampaignId,
                }
              : current,
          )
        },
      )
      .subscribe()

    return () => {
      void authClient.removeChannel(channel)
    }
  }, [profile?.id])

  const signIn = async (input: AuthFormInput) => {
    if (!supabase) {
      throw new Error(SUPABASE_CONFIG_ERROR)
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    })

    if (error) {
      throw error
    }
  }

  const signUp = async (input: AuthFormInput) => {
    if (!supabase) {
      throw new Error(SUPABASE_CONFIG_ERROR)
    }

    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: {
          display_name: input.displayName,
          handle: input.handle,
        },
      },
    })

    if (error) {
      throw error
    }

    return {
      needsEmailConfirmation: !data.session,
    }
  }

  const updateDisplayName = async (name: string) => {
    if (!supabase || !profile) {
      throw new Error(SUPABASE_CONFIG_ERROR)
    }

    const trimmed = name.trim()
    if (!trimmed) return

    logSupabaseFetch({ functionName: 'updateDisplayName', table: 'profiles' })

    const { data, error } = await supabase
      .from('profiles')
      .update({ display_name: trimmed })
      .eq('id', profile.id)
      .select('id, display_name')
      .maybeSingle()

    if (error) throw error
    if (!data) {
      throw new Error('Nao foi possivel guardar o teu novo nome no Supabase.')
    }

    setProfile((prev) => prev ? { ...prev, displayName: trimmed } : prev)
  }

  const signOut = async () => {
    if (!supabase) {
      setProfile(null)
      setSession(null)
      return
    }

    const { error } = await supabase.auth.signOut()

    if (error) {
      throw error
    }
  }

  return (
    <AuthContext.Provider
      value={{
        profile,
        session,
        loading,
        authConfigured: isSupabaseEnabled,
        signIn,
        signUp,
        signOut,
        updateDisplayName,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuthContext() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuthContext must be used within AuthProvider.')
  }

  return context
}
