import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'
import {
  NET_ECONOMY_CURRENCIES,
  NET_ECONOMY_HISTORY_DEFAULT_LIMIT,
  NET_ECONOMY_HISTORY_MAX_LIMIT,
  NET_ECONOMY_MAX_TRANSACTION_AMOUNT,
  NET_ECONOMY_NOTE_MAX_LENGTH,
  NET_ECONOMY_PAYEE_QUERY_MAX_LENGTH,
  NET_ECONOMY_PAYEE_QUERY_MIN_LENGTH,
  NET_ECONOMY_REASON_MAX_LENGTH,
  NetEconomyError,
  netEconomyTransactionKinds,
  type NetEconomyAccountStatus,
  type NetEconomyActivity,
  type NetEconomyActivityPage,
  type NetEconomyBalance,
  type NetEconomyCurrency,
  type NetEconomyCursor,
  type NetEconomyDirection,
  type NetEconomyGmAdjustmentAction,
  type NetEconomyGmWalletDirectoryRow,
  type NetEconomyPayee,
  type NetEconomyTransactionKind,
  type NetEconomyWalletIdentity,
  type NetEconomyWalletPayload,
} from './netEconomyTypes'

interface RpcErrorLike {
  readonly code?: string
  readonly message: string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SAFE_BALANCE_MAX = 9_000_000_000_000_000

function client() {
  if (!supabase) throw new NetEconomyError('request-failed', SUPABASE_CONFIG_ERROR)
  return supabase
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function invalidResponse(message: string): never {
  throw new NetEconomyError('invalid-server-response', message)
}

function requiredString(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    return invalidResponse(`Invalid ${label} returned by the economy server.`)
  }
  return value
}

function optionalString(value: unknown, maximum: number, label: string): string | undefined {
  if (value === null || value === undefined) return undefined
  return requiredString(value, maximum, label)
}

function uuid(value: unknown, label: string): string {
  const parsed = requiredString(value, 64, label)
  if (!UUID_PATTERN.test(parsed)) return invalidResponse(`Invalid ${label} returned by the economy server.`)
  return parsed
}

function timestamp(value: unknown, label: string): string {
  const parsed = requiredString(value, 64, label)
  if (Number.isNaN(Date.parse(parsed))) return invalidResponse(`Invalid ${label} returned by the economy server.`)
  return parsed
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') return invalidResponse(`Invalid ${label} returned by the economy server.`)
  return value
}

function safeInteger(value: unknown, label: string, maximum = SAFE_BALANCE_MAX): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || Math.abs(parsed) > maximum) {
    return invalidResponse(`Invalid ${label} returned by the economy server.`)
  }
  return parsed
}

function enumValue<const T extends readonly string[]>(value: unknown, values: T, label: string): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    return invalidResponse(`Invalid ${label} returned by the economy server.`)
  }
  return value as T[number]
}

function normalizeCurrency(value: unknown): NetEconomyCurrency {
  return enumValue(value, NET_ECONOMY_CURRENCIES, 'currency')
}

function mapError(prefix: string, error: RpcErrorLike): NetEconomyError {
  const message = error.message ?? ''
  if (message.includes('ECONOMY_ACTIVE_IDENTITY_REQUIRED')) {
    return new NetEconomyError('active-identity-required', 'Select a playable identity before opening its VLT wallet.')
  }
  if (message.includes('ECONOMY_GM_REQUIRED')) {
    return new NetEconomyError('gm-required', 'Authoritative GM economy access is required.')
  }
  if (error.code === '42501' || message.includes('ECONOMY_AUTH_REQUIRED')) {
    return new NetEconomyError('authentication-required', 'Authentication through VEGA MESH is required.')
  }
  if (message.includes('ECONOMY_CURSOR_INVALID')) {
    return new NetEconomyError('invalid-cursor', 'The activity cursor is invalid.')
  }
  if (message.includes('ECONOMY_CURRENCY_INVALID') || message.includes('ECONOMY_LEDGER_CURRENCY_MISMATCH')) {
    return new NetEconomyError('currency-invalid', 'The requested VLT currency is not supported.')
  }
  if (message.includes('ECONOMY_KARMA_NOT_AVAILABLE')) {
    return new NetEconomyError('karma-not-available', 'Karma is not registered for this VLT identity.')
  }
  if (message.includes('ECONOMY_KARMA_RANGE_INVALID')) {
    return new NetEconomyError('karma-range-invalid', 'That adjustment would exceed the supported Karma range.')
  }
  if (message.includes('ECONOMY_PAYEE_QUERY_INVALID') || message.includes('ECONOMY_DIRECTORY_QUERY_INVALID')) {
    return new NetEconomyError('invalid-query', 'Enter a valid identity or VLT payment identifier.')
  }
  if (message.includes('ECONOMY_PAYEE_NOT_FOUND')) {
    return new NetEconomyError('payee-not-found', 'That VLT recipient is not available.')
  }
  if (message.includes('ECONOMY_SELF_TRANSFER_INVALID')) {
    return new NetEconomyError('self-transfer', 'A wallet cannot pay itself.')
  }
  if (message.includes('ECONOMY_INSUFFICIENT_FUNDS')) {
    return new NetEconomyError('insufficient-funds', 'The selected balance does not have enough funds for this transaction.')
  }
  if (message.includes('ECONOMY_IDEMPOTENCY_CONFLICT')) {
    return new NetEconomyError('idempotency-conflict', 'This request key was already used for different payment details.')
  }
  if (message.includes('ECONOMY_WALLET_NOT_FOUND')) {
    return new NetEconomyError('wallet-not-found', 'The requested VLT wallet was not found.')
  }
  if (message.includes('ECONOMY_WALLET_INACTIVE')) {
    return new NetEconomyError('wallet-inactive', 'The requested VLT balance is not active.')
  }
  if (message.includes('ECONOMY_')) {
    return new NetEconomyError('invalid-request', 'The economy server rejected this request.')
  }
  return new NetEconomyError('request-failed', `${prefix}: ${message}`)
}

