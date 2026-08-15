import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  createExplicitNetAppAccount,
  ensureAutomaticNetAppAccount,
  fetchNetAppAccountsForIdentity,
  type NetExplicitAccountAppId,
} from '../../../lib/netAppAccountService'
import {
  createNetPulseAccountWithProfile,
  type NetPulseProfileInput,
} from '../../../lib/netPulseProfileService'
import { provisionNetEchoAccount } from '../../../lib/netEchoService'
import { NetEchoContextChangedError } from '../../../lib/netEchoTypes'
import type { NetAppAccount } from './netAppAccountTypes'

export interface NetServerAppAccountIdentityContext {
  readonly identityLinkId: string
  readonly entityId?: string
}

type ServerAccountEntry =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly accounts: readonly NetAppAccount[] }
  | { readonly status: 'error'; readonly reason: string }

interface ServerAccountState {
  readonly profileId: string | null
  readonly entries: Readonly<Record<string, ServerAccountEntry>>
}

function mergeAccounts(accounts: readonly NetAppAccount[]): readonly NetAppAccount[] {
  const byId = new Map<string, NetAppAccount>()
  for (const account of accounts) byId.set(account.id, account)
  return [...byId.values()]
}

/**
 * Server accounts are authoritative. This hook keeps only an in-memory,
 * profile-scoped rendering cache and clears it on authenticated-account change.
 */
