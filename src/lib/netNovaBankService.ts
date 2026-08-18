import type { NetBankPayee } from './netBankPaymentTypes'
import { isSharedMediaReference } from './media/mediaReference'
import { resolveSharedMediaUrls } from './media/mediaStorage'
import {
  NET_NOVA_BANK_HISTORY_DEFAULT_LIMIT,
  NET_NOVA_BANK_HISTORY_MAX_LIMIT,
  NET_NOVA_BANK_MAX_TRANSFER_AMOUNT,
  NET_NOVA_BANK_NOTE_MAX_LENGTH,
  NetNovaBankError,
  type NetNovaBankActivity,
  type NetNovaBankActivityKind,
  type NetNovaBankActivityPage,
  type NetNovaBankCursor,
  type NetNovaBankPayload,
  type NetNovaBankQuote,
  type NetNovaCurrency,
  type NetNovaCurrencyCode,
} from './netNovaBankTypes'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'

interface RpcErrorLike { readonly code?: string; readonly message: string }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PAYMENT_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/
const CURRENCY_CODES = ['FINIT', 'SECTUS'] as const
const ACTIVITY_KINDS = ['bank-transfer', 'bank-fx-debit', 'bank-fx-credit', 'gm-credit', 'gm-debit'] as const
const SAFE_BALANCE_MAX = 9_000_000_000_000_000

function client() {
  if (!supabase) throw new NetNovaBankError('request-failed', SUPABASE_CONFIG_ERROR)
  return supabase
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function invalidResponse(message: string): never {
  throw new NetNovaBankError('invalid-server-response', message)
}

function requiredString(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    return invalidResponse(`NOVA BANK returned an invalid ${label}.`)
  }
  return value
}

function optionalString(value: unknown, maximum: number, label: string): string | undefined {
  if (value === null || value === undefined) return undefined
  return requiredString(value, maximum, label)
}

function uuid(value: unknown, label: string): string {
  const parsed = requiredString(value, 64, label)
  if (!UUID_PATTERN.test(parsed)) return invalidResponse(`NOVA BANK returned an invalid ${label}.`)
  return parsed
}

function timestamp(value: unknown, label: string): string {
  const parsed = requiredString(value, 64, label)
  if (Number.isNaN(Date.parse(parsed))) return invalidResponse(`NOVA BANK returned an invalid ${label}.`)
  return parsed
}

function integer(value: unknown, label: string, maximum = SAFE_BALANCE_MAX): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || Math.abs(parsed) > maximum) {
    return invalidResponse(`NOVA BANK returned an invalid ${label}.`)
  }
  return parsed
}

function nonNegativeInteger(value: unknown, label: string, maximum = SAFE_BALANCE_MAX): number {
  const parsed = integer(value, label, maximum)
  if (parsed < 0) return invalidResponse(`NOVA BANK returned an invalid ${label}.`)
  return parsed
}

function positiveInteger(value: unknown, label: string, maximum = SAFE_BALANCE_MAX): number {
  const parsed = integer(value, label, maximum)
  if (parsed < 1) return invalidResponse(`NOVA BANK returned an invalid ${label}.`)
  return parsed
}

function currencyCode(value: unknown): NetNovaCurrencyCode {
  if (!CURRENCY_CODES.includes(value as NetNovaCurrencyCode)) {
    return invalidResponse('NOVA BANK returned an unsupported currency.')
  }
  return value as NetNovaCurrencyCode
}

function parseCurrency(value: unknown): NetNovaCurrency {
  const row = asRecord(value)
  if (!row || row.decimals !== 0) return invalidResponse('NOVA BANK returned invalid currency metadata.')
  const status = requiredString(row.status, 16, 'currency status')
  if (status !== 'active' && status !== 'inactive') return invalidResponse('NOVA BANK returned invalid currency status.')
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
  if (!PAYMENT_IDENTIFIER_PATTERN.test(parsed)) return invalidResponse('NOVA BANK returned an invalid payment identifier.')
  return parsed
}

function normalizeExpectedIdentityLinkId(value: string): string {
  const normalized = value.trim()
  if (!UUID_PATTERN.test(normalized)) throw new NetNovaBankError('invalid-request', 'A valid authoritative ALTARA identity is required.')
  return normalized
}

function normalizePaymentIdentifier(value: string): string {
  const normalized = value.trim().replace(/^@/, '').toLowerCase()
  if (!PAYMENT_IDENTIFIER_PATTERN.test(normalized)) throw new NetNovaBankError('invalid-request', 'Choose a valid NOVA BANK customer.')
  return normalized
}