function parseIdentity(value: unknown): NetEconomyWalletIdentity {
  if (!isRecord(value)) return invalidResponse('Missing VLT identity payload.')
  return {
    paymentIdentifier: requiredString(value.payment_identifier, 40, 'payment identifier'),
    displayName: requiredString(value.display_name, 160, 'wallet display name'),
  }
}

function parseBalance(value: unknown): NetEconomyBalance {
  if (!isRecord(value)) return invalidResponse('Invalid VLT balance payload.')
  return {
    accountId: uuid(value.account_id, 'balance account id'),
    balanceAmount: safeInteger(value.balance_amount, 'wallet balance'),
    currencyCode: normalizeCurrency(value.currency_code),
    status: enumValue(value.status, ['active', 'closed'] as const, 'wallet status') as NetEconomyAccountStatus,
    updatedAt: timestamp(value.updated_at, 'wallet update time'),
  }
}

function parseActivity(value: unknown): NetEconomyActivity {
  if (!isRecord(value)) return invalidResponse('Invalid wallet activity row.')
  const amount = safeInteger(value.amount, 'activity amount', NET_ECONOMY_MAX_TRANSACTION_AMOUNT)
  if (amount === 0) return invalidResponse('Invalid zero-value wallet activity.')
  const direction = enumValue(value.direction, ['incoming', 'outgoing'] as const, 'activity direction') as NetEconomyDirection
  if ((amount > 0) !== (direction === 'incoming')) return invalidResponse('Inconsistent activity direction.')
  const counterpartyInstitutionCode = optionalString(
    value.counterparty_institution_code,
    32,
    'counterparty institution code',
  )
  const counterpartyInstitutionName = optionalString(
    value.counterparty_institution_name,
    80,
    'counterparty institution name',
  )
  if (Boolean(counterpartyInstitutionCode) !== Boolean(counterpartyInstitutionName)) {
    return invalidResponse('Incomplete counterparty institution returned by the economy server.')
  }
  return {
    transactionId: uuid(value.transaction_id, 'transaction id'),
    amount,
    currencyCode: normalizeCurrency(value.currency_code),
    direction,
    transactionKind: enumValue(value.transaction_kind, netEconomyTransactionKinds, 'transaction kind') as NetEconomyTransactionKind,
    ...(optionalString(value.counterparty_display_name, 160, 'counterparty name') ? {
      counterpartyDisplayName: optionalString(value.counterparty_display_name, 160, 'counterparty name'),
    } : {}),
    ...(optionalString(value.counterparty_payment_identifier, 40, 'counterparty identifier') ? {
      counterpartyPaymentIdentifier: optionalString(value.counterparty_payment_identifier, 40, 'counterparty identifier'),
    } : {}),
    ...(counterpartyInstitutionCode && counterpartyInstitutionName ? {
      counterpartyInstitutionCode,
      counterpartyInstitutionName,
    } : {}),
    ...(optionalString(value.note, 200, 'activity note') ? { note: optionalString(value.note, 200, 'activity note') } : {}),
    createdAt: timestamp(value.created_at, 'transaction time'),
  }
}