export function useNetServerAppAccounts(
  profileId: string | undefined,
  identityContext: NetServerAppAccountIdentityContext | undefined,
  options: { readonly ensureAutomaticIden?: boolean } = {},
) {
  const ensureAutomaticIden = options.ensureAutomaticIden ?? true
  const activeIdentityLinkId = identityContext?.identityLinkId
  const [state, setState] = useState<ServerAccountState>(() => ({
    profileId: profileId ?? null,
    entries: {},
  }))
  const profileIdRef = useRef<string | null>(profileId ?? null)
  const activeIdentityLinkIdRef = useRef<string | null>(activeIdentityLinkId ?? null)

  useEffect(() => {
    profileIdRef.current = profileId ?? null
    activeIdentityLinkIdRef.current = activeIdentityLinkId ?? null
  }, [activeIdentityLinkId, profileId])

  useEffect(() => {
    if (!profileId || !activeIdentityLinkId) return undefined

    const expectedProfileId = profileId
    const expectedLinkId = activeIdentityLinkId
    let cancelled = false

    void Promise.resolve().then(() => {
      if (cancelled) return
      setState((current) => current.profileId === expectedProfileId
        ? {
            ...current,
            entries: { ...current.entries, [expectedLinkId]: { status: 'loading' } },
          }
        : {
            profileId: expectedProfileId,
            entries: { [expectedLinkId]: { status: 'loading' } },
          })
    })

    void Promise.all([
      fetchNetAppAccountsForIdentity(expectedLinkId),
      ensureAutomaticIden
        ? ensureAutomaticNetAppAccount(expectedLinkId, 'iden')
        : Promise.resolve(null),
    ]).then(([accounts, idenAccount]) => {
      if (
        cancelled
        || profileIdRef.current !== expectedProfileId
        || activeIdentityLinkIdRef.current !== expectedLinkId
      ) return

      setState((current) => current.profileId === expectedProfileId
        ? {
            ...current,
            entries: {
              ...current.entries,
              [expectedLinkId]: {
                status: 'ready',
                accounts: mergeAccounts(idenAccount ? [...accounts, idenAccount] : accounts),
              },
            },
          }
        : current)
    }).catch((error: unknown) => {
      if (
        cancelled
        || profileIdRef.current !== expectedProfileId
        || activeIdentityLinkIdRef.current !== expectedLinkId
      ) return

      setState((current) => current.profileId === expectedProfileId
        ? {
            ...current,
            entries: {
              ...current.entries,
              [expectedLinkId]: {
                status: 'error',
                reason: error instanceof Error
                  ? error.message
                  : 'NET application accounts could not be synchronized.',
              },
            },
          }
        : current)
    })

    return () => { cancelled = true }
  }, [activeIdentityLinkId, ensureAutomaticIden, profileId])

  const activeEntry = state.profileId === (profileId ?? null) && activeIdentityLinkId
    ? state.entries[activeIdentityLinkId]
    : undefined
  const status = !activeIdentityLinkId
    ? 'idle' as const
    : activeEntry?.status ?? 'loading'
  const accounts = useMemo(
    () => activeEntry?.status === 'ready' ? activeEntry.accounts : [],
    [activeEntry],
  )

  const createExplicitAccount = useCallback(async (input: {
    readonly appId: NetExplicitAccountAppId
    readonly handle: string
    readonly displayNameOverride?: string
    readonly avatarUrlOverride?: string
  }): Promise<NetAppAccount> => {
    const expectedProfileId = profileIdRef.current
    const expectedLinkId = activeIdentityLinkIdRef.current
    if (!expectedProfileId || !expectedLinkId) {
      throw new Error('An active server-backed character is required.')
    }

    const account = await createExplicitNetAppAccount({
      identityLinkId: expectedLinkId,
      ...input,
    })
    if (
      profileIdRef.current !== expectedProfileId
      || activeIdentityLinkIdRef.current !== expectedLinkId
    ) {
      throw new Error('The active character changed before account creation completed.')
    }

    setState((current) => {
      if (current.profileId !== expectedProfileId) return current
      const currentEntry = current.entries[expectedLinkId]
      const currentAccounts = currentEntry?.status === 'ready' ? currentEntry.accounts : []
      return {
        ...current,
        entries: {
          ...current.entries,
          [expectedLinkId]: {
            status: 'ready',
            accounts: mergeAccounts([...currentAccounts, account]),
          },
        },
      }
    })

    return account
  }, [])

  const createPulseAccount = useCallback(async (input: {
    readonly handle: string
    readonly profile: NetPulseProfileInput
  }): Promise<NetAppAccount> => {
    const expectedProfileId = profileIdRef.current
    const expectedLinkId = activeIdentityLinkIdRef.current
    if (!expectedProfileId || !expectedLinkId) {
      throw new Error('An active server-backed character is required.')
    }

    const account = await createNetPulseAccountWithProfile({
      identityLinkId: expectedLinkId,
      ...input,
    })
    if (
      profileIdRef.current !== expectedProfileId
      || activeIdentityLinkIdRef.current !== expectedLinkId
    ) {
      throw new Error('The active character changed before PULSE activation completed.')
    }

    setState((current) => {
      if (current.profileId !== expectedProfileId) return current
      const currentEntry = current.entries[expectedLinkId]
      const currentAccounts = currentEntry?.status === 'ready' ? currentEntry.accounts : []
      return {
        ...current,
        entries: {
          ...current.entries,
          [expectedLinkId]: {
            status: 'ready',
            accounts: mergeAccounts([...currentAccounts, account]),
          },
        },
      }
    })

    return account
  }, [])

  const createEchoAccount = useCallback(async (input: {
    readonly handle: string
  }): Promise<NetAppAccount> => {
    const expectedProfileId = profileId ?? null
    const expectedLinkId = activeIdentityLinkId ?? null
    if (!expectedProfileId || !expectedLinkId) {
      throw new Error('An active server-backed character is required.')
    }

    const provisioned = await provisionNetEchoAccount({
      expectedIdentityLinkId: expectedLinkId,
      handle: input.handle,
    })
    if (
      profileIdRef.current !== expectedProfileId
      || activeIdentityLinkIdRef.current !== expectedLinkId
    ) {
      throw new NetEchoContextChangedError()
    }

    const refreshedAccounts = await fetchNetAppAccountsForIdentity(expectedLinkId)
    if (
      profileIdRef.current !== expectedProfileId
      || activeIdentityLinkIdRef.current !== expectedLinkId
    ) {
      throw new NetEchoContextChangedError()
    }

    const account = refreshedAccounts.find((candidate) =>
      candidate.id === provisioned.accountId
      && candidate.appId === 'echo'
      && candidate.owner.type === 'identity-link'
      && candidate.owner.identityLinkId === expectedLinkId,
    )
    if (!account) {
      throw new Error('ECHO presence was created but could not be reconciled locally.')
    }

    setState((current) => {
      if (current.profileId !== expectedProfileId) return current
      const currentEntry = current.entries[expectedLinkId]
      const currentAccounts = currentEntry?.status === 'ready' ? currentEntry.accounts : []
      return {
        ...current,
        entries: {
          ...current.entries,
          [expectedLinkId]: {
            status: 'ready',
            accounts: mergeAccounts([...currentAccounts, ...refreshedAccounts]),
          },
        },
      }
    })

    return account
  }, [activeIdentityLinkId, profileId])

  return useMemo(() => ({
    accounts,
    status,
    loading: status === 'loading',
    error: activeEntry?.status === 'error' ? activeEntry.reason : undefined,
    createExplicitAccount,
    createEchoAccount,
    createPulseAccount,
  }), [accounts, activeEntry, createEchoAccount, createExplicitAccount, createPulseAccount, status])
}
