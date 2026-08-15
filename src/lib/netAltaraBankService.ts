import type { NetBankPayee } from './netBankPaymentTypes'
import { isSharedMediaReference } from './media/mediaReference'
import { resolveSharedMediaUrls } from './media/mediaStorage'
import {
  NET_ALTARA_BANK_DIRECTORY_DEFAULT_LIMIT,
  NET_ALTARA_BANK_DIRECTORY_MAX_LIMIT,
  NET_ALTARA_BANK_HISTORY_DEFAULT_LIMIT,
  NET_ALTARA_BANK_HISTORY_MAX_LIMIT,
  NET_ALTARA_BANK_MAX_TRANSFER_AMOUNT,
  NET_ALTARA_BANK_REASON_MAX_LENGTH,
  NetAltaraBankError,
  type NetAltaraBankAccount,
  type NetAltaraBankActivity,
  type NetAltaraBankActivityKind,
  type NetAltaraBankActivityPage,
  type NetAltaraBankCursor,
  type NetAltaraBankGmDirectoryRow,
  type NetAltaraBankGmMutation,
  type NetAltaraBankPayload,
  type NetAltaraBankQuote,
  type NetAltaraCurrency,
  type NetAltaraCurrencyCode,
  type NetAltaraEconomyConfiguration,
  type NetAltaraFxRate,
} from './netAltaraBankTypes'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'

interface RpcErrorLike { readonly code?: string; readonly message: string }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PAYMENT_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/
const CURRENCY_CODES = ['VG', 'FINIT', 'SECTUS'] as const
const ACTIVITY_KINDS = [
  'bank-transfer', 'bank-fx-debit', 'bank-fx-credit', 'gm-credit', 'gm-debit',
] as const satisfies readonly NetAltaraBankActivityKind[]
const SAFE_BALANCE_MAX = 9_000_000_000_000_000

function client() {
  if (!supabase) throw new NetAltaraBankError('request-failed', SUPABASE_CONFIG_ERROR)
  return supabase
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function invalidResponse(message: string): never {
  throw new NetAltaraBankError('invalid-server-response', message)
}

function requiredString(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    return invalidResponse(`ALTARA BANK returned an invalid ${label}.`)
  }
  return value
}

function optionalString(value: unknown, maximum: number, label: string): string | undefined {
  if (value === null || value === undefined) return undefined
  return requiredString(value, maximum, label)
}

function uuid(value: unknown, label: string): string {
  const parsed = requiredString(value, 64, label)
  if (!UUID_PATTERN.test(parsed)) return invalidResponse(`ALTARA BANK returned an invalid ${label}.`)
  return parsed
}

function timestamp(value: unknown, label: string): string {
  const parsed = requiredString(value, 64, label)
  if (Number.isNaN(Date.parse(parsed))) return invalidResponse(`ALTARA BANK returned an invalid ${label}.`)
  return parsed
}

function integer(value: unknown, label: string, maximum = SAFE_BALANCE_MAX): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || Math.abs(parsed) > maximum) {
    return invalidResponse(`ALTARA BANK returned an invalid ${label}.`)
  }
  return parsed
}

function nonNegativeInteger(value: unknown, label: string, maximum = SAFE_BALANCE_MAX): number {
  const parsed = integer(value, label, maximum)
  if (parsed < 0) return invalidResponse(`ALTARA BANK returned an invalid ${label}.`)
  return parsed
}

function positiveInteger(value: unknown, label: string, maximum = SAFE_BALANCE_MAX): number {
  const parsed = integer(value, label, maximum)
  if (parsed < 1) return invalidResponse(`ALTARA BANK returned an invalid ${label}.`)
  return parsed
}

function currencyCode(value: unknown): NetAltaraCurrencyCode {
  if (!CURRENCY_CODES.includes(value as NetAltaraCurrencyCode)) {
    return invalidResponse('ALTARA BANK returned an unsupported currency.')
  }
  return value as NetAltaraCurrencyCode
}

function parseCurrency(value: unknown): NetAltaraCurrency {
  const row = asRecord(value)
  if (!row || row.decimals !== 0) return invalidResponse('ALTARA BANK returned invalid currency metadata.')
  const status = requiredString(row.status, 16, 'currency status')
  if (status !== 'active' && status !== 'inactive') return invalidResponse('ALTARA BANK returned invalid currency status.')
  return {
    currencyCode: currencyCode(row.currency_code),
    displayName: requiredString(row.display_name, 60, 'currency name'),
    singularLabel: requiredString(row.singular_label, 30, 'currency singular label'),
    pluralLabel: requiredString(row.plural_label, 30, 'currency plural label'),
    decimals: 0,
    status,
  }
}

