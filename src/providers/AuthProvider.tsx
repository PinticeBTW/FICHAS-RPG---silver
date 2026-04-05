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

interface AuthContextValue {
  profile: Profile | null
  session: Session | null
  loading: boolean
  authConfigured: boolean
  signIn: (input: AuthFormInput) => Promise<void>
  signUp: (input: AuthFormInput) => Promise<{ needsEmailConfirmation: boolean }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

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
