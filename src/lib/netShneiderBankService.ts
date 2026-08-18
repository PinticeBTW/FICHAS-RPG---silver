import { mapNetBankPaymentError, searchNetBankPayees } from './netBankPaymentService'
import type { NetBankPayee } from './netBankPaymentTypes'
import {
  NET_SHNEIDER_BANK_HISTORY_DEFAULT_LIMIT,
  NET_SHNEIDER_BANK_HISTORY_MAX_LIMIT,
  NET_SHNEIDER_BANK_MAX_TRANSFER_AMOUNT,
  type NetShneiderBankAccount,
  type NetShneiderBankActivity,
  type NetShneiderBankActivityKind,
  type NetShneiderBankActivityPage,
  type NetShneiderBankBenefit,
  type NetShneiderBenefitCategory,
  type NetShneiderBankCursor,
  type NetShneiderBankDirection,
  type NetShneiderBankPayload,
} from './netShneiderBankTypes'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'

interface RpcErrorLike {
  readonly code?: string
  readonly message: string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PAYMENT_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/
const ACTIVITY_KINDS = ['bank-deposit', 'bank-withdrawal', 'bank-transfer', 'gm-credit', 'gm-debit'] as const
const BENEFIT_CATEGORIES = ['hospital', 'clinic', 'pharmacy'] as const
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

function requiredString(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error(`Invalid ${label} returned by SHNEIDER BANK.`)
  }
  return value
}

function uuid(value: unknown, label: string): string {
  const parsed = requiredString(value, 64, label)
  if (!UUID_PATTERN.test(parsed)) throw new Error(`Invalid ${label} returned by SHNEIDER BANK.`)
  return parsed
}

function timestamp(value: unknown, label: string): string {
  const parsed = requiredString(value, 64, label)
  if (Number.isNaN(Date.parse(parsed))) throw new Error(`Invalid ${label} returned by SHNEIDER BANK.`)
  return parsed
}

function integer(value: unknown, label: string, maximum = SAFE_BALANCE_MAX): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || Math.abs(parsed) > maximum) {
    throw new Error(`Invalid ${label} returned by SHNEIDER BANK.`)
  }
  return parsed
}

function paymentIdentifier(value: unknown): string {
  const parsed = requiredString(value, 40, 'bank payment identifier')
  if (!PAYMENT_IDENTIFIER_PATTERN.test(parsed)) throw new Error('Invalid payment identifier returned by SHNEIDER BANK.')
  return parsed
}

function mapError(prefix: string, error: RpcErrorLike): Error {
  const message = error.message ?? ''
  if (message.includes('SHNEIDER_BANK_INSTITUTION_UNAVAILABLE')) {
    return new Error('SHNEIDER BANK is temporarily unavailable.')
  }
  if (message.includes('SHNEIDER_BANK_ACCOUNT_INACTIVE')) {
    return new Error('This SHNEIDER BANK account is not active.')
  }
  if (message.includes('ECONOMY_INSUFFICIENT_FUNDS')) {
    return new Error('Your VLT wallet does not have enough vG for that deposit.')
  }
  if (message.includes('ECONOMY_BANK_INSUFFICIENT_FUNDS')) {
    return new Error('Your SHNEIDER BANK account does not have enough vG for this action.')
  }
  if (message.includes('ECONOMY_') || message.includes('_BANK_') || error.code === '42501') {
    return mapNetBankPaymentError('SHNEIDER BANK', error)
  }
  return new Error(`${prefix}: ${message}`)
}

function parseBank(value: unknown): NetShneiderBankAccount | null {
  if (value === null) return null
  const row = asRecord(value)
  if (!row || row.currency_code !== 'VG') throw new Error('Invalid SHNEIDER BANK account payload.')
  const status = requiredString(row.status, 16, 'bank status')
  if (status !== 'active' && status !== 'closed') throw new Error('Invalid SHNEIDER BANK status.')
  return {
    accountId: uuid(row.account_id, 'bank account id'),
    paymentIdentifier: paymentIdentifier(row.payment_identifier),
    balanceAmount: integer(row.balance_amount, 'bank balance'),
    status,
    openedAt: timestamp(row.opened_at, 'bank opening time'),
    updatedAt: timestamp(row.updated_at, 'bank update time'),
  }
}