function paymentIdentifier(value: unknown): string {
  const parsed = requiredString(value, 40, 'payment identifier')
  if (!PAYMENT_IDENTIFIER_PATTERN.test(parsed)) return invalidResponse('ALTARA BANK returned an invalid payment identifier.')
  return parsed
}

function normalizeExpectedIdentityLinkId(value: string): string {
  const normalized = value.trim()
  if (!UUID_PATTERN.test(normalized)) throw new NetAltaraBankError('invalid-request', 'A valid authoritative ALTARA identity is required.')
  return normalized
}

function normalizePaymentIdentifier(value: string): string {
  const normalized = value.trim().replace(/^@/, '').toLowerCase()
  if (!PAYMENT_IDENTIFIER_PATTERN.test(normalized)) throw new NetAltaraBankError('invalid-request', 'Choose a valid ALTARA BANK customer.')
  return normalized
}

function normalizeRequestKey(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new NetAltaraBankError('invalid-request', 'A valid ALTARA BANK request key is required.')
  return value
}

function normalizeAmount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > NET_ALTARA_BANK_MAX_TRANSFER_AMOUNT) {
    throw new NetAltaraBankError('invalid-request', `Amount must be a whole value from 1 to ${NET_ALTARA_BANK_MAX_TRANSFER_AMOUNT}.`)
  }
  return value
}

function normalizeReason(value: string): string {
  const reason = value.trim()
  if (!reason || reason.length > NET_ALTARA_BANK_REASON_MAX_LENGTH) {
    throw new NetAltaraBankError('invalid-request', `A reason of 1–${NET_ALTARA_BANK_REASON_MAX_LENGTH} characters is required.`)
  }
  return reason
}

function normalizeCursor(cursor: NetAltaraBankCursor | undefined) {
  if (!cursor) return { requested_cursor_at: null, requested_cursor_id: null }
  if (Number.isNaN(Date.parse(cursor.at)) || !UUID_PATTERN.test(cursor.id)) {
    throw new NetAltaraBankError('invalid-request', 'The ALTARA BANK activity cursor is invalid.')
  }
  return { requested_cursor_at: cursor.at, requested_cursor_id: cursor.id }
}

function normalizeLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value ?? fallback), 1), maximum)
}

function mapError(prefix: string, error: RpcErrorLike): NetAltaraBankError {
  const message = error.message ?? ''
  if (message.includes('ALTARA_BANK_IDENTITY_CONTEXT_CHANGED')) return new NetAltaraBankError('identity-context-changed', 'The controlled ALTARA identity changed. Reopen the bank and try again.')
  if (message.includes('NET_OS_SERVICE_ACCESS_DENIED')) return new NetAltaraBankError('service-access-denied', 'This identity cannot access ALTARA BANK.')
  if (message.includes('ALTARA_BANK_APP_NOT_INSTALLED')) return new NetAltaraBankError('app-not-installed', 'Install ALTARA BANK from ALTARA STORE before using this service.')
  if (message.includes('ALTARA_BANK_CURRENCY_REQUIRED') || message.includes('ECONOMY_CURRENCY_REQUIRED')) return new NetAltaraBankError('currency-required', 'Silver must assign this identity a home currency before the account can open.')
  if (message.includes('ALTARA_BANK_CURRENCY_CHANGE_REVIEW_REQUIRED')) return new NetAltaraBankError('currency-change-review', 'This currency cannot change because its ALTARA BANK account already contains money or history.')
  if (message.includes('ALTARA_BANK_FX_RATE_UNAVAILABLE')) return new NetAltaraBankError('fx-rate-unavailable', 'Exchange rate unavailable. Silver must configure this currency pair.')
  if (message.includes('ALTARA_BANK_FX_RATE_CHANGED')) return new NetAltaraBankError('fx-rate-changed', 'The exchange rate changed. Review a new quote before paying.')
  if (message.includes('ALTARA_BANK_ACCOUNT_NOT_FOUND')) return new NetAltaraBankError('account-not-found', 'Open an ALTARA BANK account before using this service.')
  if (message.includes('ALTARA_BANK_ACCOUNT_INACTIVE')) return new NetAltaraBankError('account-inactive', 'This ALTARA BANK account is not active.')
  if (message.includes('ALTARA_BANK_PAYEE_NOT_FOUND')) return new NetAltaraBankError('payee-not-found', 'That recipient does not have an active ALTARA BANK account.')
  if (message.includes('ECONOMY_SELF_TRANSFER_INVALID')) return new NetAltaraBankError('self-transfer', 'Choose another ALTARA BANK customer.')
  if (message.includes('ECONOMY_BANK_INSUFFICIENT_FUNDS')) return new NetAltaraBankError('insufficient-funds', 'The ALTARA BANK account does not have enough funds for this action.')
  if (message.includes('ECONOMY_IDEMPOTENCY_CONFLICT')) return new NetAltaraBankError('idempotency-conflict', 'This request key was already used for a different bank action.')
  if (message.includes('ECONOMY_GM_REQUIRED')) return new NetAltaraBankError('gm-required', 'ALTARA BANK administration requires Silver authority.')
  if (error.code === '42501' || message.includes('ECONOMY_AUTH_REQUIRED')) return new NetAltaraBankError('authentication-required', 'Authenticated ALTARA network access is required.')
  if (message.includes('ALTARA_BANK_') || message.includes('ECONOMY_')) return new NetAltaraBankError('invalid-request', 'ALTARA BANK rejected this request.')
  return new NetAltaraBankError('request-failed', `${prefix}: ${message}`)
}

