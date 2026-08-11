import type { NetAppAccount } from './netAppAccountTypes'

const seedCreatedAt = '2025-01-01T00:00:00.000Z'

/**
 * Transitional canonical records only. They are not app mock-data replacements
 * and are never persisted from this module. Distinct newsroom/support/team
 * accounts intentionally remain app-specific until they have canonical links.
 */
export const netAppAccountSeeds: readonly NetAppAccount[] = [
  {
    id: 'account-echo-adrian',
    appId: 'echo',
    owner: { type: 'entity', entityId: 'person-adrian' },
    handle: 'adrian',
    status: 'active',
    createdAt: seedCreatedAt,
  },
  {
    id: 'account-echo-maya',
    appId: 'echo',
    owner: { type: 'entity', entityId: 'person-maya' },
    handle: 'maya',
    status: 'active',
    createdAt: seedCreatedAt,
  },
  {
    id: 'account-pulse-adrian',
    appId: 'pulse',
    owner: { type: 'entity', entityId: 'person-adrian' },
    handle: 'adrian',
    status: 'active',
    createdAt: seedCreatedAt,
  },
  {
    id: 'account-pulse-maya',
    appId: 'pulse',
    owner: { type: 'entity', entityId: 'person-maya' },
    handle: 'maya',
    status: 'active',
    createdAt: seedCreatedAt,
  },
  {
    id: 'account-pulse-ghost-in-the-net',
    appId: 'pulse',
    owner: { type: 'entity', entityId: 'identity-ghost-in-the-net' },
    handle: 'ghost_in_the_net',
    status: 'active',
    createdAt: seedCreatedAt,
  },
  {
    id: 'account-iden-adrian',
    appId: 'iden',
    owner: { type: 'entity', entityId: 'person-adrian' },
    handle: 'adrian',
    status: 'active',
    createdAt: seedCreatedAt,
  },
  {
    id: 'account-iden-maya',
    appId: 'iden',
    owner: { type: 'entity', entityId: 'person-maya' },
    handle: 'maya',
    status: 'active',
    createdAt: seedCreatedAt,
  },
  {
    id: 'account-iden-ghost-in-the-net',
    appId: 'iden',
    owner: { type: 'entity', entityId: 'identity-ghost-in-the-net' },
    handle: 'ghost_in_the_net',
    status: 'active',
    createdAt: seedCreatedAt,
  },
  {
    id: 'account-pulse-lucid',
    appId: 'pulse',
    owner: { type: 'organisation', organisationId: 'org-lucid' },
    handle: 'lucid',
    status: 'active',
    createdAt: seedCreatedAt,
  },
  {
    id: 'account-pulse-netwatch',
    appId: 'pulse',
    owner: { type: 'organisation', organisationId: 'org-netwatch' },
    handle: 'netwatch',
    status: 'active',
    createdAt: seedCreatedAt,
  },
  {
    id: 'account-pulse-vox-net',
    appId: 'pulse',
    owner: { type: 'organisation', organisationId: 'org-vox-net' },
    handle: 'voxnet',
    displayNameOverride: 'VOX NET Official',
    status: 'active',
    createdAt: seedCreatedAt,
  },
  {
    id: 'account-pulse-nvn',
    appId: 'pulse',
    owner: { type: 'organisation', organisationId: 'org-nvn' },
    handle: 'nvn',
    displayNameOverride: 'NVN',
    status: 'active',
    createdAt: seedCreatedAt,
  },
  {
    id: 'account-pulse-nvps',
    appId: 'pulse',
    owner: { type: 'organisation', organisationId: 'org-nvps' },
    handle: 'nvps',
    status: 'active',
    createdAt: seedCreatedAt,
  },
] as const
