import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'
import { mapNetBankPaymentError, searchNetBankPayees } from './netBankPaymentService'
import type { NetBankPayee } from './netBankPaymentTypes'
import {
  NET_VOX_BANK_HISTORY_DEFAULT_LIMIT,
  NET_VOX_BANK_HISTORY_MAX_LIMIT,
  NET_VOX_BANK_MAX_TRANSFER_AMOUNT,
  NetVoxBankError,
  type NetVoxBankAccount,
  type NetVoxBankActivity,
  type NetVoxBankActivityKind,
  type NetVoxBankActivityPage,
  type NetVoxBankCursor,
  type NetVoxBankDirection,
  type NetVoxBankPayload,
  type NetVoxBankYield,
} from './netVoxBankTypes'

interface RpcErrorLike {
  readonly code?: string
  readonly message: string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SAFE_BALANCE_MAX = 9_000_000_000_000_000
const PAYMENT_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/
const ACTIVITY_KINDS = ['bank-deposit', 'bank-withdrawal', 'bank-yield', 'bank-transfer'] as const

function client() {
  if (!supabase) throw new NetVoxBankError('request-failed', SUPABASE_CONFIG_ERROR)
  return supabase
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function invalidResponse(message: string): never {
  throw new NetVoxBankError('invalid-server-response', message)
}

function requiredString(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    return invalidResponse(`Invalid ${label} returned by VOX BANK.`)
  }
  return value
}

function uuid(value: unknown, label: string): string {
  const parsed = requiredString(value, 64, label)
  if (!UUID_PATTERN.test(parsed)) return invalidResponse(`Invalid ${label} returned by VOX BANK.`)
  return parsed
}

function timestamp(value: unknown, label: string): string {
  const parsed = requiredString(value, 64, label)
  if (Number.isNaN(Date.parse(parsed))) return invalidResponse(`Invalid ${label} returned by VOX BANK.`)
  return parsed
}

function safeInteger(value: unknown, label: string, maximum = SAFE_BALANCE_MAX): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || Math.abs(parsed) > maximum) {
    return invalidResponse(`Invalid ${label} returned by VOX BANK.`)
  }
  return parsed
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') return invalidResponse(`Invalid ${label} returned by VOX BANK.`)
  return value
}

function mapError(prefix: string, error: RpcErrorLike): NetVoxBankError {
  const message = error.message ?? ''
  if (message.includes('ECONOMY_ACTIVE_IDENTITY_REQUIRED')) {
    return new NetVoxBankError('active-identity-required', 'Select a playable identity before opening VOX BANK.')
  }
  if (error.code === '42501' || message.includes('ECONOMY_AUTH_REQUIRED')) {
    return new NetVoxBankError('authentication-required', 'Authentication through VEGA MESH is required.')
  }
  if (message.includes('VOX_BANK_ACCOUNT_NOT_FOUND')) {
    return new NetVoxBankError('account-not-found', 'Open a VOX BANK account before moving funds.')
  }
  if (message.includes('VOX_BANK_ACCOUNT_INACTIVE')) {
    return new NetVoxBankError('account-inactive', 'This VOX BANK account is not active.')
  }
  if (message.includes('VOX_BANK_INSTITUTION_UNAVAILABLE') || message.includes('VOX_BANK_STATE_UNAVAILABLE')) {
    return new NetVoxBankError('institution-unavailable', 'VOX BANK is temporarily unavailable.')
  }
  if (message.includes('ECONOMY_INSUFFICIENT_FUNDS')) {
    return new NetVoxBankError('insufficient-funds', 'Your VLT wallet does not have enough vG for that deposit.')
  }
  if (message.includes('VOX_BANK_INSUFFICIENT_FUNDS')) {
    return new NetVoxBankError('insufficient-funds', 'Your VOX BANK account does not have enough vG for that withdrawal.')
  }
  if (message.includes('VOX_BANK_YIELD_NOT_READY')) {
    return new NetVoxBankError('yield-not-ready', 'VOX Yield has not reached its eligibility time.')
  }
  if (message.includes('VOX_BANK_YIELD_NOT_AVAILABLE')) {
    return new NetVoxBankError('yield-not-available', 'The eligible principal does not produce a whole-vG yield yet.')
  }
  if (message.includes('ECONOMY_IDEMPOTENCY_CONFLICT')) {
    return new NetVoxBankError('idempotency-conflict', 'This request key was already used for a different bank action.')
  }
  if (message.includes('ECONOMY_BANK_') || message.includes('ECONOMY_SELF_TRANSFER_INVALID')) {
    return new NetVoxBankError('invalid-request', mapNetBankPaymentError('VOX BANK', error).message)
  }
  if (message.includes('ECONOMY_') || message.includes('VOX_BANK_')) {
    return new NetVoxBankError('invalid-request', 'VOX BANK rejected this request.')
  }
  return new NetVoxBankError('request-failed', `${prefix}: ${message}`)
}