function parseAccount(value: unknown): NetAltaraBankAccount | null {
  if (value === null) return null
  const row = asRecord(value)
  if (!row) return invalidResponse('ALTARA BANK returned an invalid account payload.')
  const currency = parseCurrency(row.currency)
  const code = currencyCode(row.currency_code)
  if (currency.currencyCode !== code) return invalidResponse('ALTARA BANK returned mismatched account currency metadata.')
  const status = requiredString(row.status, 16, 'account status')
  if (status !== 'active' && status !== 'closed') return invalidResponse('ALTARA BANK returned an invalid account status.')
  return {
    accountId: uuid(row.account_id, 'account id'),
    paymentIdentifier: paymentIdentifier(row.payment_identifier),
    currencyCode: code,
    currency,
    balanceAmount: nonNegativeInteger(row.balance_amount, 'account balance'),
    status,
    openedAt: timestamp(row.opened_at, 'account opening time'),
    updatedAt: timestamp(row.updated_at, 'account update time'),
  }
}

function parseActivity(value: unknown): NetAltaraBankActivity {
  const row = asRecord(value)
  if (!row) return invalidResponse('ALTARA BANK returned an invalid activity row.')
  const transactionKind = requiredString(row.transaction_kind, 40, 'activity kind')
  if (!ACTIVITY_KINDS.includes(transactionKind as NetAltaraBankActivityKind)) return invalidResponse('ALTARA BANK returned an unsupported activity kind.')
  const amount = integer(row.amount, 'activity amount')
  if (amount === 0) return invalidResponse('ALTARA BANK returned a zero-value activity row.')
  const fxOperationId = row.fx_operation_id == null ? undefined : uuid(row.fx_operation_id, 'FX operation id')
  const fx = fxOperationId ? {
    operationId: fxOperationId,
    sourceCurrencyCode: currencyCode(row.fx_source_currency_code),
    targetCurrencyCode: currencyCode(row.fx_target_currency_code),
    sourceAmount: nonNegativeInteger(row.fx_source_amount, 'FX source amount', NET_ALTARA_BANK_MAX_TRANSFER_AMOUNT),
    targetAmount: nonNegativeInteger(row.fx_target_amount, 'FX target amount', NET_ALTARA_BANK_MAX_TRANSFER_AMOUNT),
    sourceUnits: nonNegativeInteger(row.fx_source_units, 'FX source units', NET_ALTARA_BANK_MAX_TRANSFER_AMOUNT),
    targetUnits: nonNegativeInteger(row.fx_target_units, 'FX target units', NET_ALTARA_BANK_MAX_TRANSFER_AMOUNT),
    rateRevision: uuid(row.fx_rate_revision, 'FX rate revision'),
  } : undefined
  return {
    transactionId: uuid(row.transaction_id, 'transaction id'),
    amount,
    currencyCode: currencyCode(row.currency_code),
    transactionKind: transactionKind as NetAltaraBankActivityKind,
    ...(optionalString(row.counterparty_display_name, 160, 'counterparty display name') ? { counterpartyDisplayName: String(row.counterparty_display_name) } : {}),
    ...(row.counterparty_payment_identifier == null ? {} : { counterpartyPaymentIdentifier: paymentIdentifier(row.counterparty_payment_identifier) }),
    ...(optionalString(row.note, 200, 'activity note') ? { note: String(row.note) } : {}),
    createdAt: timestamp(row.created_at, 'activity time'),
    ...(fx ? { fx } : {}),
  }
}

