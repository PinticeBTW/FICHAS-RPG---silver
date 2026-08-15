import type {
  NetGmPersonaSession,
  NetGmPersonaSubject,
  NetSelectableGmPersonaMode,
} from '../components/net/identity/netGmPersonaTypes'
import { getNetIdentitySubjectId } from '../components/net/identity/netIdentitySelectors'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'

export const NET_GM_CONTROL_CHANGED_EVENT = 'net:gm-control-changed'
const PERSONA_MUTATION_TIMEOUT_MS = 15_000

export interface NetGmPersonaRpcArgs {
  readonly requested_subject_kind: NetGmPersonaSubject['kind']
  readonly requested_subject_id: string
  readonly requested_mode: NetSelectableGmPersonaMode
}

export class NetGmPersonaMutationError extends Error {
  readonly code: string
  readonly details?: string
  readonly hint?: string

  constructor(
    code: string,
    message: string,
    options: { readonly details?: string; readonly hint?: string } = {},
  ) {
    const context = [options.details, options.hint].filter(Boolean).join(' ')
    super(`[${code}] ${message}${context ? ` ${context}` : ''}`)
    this.name = 'NetGmPersonaMutationError'
    this.code = code
    this.details = options.details
    this.hint = options.hint
  }
}

export function notifyNetGmControlChanged(): void {
  // This event only invalidates the current routing snapshot. The next shell
  // is selected exclusively by fetch_net_current_os_session().
  window.dispatchEvent(new Event(NET_GM_CONTROL_CHANGED_EVENT))
}

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

function optionalString(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key]
  return typeof value === 'string' && value ? value : undefined
}

function mutationError(
  value: unknown,
  request: NetGmPersonaRpcArgs,
): NetGmPersonaMutationError {
  const requestLabel = `${request.requested_subject_kind}:${request.requested_subject_id} (${request.requested_mode})`
  if (!isRecord(value)) {
    return new NetGmPersonaMutationError(
      'NET_GM_PERSONA_RPC_FAILED',
      `GM persona request ${requestLabel} could not be changed.`,
    )
  }
  return new NetGmPersonaMutationError(
    optionalString(value, 'code') ?? 'NET_GM_PERSONA_RPC_FAILED',
    `GM persona request ${requestLabel} failed: ${optionalString(value, 'message') ?? 'unknown server error.'}`,
    {
      ...(optionalString(value, 'details') ? { details: optionalString(value, 'details') } : {}),
      ...(optionalString(value, 'hint') ? { hint: optionalString(value, 'hint') } : {}),
    },
  )
}

function subjectsMatch(left: NetGmPersonaSubject, right: NetGmPersonaSubject): boolean {
  return left.kind === right.kind
    && getNetIdentitySubjectId(left) === getNetIdentitySubjectId(right)
}

export function createNetGmPersonaRpcArgs(
  subject: NetGmPersonaSubject,
  mode: NetSelectableGmPersonaMode,
): NetGmPersonaRpcArgs {
  return {
    requested_subject_kind: subject.kind,
    requested_subject_id: getNetIdentitySubjectId(subject),
    requested_mode: mode,
  }
}

function parseSession(value: unknown): NetGmPersonaSession {
  if (!isRecord(value)) throw new Error('Invalid GM persona session response.')

  const gmProfileId = requiredString(value, 'gm_profile_id')
  const mode = requiredString(value, 'mode')
  const sessionGeneration = requiredString(value, 'session_generation')
  const createdAt = requiredString(value, 'created_at')
  const updatedAt = requiredString(value, 'updated_at')

  if (mode === 'none') return { gmProfileId, mode, sessionGeneration, createdAt, updatedAt }
  if (
    mode !== 'inspect'
    && mode !== 'gm-persona'
    && mode !== 'take-control'
    && mode !== 'compromised-session'
  ) {
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
  const request = createNetGmPersonaRpcArgs(subject, mode)
  const abortController = new AbortController()
  let timedOut = false
  const timeout = window.setTimeout(() => {
    timedOut = true
    abortController.abort()
  }, PERSONA_MUTATION_TIMEOUT_MS)
  let data: unknown
  let error: unknown
  try {
    const response = await client()
      .rpc('set_net_gm_persona', request)
      .abortSignal(abortController.signal)
    data = response.data
    error = response.error
  } catch (requestError) {
    error = requestError
  } finally {
    window.clearTimeout(timeout)
  }

  if (timedOut) {
    throw new NetGmPersonaMutationError(
      'NET_GM_PERSONA_TIMEOUT',
      `GM persona request ${request.requested_subject_kind}:${request.requested_subject_id} (${request.requested_mode}) timed out before server confirmation.`,
    )
  }

  if (error) throw mutationError(error, request)

  const session = parseSession(Array.isArray(data) ? data[0] : data)
  if (
    session.mode === 'none'
    || session.mode !== mode
    || !subjectsMatch(session.subject, subject)
  ) {
    throw new NetGmPersonaMutationError(
      'NET_GM_PERSONA_COMMIT_MISMATCH',
      `Server confirmation did not match ${request.requested_subject_kind}:${request.requested_subject_id} in ${request.requested_mode} mode.`,
    )
  }

  return session
}

export async function clearGmPersona(): Promise<NetGmPersonaSession> {
  const abortController = new AbortController()
  let timedOut = false
  const timeout = window.setTimeout(() => {
    timedOut = true
    abortController.abort()
  }, PERSONA_MUTATION_TIMEOUT_MS)
  let data: unknown
  let error: unknown
  try {
    const response = await client()
      .rpc('clear_net_gm_persona')
      .abortSignal(abortController.signal)
    data = response.data
    error = response.error
  } catch (requestError) {
    error = requestError
  } finally {
    window.clearTimeout(timeout)
  }

  if (timedOut) {
    throw new NetGmPersonaMutationError(
      'NET_GM_PERSONA_TIMEOUT',
      'RETURN TO GM timed out before server confirmation.',
    )
  }

  if (error) {
    throw new NetGmPersonaMutationError(
      isRecord(error) ? optionalString(error, 'code') ?? 'NET_GM_PERSONA_RPC_FAILED' : 'NET_GM_PERSONA_RPC_FAILED',
      `RETURN TO GM failed: ${isRecord(error) ? optionalString(error, 'message') ?? 'unknown server error.' : 'unknown server error.'}`,
      isRecord(error)
        ? {
            ...(optionalString(error, 'details') ? { details: optionalString(error, 'details') } : {}),
            ...(optionalString(error, 'hint') ? { hint: optionalString(error, 'hint') } : {}),
          }
        : {},
    )
  }

  const session = parseSession(Array.isArray(data) ? data[0] : data)
  if (session.mode !== 'none') {
    throw new NetGmPersonaMutationError(
      'NET_GM_PERSONA_COMMIT_MISMATCH',
      'RETURN TO GM was not confirmed by the server.',
    )
  }
  return session
}
