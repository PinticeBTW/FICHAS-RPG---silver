import type { NetAppAccountPolicy } from './netAppAccountTypes'

/**
 * Typed mirror of public.net_app_account_policies. Account requirements remain
 * separate from install state, so accounts outlive uninstall and device state.
 */
export const netAppAccountPolicies = [
  { appId: 'echo', mode: 'explicit' },
  { appId: 'pulse', mode: 'explicit' },
  { appId: 'iden', mode: 'system-identity' },
  { appId: 'nvn', mode: 'optional' },
  { appId: 'net-store', mode: 'none' },
  { appId: 'loop', mode: 'explicit' },
] as const satisfies readonly NetAppAccountPolicy[]
