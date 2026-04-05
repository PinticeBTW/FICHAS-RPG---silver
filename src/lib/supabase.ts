import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
export const isSupabaseEnabled = Boolean(supabaseUrl && supabaseAnonKey)
export const SUPABASE_CONFIG_ERROR =
  'Falta configurar o Supabase. Cria o ficheiro .env com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.'

export const supabase = isSupabaseEnabled
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null
