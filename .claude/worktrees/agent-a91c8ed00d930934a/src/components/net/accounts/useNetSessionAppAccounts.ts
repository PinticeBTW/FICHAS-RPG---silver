import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  createNetSessionAppAccount,
  createNetSessionAppAccountRegistry,
  registerNetSessionAppAccount,
} from './netAppAccountSelectors'
import type {
  NetAppAccount,
  NetSessionAppAccountRegistry,
  NetTransientAppAccountCandidate,
} from './netAppAccountTypes'

interface SessionRegistryState {
  readonly profileId: string | null
  readonly registry: NetSessionAppAccountRegistry
}

const emptyRegistry = createNetSessionAppAccountRegistry()

/**
 * Legacy transition adapter retained for non-server fixtures. Runtime player
 * accounts now use useNetServerAppAccounts; this registry is never authority.
 */
export function useNetSessionAppAccounts(profileId: string | undefined) {
  const [state, setState] = useState<SessionRegistryState>(() => ({
    profileId: profileId ?? null,
    registry: emptyRegistry,
  }))

  const activeRegistry = state.profileId === (profileId ?? null)
    ? state.registry
    : emptyRegistry

  useEffect(() => {
    setState({
      profileId: profileId ?? null,
      registry: emptyRegistry,
    })
  }, [profileId])

  const provisionAccount = useCallback(
    (
      expectedProfileId: string,
      candidate: NetTransientAppAccountCandidate,
      existingAccounts: readonly NetAppAccount[],
    ) => {
      setState((current) => {
        if (current.profileId !== expectedProfileId) return current

        const account = createNetSessionAppAccount(
          candidate,
          [...existingAccounts, ...current.registry.accounts],
          new Date().toISOString(),
        )
        const registration = registerNetSessionAppAccount(current.registry, account)
        return registration.status === 'registered'
          ? { ...current, registry: registration.registry }
          : current
      })
    },
    [],
  )

  return useMemo(
    () => ({
      accounts: activeRegistry.accounts,
      provisionAccount,
    }),
    [activeRegistry.accounts, provisionAccount],
  )
}
