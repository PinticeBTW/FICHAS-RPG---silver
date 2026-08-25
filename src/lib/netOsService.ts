import { isNetOsId, type NetOsId } from './netOsTypes'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'

export interface NetCurrentOsSession {
  readonly actorMode: 'player' | 'gm-system'
  readonly controlMode: 'identity' | 'system' | 'take-control'
  readonly identityLinkId?: string
  readonly primaryOsId?: NetOsId
}

export interface NetResolvedOsSession extends NetCurrentOsSession {
  readonly effectiveOsId: NetOsId
}

export function resolveNetEffectiveOs(
  session: NetCurrentOsSession,
  gmWorkspaceOsId?: NetOsId,
): NetOsId | undefined {
  if (session.actorMode === 'player') return session.primaryOsId
  if (session.controlMode === 'take-control' && session.primaryOsId) return session.primaryOsId
  return gmWorkspaceOsId ?? 'veil'
}

export const NET_OS_AUTHORITY_CHANGED_EVENT = 'net:os-authority-changed'

export function notifyNetOsAuthorityChanged(): void {
  window.dispatchEvent(new Event(NET_OS_AUTHORITY_CHANGED_EVENT))
}

export interface NetGmIdentityOsAssignment {
  readonly identityLinkId: string
  readonly primaryOsId: NetOsId | null
  readonly updatedAt: string
}

function client() {
  if (!supabase) throw new Error(SUPABASE_CONFIG_ERROR)
  return supabase
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseCurrentSession(value: unknown): NetCurrentOsSession {
  if (!isRecord(value)) throw new Error('THE NET returned an invalid operating-system session.')
  const actorMode = value.actor_mode
  const contextMode = value.context_mode
  const identityLinkId = value.identity_link_id
  const primaryOsId = value.primary_os_id

  if (actorMode !== 'player' && actorMode !== 'gm-system') {
    throw new Error('THE NET returned an unsupported session mode.')
  }

  if (actorMode === 'player') {
    const hasIdentity = typeof identityLinkId === 'string' && Boolean(identityLinkId)
    const hasPrimaryOs = isNetOsId(primaryOsId)
    const isCurrentPlayerContext = contextMode === 'identity'
    const isCompatibleLegacyContext = (contextMode === null || contextMode === undefined)
      && hasIdentity
      && hasPrimaryOs

    if (!isCurrentPlayerContext && !isCompatibleLegacyContext) {
      throw new Error('THE NET returned an unsupported player identity context.')
    }
    if (identityLinkId !== null && identityLinkId !== undefined && !hasIdentity) {
      throw new Error('THE NET returned an invalid player identity assignment.')
    }
    if (primaryOsId !== null && primaryOsId !== undefined && !hasPrimaryOs) {
      throw new Error('THE NET returned an unsupported player operating system.')
    }
    if (hasIdentity !== hasPrimaryOs) {
      throw new Error('THE NET returned an incomplete player operating-system assignment.')
    }

    return {
      actorMode: 'player',
      controlMode: 'identity',
      ...(hasIdentity ? { identityLinkId } : {}),
      ...(hasPrimaryOs ? { primaryOsId } : {}),
    }
  }

  if (contextMode !== 'system' && contextMode !== 'take-control') {
    throw new Error('THE NET returned an unsupported GM control context.')
  }
  if (contextMode === 'system') {
    if (
      identityLinkId !== null
      && identityLinkId !== undefined
      || primaryOsId !== null
      && primaryOsId !== undefined
    ) {
      throw new Error('THE NET returned an invalid GM system workspace context.')
    }
    return { actorMode: 'gm-system', controlMode: 'system' }
  }
  if (typeof identityLinkId !== 'string' || !identityLinkId) {
    throw new Error('THE NET returned an invalid controlled network identity.')
  }
  if (primaryOsId !== null && primaryOsId !== undefined && !isNetOsId(primaryOsId)) {
    throw new Error('THE NET returned an unsupported controlled operating system.')
  }

  return {
    actorMode: 'gm-system',
    controlMode: 'take-control',
    identityLinkId,
    ...(isNetOsId(primaryOsId) ? { primaryOsId } : {}),
  }
}

function parseGmAssignment(value: unknown): NetGmIdentityOsAssignment {
  if (!isRecord(value)) throw new Error('The operating-system assignment response is invalid.')
  const identityLinkId = value.identity_link_id
  const primaryOsId = value.primary_os_id
  const updatedAt = value.updated_at
  if (
    typeof identityLinkId !== 'string'
    || !identityLinkId
    || (primaryOsId !== null && !isNetOsId(primaryOsId))
    || typeof updatedAt !== 'string'
    || Number.isNaN(Date.parse(updatedAt))
  ) {
    throw new Error('The operating-system assignment response is incomplete.')
  }
  return { identityLinkId, primaryOsId, updatedAt }
}

export async function fetchNetCurrentOsSession(): Promise<NetCurrentOsSession> {
  const { data, error } = await client().rpc('fetch_net_current_os_session')
  if (error) throw new Error(`Operating-system access could not be resolved: ${error.message}`)
  return parseCurrentSession(data)
}

export async function fetchNetGmIdentityOs(
  identityLinkId: string,
): Promise<NetGmIdentityOsAssignment> {
  const normalized = identityLinkId.trim()
  if (!normalized) throw new Error('A network identity is required.')
  const { data, error } = await client().rpc('fetch_net_gm_identity_os', {
    requested_identity_link_id: normalized,
  })
  if (error) throw new Error(`Operating-system assignment could not be loaded: ${error.message}`)
  return parseGmAssignment(data)
}

export async function setNetGmIdentityPrimaryOs(
  identityLinkId: string,
  primaryOsId: NetOsId | null,
): Promise<NetGmIdentityOsAssignment> {
  const normalized = identityLinkId.trim()
  if (!normalized) throw new Error('A network identity is required.')
  const { data, error } = await client().rpc('set_net_gm_identity_primary_os', {
    requested_identity_link_id: normalized,
    requested_primary_os_id: primaryOsId,
  })
  if (error) throw new Error(`Operating-system assignment could not be changed: ${error.message}`)
  return parseGmAssignment(data)
}

/**
 * Reads Silver's server-authoritative GM System workspace. The table is
 * self-only under RLS, so this never accepts a caller-selected profile or
 * knowledge scope.
 */
export async function fetchNetGmSystemWorkspace(): Promise<NetOsId> {
  const { data, error } = await client()
    .from('net_gm_persona_sessions')
    .select('workspace_os_id')
    .maybeSingle()
  if (error) throw new Error(`GM System workspace could not be loaded: ${error.message}`)

  const workspaceOsId: unknown = data?.workspace_os_id ?? 'veil'
  if (!isNetOsId(workspaceOsId)) {
    throw new Error('THE NET returned an invalid GM System workspace.')
  }
  return workspaceOsId
}

/**
 * Persists Silver's GM System environment. Scoped applications derive their
 * authority from this server state; the requested value is a workspace
 * transition, never a per-request data scope.
 */
export async function setNetGmSystemWorkspace(osId: NetOsId): Promise<NetOsId> {
  const { data, error } = await client().rpc('set_net_gm_system_workspace_v1', {
    requested_workspace_os_id: osId,
  })
  if (error) throw new Error(`GM System workspace could not be changed: ${error.message}`)
  if (!isNetOsId(data) || data !== osId) {
    throw new Error('THE NET returned an invalid GM System workspace.')
  }
  return data
}