function parseActivity(value: unknown): NetShneiderBankActivity {
  const row = asRecord(value)
  if (!row) throw new Error('Invalid SHNEIDER BANK activity row.')
  const kind = requiredString(row.transaction_kind, 40, 'activity kind')
  if (!ACTIVITY_KINDS.includes(kind as NetShneiderBankActivityKind)) {
    throw new Error('Unsupported SHNEIDER BANK activity kind.')
  }
  const amount = integer(row.amount, 'activity amount', NET_SHNEIDER_BANK_MAX_TRANSFER_AMOUNT)
  if (amount === 0) throw new Error('Invalid zero-value SHNEIDER BANK activity.')
  return {
    transactionId: uuid(row.transaction_id, 'transaction id'),
    amount,
    transactionKind: kind as NetShneiderBankActivityKind,
    ...(typeof row.counterparty_display_name === 'string' && row.counterparty_display_name.trim()
      ? { counterpartyDisplayName: row.counterparty_display_name }
      : {}),
    ...(typeof row.counterparty_payment_identifier === 'string'
      && PAYMENT_IDENTIFIER_PATTERN.test(row.counterparty_payment_identifier)
      ? { counterpartyPaymentIdentifier: row.counterparty_payment_identifier }
      : {}),
    ...(typeof row.note === 'string' && row.note.trim() ? { note: row.note } : {}),
    createdAt: timestamp(row.created_at, 'activity time'),
  }
}

function parseActivityPage(value: unknown): NetShneiderBankActivityPage {
  const row = asRecord(value)
  if (!row || !Array.isArray(row.items) || typeof row.has_more !== 'boolean') {
    throw new Error('Invalid SHNEIDER BANK activity page.')
  }
  const cursorAt = row.next_cursor_at == null ? undefined : timestamp(row.next_cursor_at, 'activity cursor time')
  const cursorId = row.next_cursor_id == null ? undefined : uuid(row.next_cursor_id, 'activity cursor id')
  if (Boolean(cursorAt) !== Boolean(cursorId) || (row.has_more && (!cursorAt || !cursorId))) {
    throw new Error('Invalid SHNEIDER BANK activity cursor.')
  }
  return {
    items: row.items.map(parseActivity),
    hasMore: row.has_more,
    ...(cursorAt && cursorId ? { nextCursor: { at: cursorAt, id: cursorId } } : {}),
  }
}

function parseBenefit(value: unknown): NetShneiderBankBenefit {
  const row = asRecord(value)
  const category = row ? requiredString(row.merchant_category, 24, 'benefit category') : ''
  if (!BENEFIT_CATEGORIES.includes(category as NetShneiderBenefitCategory)) {
    throw new Error('Invalid SHNEIDER BANK benefit category.')
  }
  const discountBasisPoints = integer(row?.discount_basis_points, 'benefit percentage', 10_000)
  if (discountBasisPoints < 0) throw new Error('Invalid SHNEIDER BANK benefit percentage.')
  return { merchantCategory: category as NetShneiderBenefitCategory, discountBasisPoints }
}

function parsePayload(value: unknown): NetShneiderBankPayload {
  const row = asRecord(value)
  const identity = asRecord(row?.identity)
  const institution = asRecord(row?.institution)
  const wallet = asRecord(row?.wallet)
  if (!row || !identity || !institution || !wallet || !Array.isArray(row.benefits)) {
    throw new Error('Invalid SHNEIDER BANK response.')
  }
  if (
    institution.institution_code !== 'SHNEIDER'
    || institution.display_name !== 'SHNEIDER BANK'
    || institution.owner_name !== 'SHNEIDER'
  ) {
    throw new Error('Invalid SHNEIDER BANK institution response.')
  }
  return {
    serverNow: timestamp(row.server_now, 'server time'),
    clientReceivedAtMs: Date.now(),
    identity: { displayName: requiredString(identity.display_name, 160, 'account holder') },
    institution: {
      institutionCode: 'SHNEIDER',
      displayName: 'SHNEIDER BANK',
      ownerName: 'SHNEIDER',
    },
    wallet: {
      accountId: uuid(wallet.account_id, 'VLT wallet account id'),
      balanceAmount: integer(wallet.balance_amount, 'VLT wallet balance'),
      updatedAt: timestamp(wallet.updated_at, 'VLT wallet update time'),
    },
    bank: parseBank(row.bank),
    benefits: row.benefits.map(parseBenefit),
    activity: parseActivityPage(row.activity),
  }
}

