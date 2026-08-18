import type {
  NetGmPersonaSession,
  NetGmPersonaSubject,
  NetSelectableGmPersonaMode,
} from '../components/net/identity/netGmPersonaTypes'
import { getNetIdentitySubjectId } from '../components/net/identity/netIdentitySelectors'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'

function client() {
  if (!supabase) throw new Error(SUPABASE_CONFIG_ERROR)
  return supabase
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (typeof value !== 'string' || !value) {
    throw new Error(`Invalid GM persona response field: ${key}`)
  }
  return value
}

function parseSession(value: unknown): NetGmPersonaSession {
  if (!isRecord(value)) throw new Error('Invalid GM persona session response.')

  const gmProfileId = requiredString(value, 'gm_profile_id')
  const mode = requiredString(value, 'mode')
  const sessionGeneration = requiredString(value, 'session_generation')
  const createdAt = requiredString(value, 'created_at')
  const updatedAt = requiredString(value, 'updated_at')

  if (mode === 'none') return { gmProfileId, mode, sessionGeneration, createdAt, updatedAt }
  if (mode !== 'inspect' && mode !== 'gm-persona' && mode !== 'compromised-session') {
    throw new Error('The server returned an unsupported GM persona mode.')
  }

  const subjectKind = requiredString(value, 'subject_kind')
  const subjectId = requiredString(value, 'subject_id')
  let subject: NetGmPersonaSubject
  if (subjectKind === 'profile-sheet') {
    subject = { kind: 'profile-sheet', profileId: subjectId }
  } else if (subjectKind === 'npc-card') {
    subject = { kind: 'npc-card', npcCardId: subjectId }
  } else {
    throw new Error('The server returned an unsupported GM persona subject.')
  }

  return { gmProfileId, mode, subject, sessionGeneration, createdAt, updatedAt }
}

/** RLS exposes only the authenticated GM's own session row. */
export async function fetchGmPersona(): Promise<NetGmPersonaSession | null> {
  const { data, error } = await client()
    .from('net_gm_persona_sessions')
    .select('gm_profile_id, subject_kind, subject_id, mode, session_generation, created_at, updated_at')
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`GM persona could not be loaded: ${error.message}`)
  return data ? parseSession(data) : null
}

/**
 * The RPC accepts only a source subject and mode. It derives the GM actor from
 * auth.uid() and validates target existence and permitted mode server-side.
 */
export async function setGmPersona(
  subject: NetGmPersonaSubject,
  mode: NetSelectableGmPersonaMode,
): Promise<NetGmPersonaSession> {
  const { data, error } = await client().rpc('set_net_gm_persona', {
    requested_subject_kind: subject.kind,
    requested_subject_id: getNetIdentitySubjectId(subject),
    requested_mode: mode,
  })

  if (error) throw new Error(`GM persona could not be changed: ${error.message}`)
  return parseSession(Array.isArray(data) ? data[0] : data)
}

export async function clearGmPersona(): Promise<NetGmPersonaSession> {
  const { data, error } = await client().rpc('clear_net_gm_persona')

  if (error) throw new Error(`GM persona could not be cleared: ${error.message}`)
  return parseSession(Array.isArray(data) ? data[0] : data)
}
