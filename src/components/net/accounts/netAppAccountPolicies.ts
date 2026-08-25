import type { NetAppAccountPolicy } from './netAppAccountTypes'

/**
 * Typed mirror of public.net_app_account_policies. Account requirements remain
 * separate from install state, so accounts outlive uninstall and device state.
 */
export const netAppAccountPolicies = [
  { appId: 'pulse', mode: 'explicit' },
  { appId: 'vlt', mode: 'none' },
  { appId: 'vox-bank', mode: 'none' },
  { appId: 'shneider-bank', mode: 'none' },
  { appId: 'nvn', mode: 'optional' },
  { appId: 'net-store', mode: 'none' },
  { appId: 'relay', mode: 'none' },
  { appId: 'net-search', mode: 'none' },
  { appId: 'loop', mode: 'explicit' },
  { appId: 'altara-messenger', mode: 'none' },
  { appId: 'altara-bank', mode: 'none' },
  { appId: 'nova-bank', mode: 'none' },
  { appId: 'altara-news', mode: 'none' },
  { appId: 'altara-music', mode: 'none' },
  { appId: 'vox-audio', mode: 'none' },
  { appId: 'altara-wave', mode: 'none' },
  { appId: 'altara-store', mode: 'none' },
  { appId: 'altara-settings', mode: 'none' },
] as const satisfies readonly NetAppAccountPolicy[]