function parseActivityPage(value: unknown): NetAltaraBankActivityPage {
  const row = asRecord(value)
  if (!row || !Array.isArray(row.items) || typeof row.has_more !== 'boolean') return invalidResponse('ALTARA BANK returned an invalid activity page.')
  const cursorAt = row.next_cursor_at == null ? undefined : timestamp(row.next_cursor_at, 'activity cursor time')
  const cursorId = row.next_cursor_id == null ? undefined : uuid(row.next_cursor_id, 'activity cursor id')
  if (Boolean(cursorAt) !== Boolean(cursorId) || (row.has_more && (!cursorAt || !cursorId))) return invalidResponse('ALTARA BANK returned an invalid activity cursor.')
  return { items: row.items.map(parseActivity), hasMore: row.has_more, ...(cursorAt && cursorId ? { nextCursor: { at: cursorAt, id: cursorId } } : {}) }
}

function parsePayload(value: unknown, expectedIdentityLinkId?: string): NetAltaraBankPayload {
  const row = asRecord(value); const identity = asRecord(row?.identity); const institution = asRecord(row?.institution)
  if (!row || !identity || !institution) return invalidResponse('ALTARA BANK returned an invalid account response.')
  if (institution.institution_code !== 'ALTARA' || institution.display_name !== 'ALTARA BANK' || institution.owner_name !== 'ALTARA') return invalidResponse('ALTARA BANK returned an invalid institution response.')
  const identityLinkId = uuid(identity.identity_link_id, 'identity link id')
  if (expectedIdentityLinkId && identityLinkId !== expectedIdentityLinkId) throw new NetAltaraBankError('identity-context-changed', 'ALTARA BANK returned a different identity context.')
  if (typeof row.currency_required !== 'boolean') return invalidResponse('ALTARA BANK returned an invalid currency-assignment state.')
  const homeCurrency = row.home_currency == null ? null : parseCurrency(row.home_currency)
  const bank = parseAccount(row.bank)
  if (row.currency_required !== (homeCurrency === null)) return invalidResponse('ALTARA BANK returned inconsistent currency-assignment state.')
  if (bank && (!homeCurrency || bank.currencyCode !== homeCurrency.currencyCode)) return invalidResponse('ALTARA BANK returned an account outside the assigned home currency.')
  if (bank && homeCurrency?.currencyCode !== bank.currencyCode) return invalidResponse('ALTARA BANK returned a bank outside the assigned home currency.')
  return {
    serverNow: timestamp(row.server_now, 'server time'), clientReceivedAtMs: Date.now(),
    identity: { identityLinkId, displayName: requiredString(identity.display_name, 160, 'account holder') },
    institution: { institutionCode: 'ALTARA', displayName: 'ALTARA BANK', ownerName: 'ALTARA' },
    currencyRequired: row.currency_required,
    homeCurrency,
    bank,
    activity: parseActivityPage(row.activity),
  }
}

function withoutAvatar<T extends { avatarUrl?: string }>(row: T): T {
  const next = { ...row }
  delete next.avatarUrl
  return next
}

async function resolveAvatarRows<T extends { avatarUrl?: string }>(rows: readonly T[]): Promise<readonly T[]> {
  const refs = rows.map((row) => row.avatarUrl).filter((value): value is string => Boolean(value))
  if (!refs.length) return rows
  try {
    const resolved = await resolveSharedMediaUrls([...new Set(refs)], 'thumbnail')
    return rows.map((row) => {
      if (!row.avatarUrl) return row
      const next = resolved.get(row.avatarUrl)
      if (next) return { ...row, avatarUrl: next }
      if (isSharedMediaReference(row.avatarUrl)) return withoutAvatar(row)
      return row
    })
  } catch {
    return rows.map((row) => {
      if (!row.avatarUrl || !isSharedMediaReference(row.avatarUrl)) return row
      return withoutAvatar(row)
    })
  }
}