function parseActivity(value: unknown): NetVoxBankActivity {
  if (!isRecord(value)) return invalidResponse('Invalid bank activity row.')
  const transactionKind = requiredString(value.transaction_kind, 40, 'activity kind')
  if (!ACTIVITY_KINDS.includes(transactionKind as NetVoxBankActivityKind)) {
    return invalidResponse('Unsupported bank activity kind.')
  }
  const amount = safeInteger(value.amount, 'activity amount', NET_VOX_BANK_MAX_TRANSFER_AMOUNT)
  if (amount === 0) return invalidResponse('Invalid zero-value bank activity.')
  return {
    transactionId: uuid(value.transaction_id, 'transaction id'),
    amount,
    transactionKind: transactionKind as NetVoxBankActivityKind,
    ...(typeof value.counterparty_display_name === 'string' && value.counterparty_display_name.trim()
      ? { counterpartyDisplayName: value.counterparty_display_name }
      : {}),
    ...(typeof value.counterparty_payment_identifier === 'string'
      && PAYMENT_IDENTIFIER_PATTERN.test(value.counterparty_payment_identifier)
      ? { counterpartyPaymentIdentifier: value.counterparty_payment_identifier }
      : {}),
    createdAt: timestamp(value.created_at, 'transaction time'),
  }
}

function parseActivityPage(value: unknown): NetVoxBankActivityPage {
  if (!isRecord(value) || !Array.isArray(value.items)) return invalidResponse('Invalid bank activity page.')
  const hasMore = boolean(value.has_more, 'activity continuation')
  const cursorAt = value.next_cursor_at == null ? undefined : timestamp(value.next_cursor_at, 'activity cursor time')
  const cursorId = value.next_cursor_id == null ? undefined : uuid(value.next_cursor_id, 'activity cursor id')
  if (Boolean(cursorAt) !== Boolean(cursorId) || (hasMore && (!cursorAt || !cursorId))) {
    return invalidResponse('Invalid activity cursor returned by VOX BANK.')
  }
  return {
    items: value.items.map(parseActivity),
    hasMore,
    ...(cursorAt && cursorId ? { nextCursor: { at: cursorAt, id: cursorId } } : {}),
  }
}

function parseBank(value: unknown): NetVoxBankAccount | null {
  if (value === null) return null
  if (!isRecord(value)) return invalidResponse('Invalid VOX BANK account payload.')
  const status = requiredString(value.status, 16, 'account status')
  if (status !== 'active' && status !== 'closed') return invalidResponse('Invalid VOX BANK account status.')
  if (value.currency_code !== 'VG') return invalidResponse('VOX BANK returned a non-vG account.')
  return {
    accountId: uuid(value.account_id, 'bank account id'),
    paymentIdentifier: (() => {
      const identifier = requiredString(value.payment_identifier, 40, 'bank payment identifier')
      if (!PAYMENT_IDENTIFIER_PATTERN.test(identifier)) return invalidResponse('Invalid bank payment identifier returned by VOX BANK.')
      return identifier
    })(),
    balanceAmount: safeInteger(value.balance_amount, 'bank balance'),
    status,
    openedAt: timestamp(value.opened_at, 'account opening time'),
    updatedAt: timestamp(value.updated_at, 'bank update time'),
  }
}

function parseYield(value: unknown, bank: NetVoxBankAccount | null): NetVoxBankYield | null {
  if (value === null) return null
  if (!bank || !isRecord(value)) return invalidResponse('Invalid VOX Yield payload.')
  const rateBasisPoints = safeInteger(value.rate_basis_points, 'yield rate', 10_000)
  const periodSeconds = safeInteger(value.period_seconds, 'yield period', 366 * 24 * 60 * 60)
  const projectedAmount = safeInteger(value.projected_amount, 'projected yield', NET_VOX_BANK_MAX_TRANSFER_AMOUNT)
  if (rateBasisPoints < 0 || periodSeconds < 1 || projectedAmount < 0) {
    return invalidResponse('Invalid VOX Yield values.')
  }
  return {
    rateBasisPoints,
    periodSeconds,
    anchorAt: timestamp(value.anchor_at, 'yield anchor'),
    eligibleAt: timestamp(value.eligible_at, 'yield eligibility time'),
    projectedAmount,
    ready: boolean(value.ready, 'yield readiness'),
  }
}