function parseActivityPage(value: unknown): NetEconomyActivityPage {
  if (!isRecord(value) || !Array.isArray(value.items)) return invalidResponse('Invalid wallet activity page.')
  const hasMore = boolean(value.has_more, 'activity continuation')
  const cursorAt = value.next_cursor_at === null || value.next_cursor_at === undefined
    ? undefined
    : timestamp(value.next_cursor_at, 'activity cursor time')
  const cursorId = value.next_cursor_id === null || value.next_cursor_id === undefined
    ? undefined
    : uuid(value.next_cursor_id, 'activity cursor id')
  if (Boolean(cursorAt) !== Boolean(cursorId) || (hasMore && (!cursorAt || !cursorId))) {
    return invalidResponse('Invalid activity cursor returned by the economy server.')
  }
  return {
    items: value.items.map(parseActivity),
    hasMore,
    ...(cursorAt && cursorId ? { nextCursor: { at: cursorAt, id: cursorId } } : {}),
  }
}

function parseWalletPayload(value: unknown): NetEconomyWalletPayload {
  if (!isRecord(value) || !Array.isArray(value.balances)) return invalidResponse('Invalid VLT wallet response.')
  const balances = value.balances.map(parseBalance)
  if (balances.length < 1 || balances.length > NET_ECONOMY_CURRENCIES.length) {
    return invalidResponse('Invalid VLT balance set returned by the economy server.')
  }
  if (balances.filter((balance) => balance.currencyCode === 'VG').length !== 1
    || balances.filter((balance) => balance.currencyCode === 'KARMA').length > 1
  ) {
    return invalidResponse('Invalid VLT currency accounts returned by the economy server.')
  }
  return {
    identity: parseIdentity(value.identity),
    balances,
    activity: parseActivityPage(value.activity),
  }
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return NET_ECONOMY_HISTORY_DEFAULT_LIMIT
  return Math.min(Math.max(Math.trunc(limit ?? NET_ECONOMY_HISTORY_DEFAULT_LIMIT), 1), NET_ECONOMY_HISTORY_MAX_LIMIT)
}

function normalizeCursor(cursor: NetEconomyCursor | undefined) {
  if (!cursor) return { requested_cursor_at: null, requested_cursor_id: null }
  if (Number.isNaN(Date.parse(cursor.at)) || !UUID_PATTERN.test(cursor.id)) {
    throw new NetEconomyError('invalid-cursor', 'The activity cursor is invalid.')
  }
  return { requested_cursor_at: cursor.at, requested_cursor_id: cursor.id }
}

function validateAmount(amount: number): number {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > NET_ECONOMY_MAX_TRANSACTION_AMOUNT) {
    throw new NetEconomyError('invalid-request', `Amount must be a whole value from 1 to ${NET_ECONOMY_MAX_TRANSACTION_AMOUNT}.`)
  }
  return amount
}

function validateRequestKey(requestKey: string): string {
  if (!UUID_PATTERN.test(requestKey)) throw new NetEconomyError('invalid-request', 'A valid payment request key is required.')
  return requestKey
}

function validateCurrency(currency: NetEconomyCurrency): NetEconomyCurrency {
  if (!NET_ECONOMY_CURRENCIES.includes(currency)) throw new NetEconomyError('currency-invalid', 'Choose vG or Karma.')
  return currency
}

export async function fetchNetEconomyWallet(
  expectedIdentityLinkId: string,
  cursor?: NetEconomyCursor,
  limit?: number,
): Promise<NetEconomyWalletPayload> {
  const { data, error } = await client().rpc('fetch_net_economy_wallet_v2', {
    requested_expected_identity_link_id: uuid(expectedIdentityLinkId, 'expected identity link id'),
    ...normalizeCursor(cursor),
    requested_limit: normalizeLimit(limit),
  })
  if (error) throw mapError('Unable to load VLT', error)
  return parseWalletPayload(data)
}

export async function searchNetEconomyPayees(
  expectedIdentityLinkId: string,
  query: string,
): Promise<readonly NetEconomyPayee[]> {
  const normalized = query.trim().slice(0, NET_ECONOMY_PAYEE_QUERY_MAX_LENGTH)
  if (normalized.length < NET_ECONOMY_PAYEE_QUERY_MIN_LENGTH) return []
  const { data, error } = await client().rpc('search_net_economy_payees', {
    requested_expected_identity_link_id: uuid(expectedIdentityLinkId, 'expected identity link id'),
    requested_query: normalized,
    requested_limit: 20,
  })
  if (error) throw mapError('Unable to search VLT identities', error)
  if (!Array.isArray(data) || data.length > 20) return invalidResponse('Invalid VLT recipient directory.')
  return data.map((item) => {
    if (!isRecord(item)) return invalidResponse('Invalid VLT recipient row.')
    return {
      paymentIdentifier: requiredString(item.payment_identifier, 40, 'recipient identifier'),
      displayName: requiredString(item.display_name, 160, 'recipient display name'),
      karmaAvailable: boolean(item.karma_available, 'recipient Karma availability'),
    }
  })
}

