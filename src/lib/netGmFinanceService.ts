import {
  NET_GM_FINANCE_MAX_ADJUSTMENT,
  NET_GM_FINANCE_NOTE_MAX_LENGTH,
  type NetGmFinanceAccount,
  type NetGmFinanceAdjustmentAction,
  type NetGmFinanceCurrency,
  type NetGmFinanceCurrencyCode,
  type NetGmFinanceIdentityPayload,
  type NetGmFinanceIdentitySummary,
} from './netGmFinanceTypes'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CURRENCY_CODES = ['VG', 'KARMA', 'FINIT', 'SECTUS'] as const
const SAFE_BALANCE_MAX = 9_000_000_000_000_000

function client() {
  if (!supabase) throw new Error(SUPABASE_CONFIG_ERROR)
  return supabase
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function invalid(label: string): never {
  throw new Error(`Finance Control returned an invalid ${label}.`)
}

function requiredString(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) invalid(label)
  return value as string
}

function optionalString(value: unknown, maximum: number, label: string): string | undefined {
  if (value === null || value === undefined || value === '') return undefined
  return requiredString(value, maximum, label)
}

function uuid(value: unknown, label: string): string {
  const parsed = requiredString(value, 64, label)
  if (!UUID_PATTERN.test(parsed)) invalid(label)
  return parsed
}

function timestamp(value: unknown, label: string): string {
  const parsed = requiredString(value, 64, label)
  if (Number.isNaN(Date.parse(parsed))) invalid(label)
  return parsed
}

function integer(value: unknown, label: string, allowNegative = false): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (
    !Number.isSafeInteger(parsed)
    || Math.abs(parsed) > SAFE_BALANCE_MAX
    || (!allowNegative && parsed < 0)
  ) invalid(label)
  return parsed
}

function currencyCode(value: unknown): NetGmFinanceCurrencyCode {
  if (!CURRENCY_CODES.includes(value as NetGmFinanceCurrencyCode)) invalid('currency code')
  return value as NetGmFinanceCurrencyCode
}

function parseCurrency(value: unknown): NetGmFinanceCurrency {
  const row = asRecord(value)
  if (!row || row.decimals !== 0) invalid('currency')
  const status = requiredString(row.status, 16, 'currency status')
  if (status !== 'active' && status !== 'inactive') invalid('currency status')
  return {
    currencyCode: currencyCode(row.currency_code),
    displayName: requiredString(row.display_name, 60, 'currency name'),
    singularLabel: requiredString(row.singular_label, 30, 'currency singular label'),
    pluralLabel: requiredString(row.plural_label, 30, 'currency plural label'),
    decimals: 0,
    status,
  }
}

function parseIdentity(value: unknown): Omit<NetGmFinanceIdentitySummary, 'accountCount'> {
  const row = asRecord(value)
  if (!row) invalid('financial identity')
  const identityKind = requiredString(row.identity_kind, 20, 'identity kind')
  const playability = requiredString(row.playability, 20, 'playability')
  const subjectKind = requiredString(row.subject_kind, 30, 'subject kind')
  const primaryOsId = requiredString(row.primary_os_id, 20, 'operating system')
  if (identityKind !== 'player' && identityKind !== 'npc') invalid('identity kind')
  if (playability !== 'playable' && playability !== 'non-playable') invalid('playability')
  if (subjectKind !== 'profile-sheet' && subjectKind !== 'npc-card' && subjectKind !== 'character') invalid('subject kind')
  if (primaryOsId !== 'veil' && primaryOsId !== 'altara') invalid('operating system')
  const avatarRef = optionalString(row.avatar_ref, 2048, 'avatar reference')
  return {
    identityLinkId: uuid(row.identity_link_id, 'identity link id'),
    identityKind,
    playability,
    subjectKind,
    subjectId: uuid(row.subject_id, 'subject id'),
    displayName: requiredString(row.display_name, 160, 'display name'),
    ...(avatarRef ? { avatarRef } : {}),
    primaryOsId,
    homeCurrency: row.home_currency === null ? null : parseCurrency(row.home_currency),
  }
}