function parsePayees(value: unknown): readonly NetBankPayee[] {
  if (!Array.isArray(value) || value.length > 20) return invalidResponse('ALTARA BANK returned an invalid recipient directory.')
  return value.map((value) => {
    const row = asRecord(value)
    if (!row) return invalidResponse('ALTARA BANK returned an invalid recipient row.')
    const avatarUrl = optionalString(row.avatar_ref, 4096, 'recipient avatar reference')
    return {
      displayName: requiredString(row.display_name, 160, 'recipient display name'),
      paymentIdentifier: paymentIdentifier(row.payment_identifier),
      currency: parseCurrency(row.currency),
      ...(avatarUrl ? { avatarUrl } : {}),
    }
  })
}

function parseQuote(value: unknown): NetAltaraBankQuote {
  const row = asRecord(value); const recipient = asRecord(row?.recipient)
  if (!row || !recipient || typeof row.same_currency !== 'boolean') return invalidResponse('ALTARA BANK returned an invalid payment quote.')
  const avatarUrl = optionalString(recipient.avatar_ref, 4096, 'recipient avatar reference')
  const sourceCurrency = parseCurrency(row.source_currency)
  const targetCurrency = parseCurrency(row.target_currency)
  const rateRevision = row.rate_revision == null ? undefined : uuid(row.rate_revision, 'quote rate revision')
  if (
    row.same_currency !== (sourceCurrency.currencyCode === targetCurrency.currencyCode)
    || (row.same_currency ? rateRevision !== undefined : rateRevision === undefined)
  ) return invalidResponse('ALTARA BANK returned an inconsistent FX quote.')
  return {
    serverNow: timestamp(row.server_now, 'quote time'),
    recipient: {
      displayName: requiredString(recipient.display_name, 160, 'recipient display name'),
      paymentIdentifier: paymentIdentifier(recipient.payment_identifier),
      currency: parseCurrency(recipient.currency),
      ...(avatarUrl ? { avatarUrl } : {}),
    },
    sourceCurrency,
    targetCurrency,
    sourceAmount: positiveInteger(row.source_amount, 'quote source amount', NET_ALTARA_BANK_MAX_TRANSFER_AMOUNT),
    targetAmount: positiveInteger(row.target_amount, 'quote target amount', NET_ALTARA_BANK_MAX_TRANSFER_AMOUNT),
    sourceUnits: positiveInteger(row.source_units, 'quote source units', NET_ALTARA_BANK_MAX_TRANSFER_AMOUNT),
    targetUnits: positiveInteger(row.target_units, 'quote target units', NET_ALTARA_BANK_MAX_TRANSFER_AMOUNT),
    ...(rateRevision ? { rateRevision } : {}),
    sameCurrency: row.same_currency,
  }
}

function parseGmDirectory(value: unknown): readonly NetAltaraBankGmDirectoryRow[] {
  if (!Array.isArray(value) || value.length > NET_ALTARA_BANK_DIRECTORY_MAX_LIMIT) return invalidResponse('ALTARA BANK returned an invalid administration directory.')
  return value.map((value) => {
    const row = asRecord(value); if (!row) return invalidResponse('ALTARA BANK returned an invalid administration row.')
    const status = requiredString(row.status, 16, 'account status')
    if (status !== 'active' && status !== 'closed') return invalidResponse('ALTARA BANK returned an invalid account status.')
    return {
      displayName: requiredString(row.display_name, 160, 'display name'),
      paymentIdentifier: paymentIdentifier(row.payment_identifier),
      balanceAmount: nonNegativeInteger(row.balance_amount, 'balance'),
      currency: parseCurrency(row.currency),
      status, openedAt: timestamp(row.opened_at, 'opening time'), updatedAt: timestamp(row.updated_at, 'update time'),
    }
  })
}

function parseFxRate(value: unknown): NetAltaraFxRate {
  const row = asRecord(value); if (!row) return invalidResponse('ALTARA BANK returned an invalid FX rate.')
  if (typeof row.active !== 'boolean') return invalidResponse('ALTARA BANK returned an invalid FX status.')
  return {
    currencyA: currencyCode(row.currency_a), currencyB: currencyCode(row.currency_b),
    unitsA: nonNegativeInteger(row.units_a, 'FX units', NET_ALTARA_BANK_MAX_TRANSFER_AMOUNT),
    unitsB: nonNegativeInteger(row.units_b, 'FX units', NET_ALTARA_BANK_MAX_TRANSFER_AMOUNT),
    revision: uuid(row.revision, 'FX revision'), active: row.active,
    reason: requiredString(row.reason, 200, 'FX reason'), updatedAt: timestamp(row.updated_at, 'FX update time'),
  }
}