function normalizeRequestKey(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new NetNovaBankError('invalid-request', 'A valid NOVA BANK request key is required.')
  return value
}

function normalizeAmount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > NET_NOVA_BANK_MAX_TRANSFER_AMOUNT) {
    throw new NetNovaBankError('invalid-request', `Amount must be a whole value from 1 to ${NET_NOVA_BANK_MAX_TRANSFER_AMOUNT}.`)
  }
  return value
}

function normalizeNote(value: string | undefined): string | null {
  const note = value?.trim() ?? ''
  if (note.length > NET_NOVA_BANK_NOTE_MAX_LENGTH) {
    throw new NetNovaBankError('invalid-request', `Payment note must be ${NET_NOVA_BANK_NOTE_MAX_LENGTH} characters or fewer.`)
  }
  return note || null
}

function normalizeCursor(cursor: NetNovaBankCursor | undefined) {
  if (!cursor) return { requested_cursor_at: null, requested_cursor_id: null }
  if (Number.isNaN(Date.parse(cursor.at)) || !UUID_PATTERN.test(cursor.id)) {
    throw new NetNovaBankError('invalid-request', 'The NOVA BANK activity cursor is invalid.')
  }
  return { requested_cursor_at: cursor.at, requested_cursor_id: cursor.id }
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return NET_NOVA_BANK_HISTORY_DEFAULT_LIMIT
  return Math.min(Math.max(Math.trunc(value ?? NET_NOVA_BANK_HISTORY_DEFAULT_LIMIT), 1), NET_NOVA_BANK_HISTORY_MAX_LIMIT)
}

function mapError(prefix: string, error: RpcErrorLike): NetNovaBankError {
  const message = error.message ?? ''
  if (message.includes('NOVA_BANK_IDENTITY_CONTEXT_CHANGED') || message.includes('NET_RUNTIME_IDENTITY_CONTEXT_CHANGED')) return new NetNovaBankError('identity-context-changed', 'The controlled ALTARA identity changed. Reopen NOVA BANK and try again.')
  if (message.includes('NET_OS_SERVICE_ACCESS_DENIED') || message.includes('NOVA_BANK_OS_CONTEXT_CHANGED')) return new NetNovaBankError('service-access-denied', 'This identity cannot access NOVA BANK.')
  if (message.includes('NOVA_BANK_APP_NOT_INSTALLED') || message.includes('NET_RUNTIME_APP_NOT_INSTALLED')) return new NetNovaBankError('app-not-installed', 'Install NOVA BANK from ALTARA STORE before using this service.')
  if (message.includes('NOVA_BANK_CURRENCY_REQUIRED')) return new NetNovaBankError('currency-required', 'Silver must assign this identity a FINIT or SECTUS home currency before the account can open.')
  if (message.includes('NOVA_BANK_CURRENCY_CHANGE_REVIEW_REQUIRED')) return new NetNovaBankError('currency-change-review', 'This NOVA account no longer matches the assigned home currency. Silver must review the account before banking can continue.')
  if (message.includes('NOVA_BANK_ACCOUNT_INACTIVE')) return new NetNovaBankError('account-inactive', 'This NOVA BANK account is no longer active.')
  if (message.includes('NOVA_BANK_FX_RATE_UNAVAILABLE')) return new NetNovaBankError('fx-rate-unavailable', 'No active exchange rate is available for this payment.')
  if (message.includes('NOVA_BANK_FX_RATE_CHANGED')) return new NetNovaBankError('fx-rate-changed', 'The exchange rate changed. Review the payment again.')
  if (message.includes('NOVA_BANK_ACCOUNT_NOT_FOUND')) return new NetNovaBankError('account-not-found', 'Open a NOVA BANK account before using this service.')
  if (message.includes('NOVA_BANK_INSTITUTION_UNAVAILABLE')) return new NetNovaBankError('account-inactive', 'NOVA BANK is temporarily unavailable.')
  if (message.includes('NOVA_BANK_PAYEE_NOT_FOUND')) return new NetNovaBankError('payee-not-found', 'That recipient does not have an active NOVA BANK account.')
  if (message.includes('ECONOMY_SELF_TRANSFER_INVALID')) return new NetNovaBankError('self-transfer', 'Choose another NOVA BANK customer.')
  if (message.includes('ECONOMY_BANK_INSUFFICIENT_FUNDS')) return new NetNovaBankError('insufficient-funds', 'Your NOVA BANK balance is too low for this payment.')
  if (message.includes('ECONOMY_IDEMPOTENCY_CONFLICT')) return new NetNovaBankError('idempotency-conflict', 'This payment request was already used with different details.')
  if (error.code === '42501' || message.includes('NOVA_BANK_AUTH_REQUIRED')) return new NetNovaBankError('authentication-required', 'Authenticated ALTARA access is required.')
  if (message.includes('NOVA_BANK_') || message.includes('ECONOMY_')) return new NetNovaBankError('invalid-request', 'NOVA BANK rejected this request.')
  return new NetNovaBankError('request-failed', `${prefix}: ${message}`)
}