function normalizeCursor(cursor?: NetShneiderBankCursor) {
  if (!cursor) return { requested_cursor_at: null, requested_cursor_id: null }
  if (Number.isNaN(Date.parse(cursor.at)) || !UUID_PATTERN.test(cursor.id)) {
    throw new Error('The SHNEIDER BANK activity cursor is invalid.')
  }
  return { requested_cursor_at: cursor.at, requested_cursor_id: cursor.id }
}

function normalizeLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return NET_SHNEIDER_BANK_HISTORY_DEFAULT_LIMIT
  return Math.min(Math.max(Math.trunc(limit ?? NET_SHNEIDER_BANK_HISTORY_DEFAULT_LIMIT), 1), NET_SHNEIDER_BANK_HISTORY_MAX_LIMIT)
}

function normalizeAmount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > NET_SHNEIDER_BANK_MAX_TRANSFER_AMOUNT) {
    throw new Error(`Amount must be a whole value from 1 to ${NET_SHNEIDER_BANK_MAX_TRANSFER_AMOUNT}.`)
  }
  return value
}

function requestKey(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new Error('A valid bank request key is required.')
  return value
}

export async function fetchNetShneiderBank(expectedIdentityLinkId: string, cursor?: NetShneiderBankCursor, limit?: number): Promise<NetShneiderBankPayload> {
  const { data, error } = await client().rpc('fetch_net_economy_shneider_bank', {
    requested_expected_identity_link_id: uuid(expectedIdentityLinkId, 'expected identity link id'),
    ...normalizeCursor(cursor),
    requested_limit: normalizeLimit(limit),
  })
  if (error) throw mapError('Unable to load SHNEIDER BANK', error)
  return parsePayload(data)
}

export async function openNetShneiderBank(expectedIdentityLinkId: string): Promise<NetShneiderBankPayload> {
  const { data, error } = await client().rpc('open_net_economy_shneider_bank', {
    requested_expected_identity_link_id: uuid(expectedIdentityLinkId, 'expected identity link id'),
  })
  if (error) throw mapError('Unable to open SHNEIDER BANK', error)
  return parsePayload(data)
}

export async function transferNetShneiderBank(input: {
  expectedIdentityLinkId: string
  direction: NetShneiderBankDirection
  amount: number
  requestKey: string
}): Promise<NetShneiderBankPayload> {
  const { data, error } = await client().rpc('transfer_net_economy_shneider_bank', {
    requested_expected_identity_link_id: uuid(input.expectedIdentityLinkId, 'expected identity link id'),
    requested_direction: input.direction,
    requested_amount: normalizeAmount(input.amount),
    requested_request_key: requestKey(input.requestKey),
  })
  if (error) throw mapError('SHNEIDER BANK transfer failed', error)
  return parsePayload(data)
}

export async function payNetShneiderBank(input: {
  expectedIdentityLinkId: string
  paymentIdentifier: string
  amount: number
  requestKey: string
}): Promise<NetShneiderBankPayload> {
  const identifier = input.paymentIdentifier.trim().replace(/^@/, '').toLowerCase()
  if (!PAYMENT_IDENTIFIER_PATTERN.test(identifier)) throw new Error('Choose a valid SHNEIDER BANK recipient.')
  const { data, error } = await client().rpc('transfer_net_economy_shneider_bank_payment', {
    requested_expected_identity_link_id: uuid(input.expectedIdentityLinkId, 'expected identity link id'),
    requested_payment_identifier: identifier,
    requested_amount: normalizeAmount(input.amount),
    requested_request_key: requestKey(input.requestKey),
  })
  if (error) throw mapError('SHNEIDER BANK payment failed', error)
  return parsePayload(data)
}

export function searchNetShneiderBankPayees(expectedIdentityLinkId: string, query: string): Promise<readonly NetBankPayee[]> {
  return searchNetBankPayees('shneider', expectedIdentityLinkId, query)
}