function parseConfiguration(value: unknown): NetAltaraEconomyConfiguration {
  const row = asRecord(value)
  if (!row || !Array.isArray(row.currencies) || !Array.isArray(row.fx_rates)) return invalidResponse('ALTARA BANK returned invalid economy configuration.')
  return {
    serverNow: timestamp(row.server_now, 'server time'), currencies: row.currencies.map(parseCurrency),
    fxRates: row.fx_rates.map(parseFxRate),
    ...(row.identity_link_id == null ? {} : { identityLinkId: uuid(row.identity_link_id, 'identity link id') }),
    identityCurrency: row.identity_currency == null ? null : parseCurrency(row.identity_currency),
    ...(optionalString(row.assignment_basis, 80, 'assignment basis') ? { assignmentBasis: String(row.assignment_basis) } : {}),
    ...(row.assignment_updated_at == null ? {} : { assignmentUpdatedAt: timestamp(row.assignment_updated_at, 'assignment update time') }),
  }
}

export async function fetchNetAltaraBank(expectedIdentityLinkId: string, cursor?: NetAltaraBankCursor, limit?: number): Promise<NetAltaraBankPayload> {
  const expected = normalizeExpectedIdentityLinkId(expectedIdentityLinkId)
  const { data, error } = await client().rpc('fetch_net_economy_altara_bank', { requested_expected_identity_link_id: expected, ...normalizeCursor(cursor), requested_limit: normalizeLimit(limit, NET_ALTARA_BANK_HISTORY_DEFAULT_LIMIT, NET_ALTARA_BANK_HISTORY_MAX_LIMIT) })
  if (error) throw mapError('Unable to load ALTARA BANK', error)
  return parsePayload(data, expected)
}

export async function openNetAltaraBank(expectedIdentityLinkId: string): Promise<NetAltaraBankPayload> {
  const expected = normalizeExpectedIdentityLinkId(expectedIdentityLinkId)
  const { data, error } = await client().rpc('open_net_economy_altara_bank', { requested_expected_identity_link_id: expected })
  if (error) throw mapError('Unable to open ALTARA BANK', error)
  return parsePayload(data, expected)
}

export async function searchNetAltaraBankPayees(expectedIdentityLinkId: string, query: string): Promise<readonly NetBankPayee[]> {
  const expected = normalizeExpectedIdentityLinkId(expectedIdentityLinkId); const normalized = query.trim().slice(0, 80)
  if (normalized.length < 2) return []
  const { data, error } = await client().rpc('search_net_economy_altara_bank_payees', { requested_expected_identity_link_id: expected, requested_query: normalized, requested_limit: 12 })
  if (error) throw mapError('ALTARA BANK directory search failed', error)
  return resolveAvatarRows(parsePayees(data))
}

export async function quoteNetAltaraBankPayment(input: { expectedIdentityLinkId: string; paymentIdentifier: string; amount: number }): Promise<NetAltaraBankQuote> {
  const paymentId = normalizePaymentIdentifier(input.paymentIdentifier)
  const amount = normalizeAmount(input.amount)
  const { data, error } = await client().rpc('quote_net_economy_altara_bank_payment', {
    requested_expected_identity_link_id: normalizeExpectedIdentityLinkId(input.expectedIdentityLinkId),
    requested_payment_identifier: paymentId,
    requested_source_amount: amount,
  })
  if (error) throw mapError('ALTARA BANK quote failed', error)
  const quote = parseQuote(data)
  if (quote.recipient.paymentIdentifier !== paymentId || quote.sourceAmount !== amount) {
    throw new NetAltaraBankError('identity-context-changed', 'ALTARA BANK returned a quote for a different payment context.')
  }
  const [resolved] = await resolveAvatarRows([{ ...quote.recipient }])
  return { ...quote, recipient: resolved ?? quote.recipient }
}