function parseActivity(value: unknown): NetNovaBankActivity {
  const row = asRecord(value)
  if (!row) return invalidResponse('NOVA BANK returned an invalid activity row.')
  const transactionKind = requiredString(row.transaction_kind, 40, 'activity kind')
  if (!ACTIVITY_KINDS.includes(transactionKind as NetNovaBankActivityKind)) return invalidResponse('NOVA BANK returned an unsupported activity kind.')
  const amount = integer(row.amount, 'activity amount')
  if (amount === 0) return invalidResponse('NOVA BANK returned a zero-value activity row.')
  const fxOperationId = row.fx_operation_id == null ? undefined : uuid(row.fx_operation_id, 'FX operation id')
  return {
    transactionId: uuid(row.transaction_id, 'transaction id'),
    amount,
    currencyCode: currencyCode(row.currency_code),
    transactionKind: transactionKind as NetNovaBankActivityKind,
    ...(optionalString(row.counterparty_display_name, 160, 'counterparty name') ? { counterpartyDisplayName: String(row.counterparty_display_name) } : {}),
    ...(row.counterparty_payment_identifier == null ? {} : { counterpartyPaymentIdentifier: paymentIdentifier(row.counterparty_payment_identifier) }),
    ...(optionalString(row.note, NET_NOVA_BANK_NOTE_MAX_LENGTH, 'payment note') ? { note: String(row.note) } : {}),
    createdAt: timestamp(row.created_at, 'activity time'),
    ...(fxOperationId ? {
      fx: {
        operationId: fxOperationId,
        sourceCurrencyCode: currencyCode(row.fx_source_currency_code),
        targetCurrencyCode: currencyCode(row.fx_target_currency_code),
        sourceAmount: positiveInteger(row.fx_source_amount, 'FX source amount', NET_NOVA_BANK_MAX_TRANSFER_AMOUNT),
        targetAmount: positiveInteger(row.fx_target_amount, 'FX target amount', NET_NOVA_BANK_MAX_TRANSFER_AMOUNT),
        sourceUnits: positiveInteger(row.fx_source_units, 'FX source units', NET_NOVA_BANK_MAX_TRANSFER_AMOUNT),
        targetUnits: positiveInteger(row.fx_target_units, 'FX target units', NET_NOVA_BANK_MAX_TRANSFER_AMOUNT),
        rateRevision: uuid(row.fx_rate_revision, 'FX rate revision'),
      },
    } : {}),
  }
}

function parseActivityPage(value: unknown): NetNovaBankActivityPage {
  const row = asRecord(value)
  if (!row || !Array.isArray(row.items) || typeof row.has_more !== 'boolean') return invalidResponse('NOVA BANK returned an invalid activity page.')
  const cursorAt = row.next_cursor_at == null ? undefined : timestamp(row.next_cursor_at, 'activity cursor time')
  const cursorId = row.next_cursor_id == null ? undefined : uuid(row.next_cursor_id, 'activity cursor id')
  if (Boolean(cursorAt) !== Boolean(cursorId) || (row.has_more && (!cursorAt || !cursorId))) return invalidResponse('NOVA BANK returned an invalid activity cursor.')
  return {
    items: row.items.map(parseActivity),
    hasMore: row.has_more,
    ...(cursorAt && cursorId ? { nextCursor: { at: cursorAt, id: cursorId } } : {}),
  }
}