function parseAccount(value: unknown): NetGmFinanceAccount {
  const row = asRecord(value)
  if (!row) invalid('financial account')
  const accountKind = requiredString(row.account_kind, 20, 'account kind')
  const status = requiredString(row.status, 20, 'account status')
  if (accountKind !== 'wallet' && accountKind !== 'bank') invalid('account kind')
  if (status !== 'active' && status !== 'closed') invalid('account status')
  const currency = parseCurrency(row.currency)
  const paymentIdentifier = optionalString(row.payment_identifier, 40, 'payment identifier')
  return {
    accountId: uuid(row.account_id, 'account id'),
    accountKind,
    institutionCode: requiredString(row.institution_code, 24, 'institution code'),
    institutionName: requiredString(row.institution_name, 80, 'institution name'),
    ...(paymentIdentifier ? { paymentIdentifier } : {}),
    currency,
    balanceAmount: integer(
      row.balance_amount,
      'account balance',
      currency.currencyCode === 'KARMA',
    ),
    status,
    updatedAt: timestamp(row.updated_at, 'account update time'),
  }
}

function parsePayload(value: unknown): NetGmFinanceIdentityPayload {
  const row = asRecord(value)
  if (!row || !Array.isArray(row.accounts)) invalid('identity payload')
  const identity = parseIdentity(row.identity)
  return {
    serverNow: timestamp(row.server_now, 'server time'),
    identity,
    altaraFundsTotal: row.altara_funds_total === null
      ? null
      : integer(row.altara_funds_total, 'ALTARA funds total'),
    accounts: row.accounts.map(parseAccount),
  }
}

export async function fetchNetGmFinanceDirectory(
  query = '',
): Promise<readonly NetGmFinanceIdentitySummary[]> {
  const normalized = query.trim()
  if (normalized.length > 80) throw new Error('Search must be 80 characters or fewer.')
  const { data, error } = await client().rpc('fetch_net_economy_gm_finance_directory', {
    requested_query: normalized || null,
    requested_limit: 40,
  })
  if (error) throw error
  if (!Array.isArray(data) || data.length > 40) invalid('identity directory')
  return data.map((value) => {
    const row = asRecord(value)
    if (!row) invalid('identity directory row')
    return {
      ...parseIdentity(row),
      accountCount: integer(row.account_count, 'account count'),
    }
  })
}

export async function fetchNetGmFinanceIdentity(
  identityLinkId: string,
): Promise<NetGmFinanceIdentityPayload> {
  if (!UUID_PATTERN.test(identityLinkId)) throw new Error('Choose a valid financial identity.')
  const { data, error } = await client().rpc('fetch_net_economy_gm_finance_identity', {
    requested_identity_link_id: identityLinkId,
  })
  if (error) throw error
  return parsePayload(data)
}

export async function adjustNetGmFinanceAccount(input: {
  identityLinkId: string
  accountId: string
  action: NetGmFinanceAdjustmentAction
  amount: number
  note?: string
  requestKey: string
}): Promise<NetGmFinanceIdentityPayload> {
  if (!UUID_PATTERN.test(input.identityLinkId) || !UUID_PATTERN.test(input.accountId)) {
    throw new Error('The selected identity or account is no longer valid.')
  }
  if (!UUID_PATTERN.test(input.requestKey)) throw new Error('The adjustment request key is invalid.')
  if (!Number.isSafeInteger(input.amount) || input.amount < 1 || input.amount > NET_GM_FINANCE_MAX_ADJUSTMENT) {
    throw new Error(`Amount must be a whole value from 1 to ${NET_GM_FINANCE_MAX_ADJUSTMENT}.`)
  }
  const note = input.note?.trim() ?? ''
  if (note.length > NET_GM_FINANCE_NOTE_MAX_LENGTH) {
    throw new Error(`Note must be ${NET_GM_FINANCE_NOTE_MAX_LENGTH} characters or fewer.`)
  }
  const { data, error } = await client().rpc('adjust_net_economy_gm_finance_account', {
    requested_expected_identity_link_id: input.identityLinkId,
    requested_account_id: input.accountId,
    requested_action: input.action,
    requested_amount: input.amount,
    requested_note: note || null,
    requested_request_key: input.requestKey,
  })
  if (error) throw error
  return parsePayload(data)
}