export async function payNetAltaraBank(input: { expectedIdentityLinkId: string; paymentIdentifier: string; amount: number; rateRevision?: string; requestKey: string }): Promise<NetAltaraBankPayload> {
  const expected = normalizeExpectedIdentityLinkId(input.expectedIdentityLinkId)
  const { data, error } = await client().rpc('transfer_net_economy_altara_bank_payment', {
    requested_expected_identity_link_id: expected,
    requested_payment_identifier: normalizePaymentIdentifier(input.paymentIdentifier),
    requested_source_amount: normalizeAmount(input.amount),
    requested_rate_revision: input.rateRevision ? normalizeRequestKey(input.rateRevision) : null,
    requested_request_key: normalizeRequestKey(input.requestKey),
  })
  if (error) throw mapError('ALTARA BANK payment failed', error)
  return parsePayload(data, expected)
}

export async function fetchNetAltaraBankGmDirectory(query = '', limit?: number): Promise<readonly NetAltaraBankGmDirectoryRow[]> {
  const { data, error } = await client().rpc('fetch_net_economy_gm_altara_bank_directory', { requested_query: query.trim().slice(0, 80) || null, requested_limit: normalizeLimit(limit, NET_ALTARA_BANK_DIRECTORY_DEFAULT_LIMIT, NET_ALTARA_BANK_DIRECTORY_MAX_LIMIT) })
  if (error) throw mapError('Unable to load ALTARA BANK administration', error)
  return parseGmDirectory(data)
}

export async function fetchNetAltaraBankGmAccount(paymentId: string, cursor?: NetAltaraBankCursor, limit?: number): Promise<NetAltaraBankPayload> {
  const { data, error } = await client().rpc('fetch_net_economy_gm_altara_bank', { requested_payment_identifier: normalizePaymentIdentifier(paymentId), ...normalizeCursor(cursor), requested_limit: normalizeLimit(limit, NET_ALTARA_BANK_HISTORY_DEFAULT_LIMIT, NET_ALTARA_BANK_HISTORY_MAX_LIMIT) })
  if (error) throw mapError('Unable to load the ALTARA BANK customer', error)
  return parsePayload(data)
}

export async function adjustNetAltaraBankGmAccount(input: { paymentIdentifier: string; action: NetAltaraBankGmMutation; amount: number; reason: string; requestKey: string }): Promise<NetAltaraBankPayload> {
  const { data, error } = await client().rpc('adjust_net_economy_gm_altara_bank', { requested_payment_identifier: normalizePaymentIdentifier(input.paymentIdentifier), requested_action: input.action, requested_amount: normalizeAmount(input.amount), requested_reason: normalizeReason(input.reason), requested_request_key: normalizeRequestKey(input.requestKey) })
  if (error) throw mapError('ALTARA BANK adjustment failed', error)
  return parsePayload(data)
}

export async function fetchNetAltaraEconomyConfiguration(identityLinkId?: string): Promise<NetAltaraEconomyConfiguration> {
  const { data, error } = await client().rpc('fetch_net_economy_gm_altara_configuration', { requested_identity_link_id: identityLinkId ? normalizeExpectedIdentityLinkId(identityLinkId) : null })
  if (error) throw mapError('Unable to load currency administration', error)
  return parseConfiguration(data)
}

export async function setNetAltaraIdentityCurrency(input: { identityLinkId: string; currencyCode?: NetAltaraCurrencyCode; reason: string }): Promise<NetAltaraEconomyConfiguration> {
  const { data, error } = await client().rpc('set_net_economy_gm_identity_currency', { requested_identity_link_id: normalizeExpectedIdentityLinkId(input.identityLinkId), requested_currency_code: input.currencyCode ?? null, requested_reason: normalizeReason(input.reason) })
  if (error) throw mapError('Unable to assign the home currency', error)
  return parseConfiguration(data)
}

export async function setNetAltaraFxRate(input: { currencyA: NetAltaraCurrencyCode; currencyB: NetAltaraCurrencyCode; unitsA: number; unitsB: number; active: boolean; reason: string }): Promise<NetAltaraEconomyConfiguration> {
  const { data, error } = await client().rpc('set_net_economy_gm_fx_rate', { requested_currency_a: input.currencyA, requested_currency_b: input.currencyB, requested_units_a: normalizeAmount(input.unitsA), requested_units_b: normalizeAmount(input.unitsB), requested_active: input.active, requested_reason: normalizeReason(input.reason) })
  if (error) throw mapError('Unable to update the exchange rate', error)
  return parseConfiguration(data)
}