function parsePayload(value: unknown, expectedIdentityLinkId: string): NetNovaBankPayload {
  const row = asRecord(value)
  const identity = asRecord(row?.identity)
  const institution = asRecord(row?.institution)
  if (!row || !identity || !institution) return invalidResponse('NOVA BANK returned an invalid account response.')
  if (institution.institution_code !== 'NOVA' || institution.display_name !== 'NOVA BANK' || institution.owner_name !== 'NOVA FINANCIAL') return invalidResponse('NOVA BANK returned an invalid institution response.')
  const identityLinkId = uuid(identity.identity_link_id, 'identity link id')
  if (identityLinkId !== expectedIdentityLinkId) throw new NetNovaBankError('identity-context-changed', 'NOVA BANK returned a different identity context.')
  if (typeof row.currency_required !== 'boolean') return invalidResponse('NOVA BANK returned invalid currency state.')
  const homeCurrency = row.home_currency == null ? null : parseCurrency(row.home_currency)
  const bankRow = row.bank == null ? null : asRecord(row.bank)
  if (row.currency_required !== (homeCurrency === null) || (row.bank != null && !bankRow)) return invalidResponse('NOVA BANK returned inconsistent account state.')
  const bank = bankRow ? {
    accountId: uuid(bankRow.account_id, 'account id'),
    paymentIdentifier: paymentIdentifier(bankRow.payment_identifier),
    currencyCode: currencyCode(bankRow.currency_code),
    currency: parseCurrency(bankRow.currency),
    balanceAmount: nonNegativeInteger(bankRow.balance_amount, 'account balance'),
    status: requiredString(bankRow.status, 16, 'account status') as 'active' | 'closed',
    openedAt: timestamp(bankRow.opened_at, 'account opening time'),
    updatedAt: timestamp(bankRow.updated_at, 'account update time'),
  } : null
  if (bank && (bank.status !== 'active' && bank.status !== 'closed')) return invalidResponse('NOVA BANK returned an invalid account status.')
  if (bank && (!homeCurrency || bank.currencyCode !== homeCurrency.currencyCode || bank.currency.currencyCode !== bank.currencyCode)) return invalidResponse('NOVA BANK returned an account outside the assigned home currency.')
  return {
    serverNow: timestamp(row.server_now, 'server time'),
    clientReceivedAtMs: Date.now(),
    identity: { identityLinkId, displayName: requiredString(identity.display_name, 160, 'account holder') },
    institution: { institutionCode: 'NOVA', displayName: 'NOVA BANK', ownerName: 'NOVA FINANCIAL' },
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
      return isSharedMediaReference(row.avatarUrl) ? withoutAvatar(row) : row
    })
  } catch {
    return rows.map((row) => row.avatarUrl && isSharedMediaReference(row.avatarUrl) ? withoutAvatar(row) : row)
  }
}

function parsePayees(value: unknown): readonly NetBankPayee[] {
  if (!Array.isArray(value) || value.length > 20) return invalidResponse('NOVA BANK returned an invalid recipient directory.')
  return value.map((value) => {
    const row = asRecord(value)
    if (!row) return invalidResponse('NOVA BANK returned an invalid recipient row.')
    const avatarUrl = optionalString(row.avatar_ref, 4096, 'recipient avatar reference')
    return {
      displayName: requiredString(row.display_name, 160, 'recipient name'),
      paymentIdentifier: paymentIdentifier(row.payment_identifier),
      currency: parseCurrency(row.currency),
      ...(avatarUrl ? { avatarUrl } : {}),
    }
  })
}

function parseQuote(value: unknown): NetNovaBankQuote {
  const row = asRecord(value)
  const recipient = asRecord(row?.recipient)
  if (!row || !recipient || typeof row.same_currency !== 'boolean') return invalidResponse('NOVA BANK returned an invalid payment quote.')
  const sourceCurrency = parseCurrency(row.source_currency)
  const targetCurrency = parseCurrency(row.target_currency)
  const rateRevision = row.rate_revision == null ? undefined : uuid(row.rate_revision, 'rate revision')
  if (row.same_currency !== (sourceCurrency.currencyCode === targetCurrency.currencyCode) || (row.same_currency ? rateRevision !== undefined : rateRevision === undefined)) return invalidResponse('NOVA BANK returned an inconsistent payment quote.')
  const avatarUrl = optionalString(recipient.avatar_ref, 4096, 'recipient avatar reference')
  return {
    serverNow: timestamp(row.server_now, 'quote time'),
    recipient: {
      displayName: requiredString(recipient.display_name, 160, 'recipient name'),
      paymentIdentifier: paymentIdentifier(recipient.payment_identifier),
      currency: parseCurrency(recipient.currency),
      ...(avatarUrl ? { avatarUrl } : {}),
    },
    sourceCurrency,
    targetCurrency,
    sourceAmount: positiveInteger(row.source_amount, 'source amount', NET_NOVA_BANK_MAX_TRANSFER_AMOUNT),
    targetAmount: positiveInteger(row.target_amount, 'target amount', NET_NOVA_BANK_MAX_TRANSFER_AMOUNT),
    sourceUnits: positiveInteger(row.source_units, 'source units', NET_NOVA_BANK_MAX_TRANSFER_AMOUNT),
    targetUnits: positiveInteger(row.target_units, 'target units', NET_NOVA_BANK_MAX_TRANSFER_AMOUNT),
    ...(rateRevision ? { rateRevision } : {}),
    sameCurrency: row.same_currency,
  }
}