export async function transferNetEconomyWallet(input: {
  expectedIdentityLinkId: string
  paymentIdentifier: string
  currency: NetEconomyCurrency
  amount: number
  note?: string
  requestKey: string
}): Promise<NetEconomyWalletPayload> {
  const note = input.note?.trim() ?? ''
  if (note.length > NET_ECONOMY_NOTE_MAX_LENGTH) throw new NetEconomyError('invalid-request', 'Payment note is too long.')
  const { data, error } = await client().rpc('transfer_net_economy_wallet_v2', {
    requested_expected_identity_link_id: uuid(input.expectedIdentityLinkId, 'expected identity link id'),
    requested_payment_identifier: input.paymentIdentifier.trim().toLowerCase(),
    requested_currency_code: validateCurrency(input.currency),
    requested_amount: validateAmount(input.amount),
    requested_note: note || null,
    requested_request_key: validateRequestKey(input.requestKey),
  })
  if (error) throw mapError('Payment failed', error)
  return parseWalletPayload(data)
}

export async function fetchNetEconomyGmWalletDirectory(query = ''): Promise<readonly NetEconomyGmWalletDirectoryRow[]> {
  const normalized = query.trim().slice(0, NET_ECONOMY_PAYEE_QUERY_MAX_LENGTH)
  const { data, error } = await client().rpc('fetch_net_economy_gm_wallet_directory_v2', {
    requested_query: normalized || null,
    requested_limit: 100,
  })
  if (error) throw mapError('Unable to load Economy Control', error)
  if (!Array.isArray(data) || data.length > 100) return invalidResponse('Invalid economy wallet directory.')
  return data.map((item) => {
    if (!isRecord(item)) return invalidResponse('Invalid economy wallet directory row.')
    return {
      paymentIdentifier: requiredString(item.payment_identifier, 40, 'payment identifier'),
      displayName: requiredString(item.display_name, 160, 'wallet display name'),
      vgBalanceAmount: safeInteger(item.vg_balance_amount, 'vG balance'),
      karmaBalanceAmount: item.karma_balance_amount === null
        ? null
        : safeInteger(item.karma_balance_amount, 'Karma balance'),
      updatedAt: timestamp(item.updated_at, 'wallet update time'),
    }
  })
}

export async function fetchNetEconomyGmWallet(paymentIdentifier: string, cursor?: NetEconomyCursor, limit?: number): Promise<NetEconomyWalletPayload> {
  const { data, error } = await client().rpc('fetch_net_economy_gm_wallet_v2', {
    requested_payment_identifier: paymentIdentifier.trim().toLowerCase(),
    ...normalizeCursor(cursor),
    requested_limit: normalizeLimit(limit),
  })
  if (error) throw mapError('Unable to load VLT wallet', error)
  return parseWalletPayload(data)
}

export async function adjustNetEconomyGmWallet(input: {
  paymentIdentifier: string
  currency: NetEconomyCurrency
  action: NetEconomyGmAdjustmentAction
  amount: number
  reason: string
  requestKey: string
}): Promise<NetEconomyWalletPayload> {
  const reason = input.reason.trim()
  if (!reason || reason.length > NET_ECONOMY_REASON_MAX_LENGTH) {
    throw new NetEconomyError('invalid-request', 'A concise adjustment reason is required.')
  }
  const { data, error } = await client().rpc('adjust_net_economy_gm_wallet_v2', {
    requested_payment_identifier: input.paymentIdentifier.trim().toLowerCase(),
    requested_currency_code: validateCurrency(input.currency),
    requested_action: input.action,
    requested_amount: validateAmount(input.amount),
    requested_reason: reason,
    requested_request_key: validateRequestKey(input.requestKey),
  })
  if (error) throw mapError('Economy adjustment failed', error)
  return parseWalletPayload(data)
}

export async function enableNetEconomyGmKarmaProfile(paymentIdentifier: string): Promise<NetEconomyWalletPayload> {
  const { data, error } = await client().rpc('enable_net_economy_gm_karma_profile', {
    requested_payment_identifier: paymentIdentifier.trim().toLowerCase(),
  })
  if (error) throw mapError('Karma enrolment failed', error)
  return parseWalletPayload(data)
}
