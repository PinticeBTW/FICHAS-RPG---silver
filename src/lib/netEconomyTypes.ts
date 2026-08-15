export const NET_ECONOMY_PRIMARY_CURRENCY = 'VG' as const
export const NET_ECONOMY_CURRENCIES = ['VG', 'KARMA'] as const
export const NET_ECONOMY_HISTORY_DEFAULT_LIMIT = 20
export const NET_ECONOMY_HISTORY_MAX_LIMIT = 40
export const NET_ECONOMY_PAYEE_QUERY_MIN_LENGTH = 2
export const NET_ECONOMY_PAYEE_QUERY_MAX_LENGTH = 60
export const NET_ECONOMY_NOTE_MAX_LENGTH = 120
export const NET_ECONOMY_REASON_MAX_LENGTH = 200
export const NET_ECONOMY_MAX_TRANSACTION_AMOUNT = 1_000_000_000

export const netEconomyTransactionKinds = [
  'opening-balance',
  'transfer',
  'gm-credit',
  'gm-debit',
  'bank-deposit',
  'bank-withdrawal',
  'bank-yield',
  'bank-adoption-correction',
  'sheet-vg-adjustment',
  'sheet-karma-adjustment',
] as const

export type NetEconomyCurrency = typeof NET_ECONOMY_CURRENCIES[number]
export type NetEconomyTransactionKind = typeof netEconomyTransactionKinds[number]
export type NetEconomyDirection = 'incoming' | 'outgoing'
export type NetEconomyAccountStatus = 'active' | 'closed'
export type NetEconomyGmAdjustmentAction = 'credit' | 'debit'

export interface NetEconomyCursor {
  readonly at: string
  readonly id: string
}

export interface NetEconomyWalletIdentity {
  readonly paymentIdentifier: string
  readonly displayName: string
}

export interface NetEconomyBalance {
  readonly accountId: string
  readonly balanceAmount: number
  readonly currencyCode: NetEconomyCurrency
  readonly status: NetEconomyAccountStatus
  readonly updatedAt: string
}

export interface NetEconomyActivity {
  readonly transactionId: string
  readonly amount: number
  readonly currencyCode: NetEconomyCurrency
  readonly direction: NetEconomyDirection
  readonly transactionKind: NetEconomyTransactionKind
  readonly counterpartyDisplayName?: string
  readonly counterpartyPaymentIdentifier?: string
  readonly counterpartyInstitutionCode?: string
  readonly counterpartyInstitutionName?: string
  readonly note?: string
  readonly createdAt: string
}

export interface NetEconomyActivityPage {
  readonly items: readonly NetEconomyActivity[]
  readonly hasMore: boolean
  readonly nextCursor?: NetEconomyCursor
}

export interface NetEconomyWalletPayload {
  readonly identity: NetEconomyWalletIdentity
  readonly balances: readonly NetEconomyBalance[]
  readonly activity: NetEconomyActivityPage
}

export interface NetEconomyPayee {
  readonly paymentIdentifier: string
  readonly displayName: string
  readonly karmaAvailable: boolean
}

export interface NetEconomyGmWalletDirectoryRow extends NetEconomyWalletIdentity {
  readonly vgBalanceAmount: number
  readonly karmaBalanceAmount: number | null
  readonly updatedAt: string
}

export type NetEconomyErrorCode =
  | 'authentication-required'
  | 'active-identity-required'
  | 'gm-required'
  | 'invalid-cursor'
  | 'invalid-query'
  | 'invalid-request'
  | 'payee-not-found'
  | 'self-transfer'
  | 'insufficient-funds'
  | 'idempotency-conflict'
  | 'wallet-not-found'
  | 'wallet-inactive'
  | 'currency-invalid'
  | 'karma-not-available'
  | 'karma-range-invalid'
  | 'invalid-server-response'
  | 'request-failed'

export class NetEconomyError extends Error {
  readonly code: NetEconomyErrorCode

  constructor(code: NetEconomyErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'NetEconomyError'
    this.code = code
  }
}

export function isNetEconomyError(error: unknown): error is NetEconomyError {
  return error instanceof NetEconomyError
}

export function formatNetEconomyAmount(amount: number, currency: NetEconomyCurrency): string {
  const formatted = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(amount)
  return currency === 'VG' ? `${formatted} vG` : `${formatted} Karma`
}

export function formatNetEconomyBalance(amount: number, currency: NetEconomyCurrency): string {
  const sign = currency === 'KARMA' && amount > 0 ? '+' : ''
  return `${sign}${formatNetEconomyAmount(amount, currency)}`
}

export function netEconomyCurrencyLabel(currency: NetEconomyCurrency): string {
  return currency === 'VG' ? 'vG' : 'Karma'
}