export async function fetchNetNovaBank(expectedIdentityLinkId: string, cursor?: NetNovaBankCursor, limit?: number): Promise<NetNovaBankPayload> {
  const expected = normalizeExpectedIdentityLinkId(expectedIdentityLinkId)
  const { data, error } = await client().rpc('fetch_net_economy_nova_bank', {
    requested_expected_identity_link_id: expected,
    ...normalizeCursor(cursor),
    requested_limit: normalizeLimit(limit),
  })
  if (error) throw mapError('Unable to load NOVA BANK', error)
  return parsePayload(data, expected)
}

export async function openNetNovaBank(expectedIdentityLinkId: string): Promise<NetNovaBankPayload> {
  const expected = normalizeExpectedIdentityLinkId(expectedIdentityLinkId)
  const { data, error } = await client().rpc('open_net_economy_nova_bank', {
    requested_expected_identity_link_id: expected,
  })
  if (error) throw mapError('Unable to open NOVA BANK', error)
  return parsePayload(data, expected)
}

export async function searchNetNovaBankPayees(expectedIdentityLinkId: string, query: string): Promise<readonly NetBankPayee[]> {
  const expected = normalizeExpectedIdentityLinkId(expectedIdentityLinkId)
  const normalized = query.trim().slice(0, 80)
  if (normalized.length < 2) return []
  const { data, error } = await client().rpc('search_net_economy_nova_bank_payees', {
    requested_expected_identity_link_id: expected,
    requested_query: normalized,
    requested_limit: 12,
  })
  if (error) throw mapError('NOVA BANK directory search failed', error)
  return resolveAvatarRows(parsePayees(data))
}

export async function quoteNetNovaBankPayment(input: { expectedIdentityLinkId: string; paymentIdentifier: string; amount: number }): Promise<NetNovaBankQuote> {
  const expected = normalizeExpectedIdentityLinkId(input.expectedIdentityLinkId)
  const paymentId = normalizePaymentIdentifier(input.paymentIdentifier)
  const amount = normalizeAmount(input.amount)
  const { data, error } = await client().rpc('quote_net_economy_nova_bank_payment', {
    requested_expected_identity_link_id: expected,
    requested_payment_identifier: paymentId,
    requested_source_amount: amount,
  })
  if (error) throw mapError('NOVA BANK payment review failed', error)
  const quote = parseQuote(data)
  if (quote.recipient.paymentIdentifier !== paymentId || quote.sourceAmount !== amount) throw new NetNovaBankError('identity-context-changed', 'NOVA BANK returned a different payment context.')
  const [resolved] = await resolveAvatarRows([{ ...quote.recipient }])
  return { ...quote, recipient: resolved ?? quote.recipient }
}

export async function payNetNovaBank(input: { expectedIdentityLinkId: string; paymentIdentifier: string; amount: number; rateRevision?: string; note?: string; requestKey: string }): Promise<NetNovaBankPayload> {
  const expected = normalizeExpectedIdentityLinkId(input.expectedIdentityLinkId)
  const { data, error } = await client().rpc('transfer_net_economy_nova_bank_payment', {
    requested_expected_identity_link_id: expected,
    requested_payment_identifier: normalizePaymentIdentifier(input.paymentIdentifier),
    requested_source_amount: normalizeAmount(input.amount),
    requested_rate_revision: input.rateRevision ? normalizeRequestKey(input.rateRevision) : null,
    requested_note: normalizeNote(input.note),
    requested_request_key: normalizeRequestKey(input.requestKey),
  })
  if (error) throw mapError('NOVA BANK payment failed', error)
  return parsePayload(data, expected)
}