function parsePayload(value: unknown): NetVoxBankPayload {
  if (!isRecord(value) || !isRecord(value.identity) || !isRecord(value.wallet)) {
    return invalidResponse('Invalid VOX BANK response.')
  }
  const bank = parseBank(value.bank)
  const bankYield = parseYield(value.yield, bank)
  if (Boolean(bank) !== Boolean(bankYield)) return invalidResponse('Incomplete VOX BANK account state.')
  return {
    serverNow: timestamp(value.server_now, 'server time'),
    clientReceivedAtMs: Date.now(),
    identity: { displayName: requiredString(value.identity.display_name, 160, 'account holder') },
    wallet: {
      accountId: uuid(value.wallet.account_id, 'VLT wallet account id'),
      balanceAmount: safeInteger(value.wallet.balance_amount, 'VLT wallet balance'),
      updatedAt: timestamp(value.wallet.updated_at, 'VLT wallet update time'),
    },
    bank,
    yield: bankYield,
    activity: parseActivityPage(value.activity),
  }
}

function normalizeCursor(cursor: NetVoxBankCursor | undefined) {
  if (!cursor) return { requested_cursor_at: null, requested_cursor_id: null }
  if (Number.isNaN(Date.parse(cursor.at)) || !UUID_PATTERN.test(cursor.id)) {
    throw new NetVoxBankError('invalid-request', 'The bank activity cursor is invalid.')
  }
  return { requested_cursor_at: cursor.at, requested_cursor_id: cursor.id }
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return NET_VOX_BANK_HISTORY_DEFAULT_LIMIT
  return Math.min(Math.max(Math.trunc(limit ?? NET_VOX_BANK_HISTORY_DEFAULT_LIMIT), 1), NET_VOX_BANK_HISTORY_MAX_LIMIT)
}

function requestKey(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new NetVoxBankError('invalid-request', 'A valid bank request key is required.')
  return value
}

function amount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > NET_VOX_BANK_MAX_TRANSFER_AMOUNT) {
    throw new NetVoxBankError('invalid-request', `Amount must be a whole value from 1 to ${NET_VOX_BANK_MAX_TRANSFER_AMOUNT}.`)
  }
  return value
}

export async function fetchNetVoxBank(expectedIdentityLinkId: string, cursor?: NetVoxBankCursor, limit?: number): Promise<NetVoxBankPayload> {
  const { data, error } = await client().rpc('fetch_net_economy_vox_bank', {
    requested_expected_identity_link_id: uuid(expectedIdentityLinkId, 'expected identity link id'),
    ...normalizeCursor(cursor),
    requested_limit: normalizeLimit(limit),
  })
  if (error) throw mapError('Unable to load VOX BANK', error)
  return parsePayload(data)
}

export async function openNetVoxBank(expectedIdentityLinkId: string): Promise<NetVoxBankPayload> {
  const { data, error } = await client().rpc('open_net_economy_vox_bank', {
    requested_expected_identity_link_id: uuid(expectedIdentityLinkId, 'expected identity link id'),
  })
  if (error) throw mapError('Unable to open VOX BANK', error)
  return parsePayload(data)
}

export async function transferNetVoxBank(input: {
  expectedIdentityLinkId: string
  direction: NetVoxBankDirection
  amount: number
  requestKey: string
}): Promise<NetVoxBankPayload> {
  const { data, error } = await client().rpc('transfer_net_economy_vox_bank', {
    requested_expected_identity_link_id: uuid(input.expectedIdentityLinkId, 'expected identity link id'),
    requested_direction: input.direction,
    requested_amount: amount(input.amount),
    requested_request_key: requestKey(input.requestKey),
  })
  if (error) throw mapError('Bank transfer failed', error)
  return parsePayload(data)
}

export async function claimNetVoxBankYield(expectedIdentityLinkId: string, requestId: string): Promise<NetVoxBankPayload> {
  const { data, error } = await client().rpc('claim_net_economy_vox_bank_yield', {
    requested_expected_identity_link_id: uuid(expectedIdentityLinkId, 'expected identity link id'),
    requested_request_key: requestKey(requestId),
  })
  if (error) throw mapError('VOX Yield claim failed', error)
  return parsePayload(data)
}

export function searchNetVoxBankPayees(expectedIdentityLinkId: string, query: string): Promise<readonly NetBankPayee[]> {
  return searchNetBankPayees('vox', expectedIdentityLinkId, query)
}

export async function payNetVoxBank(input: {
  expectedIdentityLinkId: string
  paymentIdentifier: string
  amount: number
  requestKey: string
}): Promise<NetVoxBankPayload> {
  const identifier = input.paymentIdentifier.trim().replace(/^@/, '').toLowerCase()
  if (!PAYMENT_IDENTIFIER_PATTERN.test(identifier)) {
    throw new NetVoxBankError('invalid-request', 'Choose a valid VOX BANK recipient.')
  }
  const { data, error } = await client().rpc('transfer_net_economy_vox_bank_payment', {
    requested_expected_identity_link_id: uuid(input.expectedIdentityLinkId, 'expected identity link id'),
    requested_payment_identifier: identifier,
    requested_amount: amount(input.amount),
    requested_request_key: requestKey(input.requestKey),
  })
  if (error) throw mapError('VOX BANK payment failed', error)
  return parsePayload(data)
}
