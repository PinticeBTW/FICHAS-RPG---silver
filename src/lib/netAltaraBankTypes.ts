export const NET_ALTARA_BANK_HISTORY_DEFAULT_LIMIT = 20
export const NET_ALTARA_BANK_HISTORY_MAX_LIMIT = 40
export const NET_ALTARA_BANK_DIRECTORY_DEFAULT_LIMIT = 20
export const NET_ALTARA_BANK_DIRECTORY_MAX_LIMIT = 40
export const NET_ALTARA_BANK_MAX_TRANSFER_AMOUNT = 1_000_000_000
export const NET_ALTARA_BANK_REASON_MAX_LENGTH = 200

export type NetAltaraCurrencyCode = 'VG' | 'FINIT' | 'SECTUS'
export type NetAltaraBankMutation = 'open' | 'payment'
export type NetAltaraBankGmMutation = 'credit' | 'debit'
export type NetAltaraBankActivityKind =
  | 'bank-transfer'
  | 'bank-fx-debit'
  | 'bank-fx-credit'
  | 'gm-credit'
  | 'gm-debit'

export interface NetAltaraCurrency {
  readonly currencyCode: NetAltaraCurrencyCode
  readonly displayName: string
  readonly singularLabel: string
  readonly pluralLabel: string
  readonly decimals: 0
  readonly status: 'active' | 'inactive'
}

export interface NetAltaraBankCursor {
  readonly at: string
  readonly id: string
}

export interface NetAltaraBankIdentity {
  readonly identityLinkId: string
  readonly displayName: string
}

export interface NetAltaraBankInstitution {
  readonly institutionCode: 'ALTARA'
  readonly displayName: 'ALTARA BANK'
  readonly ownerName: 'ALTARA'
}

export interface NetAltaraBankAccount {
  /** Private key used only to filter the authorized Economy revision stream. */
  readonly accountId: string
  readonly paymentIdentifier: string
  readonly currencyCode: NetAltaraCurrencyCode
  readonly currency: NetAltaraCurrency
  readonly balanceAmount: number
  readonly status: 'active' | 'closed'
  readonly openedAt: string
  readonly updatedAt: string
}

export interface NetAltaraBankActivity {
  readonly transactionId: string
  readonly amount: number
  readonly currencyCode: NetAltaraCurrencyCode
  readonly transactionKind: NetAltaraBankActivityKind
  readonly counterpartyDisplayName?: string
  readonly counterpartyPaymentIdentifier?: string
  readonly note?: string
  readonly createdAt: string
  readonly fx?: {
    readonly operationId: string
    readonly sourceCurrencyCode: NetAltaraCurrencyCode
    readonly targetCurrencyCode: NetAltaraCurrencyCode
    readonly sourceAmount: number
    readonly targetAmount: number
    readonly sourceUnits: number
    readonly targetUnits: number
    readonly rateRevision: string
  }
}

export interface NetAltaraBankActivityPage {
  readonly items: readonly NetAltaraBankActivity[]
  readonly hasMore: boolean
  readonly nextCursor?: NetAltaraBankCursor
}

export interface NetAltaraBankPayload {
  readonly serverNow: string
  readonly clientReceivedAtMs: number
  readonly identity: NetAltaraBankIdentity
  readonly institution: NetAltaraBankInstitution
  readonly currencyRequired: boolean
  readonly homeCurrency: NetAltaraCurrency | null
  readonly bank: NetAltaraBankAccount | null
  readonly activity: NetAltaraBankActivityPage
}

export interface NetAltaraBankQuote {
  readonly serverNow: string
  readonly recipient: {
    readonly displayName: string
    readonly paymentIdentifier: string
    readonly currency: NetAltaraCurrency
    readonly avatarUrl?: string
  }
  readonly sourceCurrency: NetAltaraCurrency
  readonly targetCurrency: NetAltaraCurrency
  readonly sourceAmount: number
  readonly targetAmount: number
  readonly sourceUnits: number
  readonly targetUnits: number
  readonly rateRevision?: string
  readonly sameCurrency: boolean
}

export interface NetAltaraBankGmDirectoryRow {
  readonly displayName: string
  readonly paymentIdentifier: string
  readonly balanceAmount: number
  readonly currency: NetAltaraCurrency
  readonly status: 'active' | 'closed'
  readonly openedAt: string
  readonly updatedAt: string
}

export interface NetAltaraFxRate {
  readonly currencyA: NetAltaraCurrencyCode
  readonly currencyB: NetAltaraCurrencyCode
  readonly unitsA: number
  readonly unitsB: number
  readonly revision: string
  readonly active: boolean
  readonly reason: string
  readonly updatedAt: string
}

export interface NetAltaraEconomyConfiguration {
  readonly serverNow: string
  readonly currencies: readonly NetAltaraCurrency[]
  readonly fxRates: readonly NetAltaraFxRate[]
  readonly identityLinkId?: string
  readonly identityCurrency: NetAltaraCurrency | null
  readonly assignmentBasis?: string
  readonly assignmentUpdatedAt?: string
}

export type NetAltaraBankErrorCode =
  | 'authentication-required'
  | 'service-access-denied'
  | 'active-identity-required'
  | 'identity-context-changed'
  | 'gm-required'
  | 'account-not-found'
  | 'account-inactive'
  | 'app-not-installed'
  | 'currency-required'
  | 'currency-change-review'
  | 'fx-rate-unavailable'
  | 'fx-rate-changed'
  | 'payee-not-found'
  | 'self-transfer'
  | 'insufficient-funds'
  | 'idempotency-conflict'
  | 'invalid-request'
  | 'invalid-server-response'
  | 'request-failed'

export class NetAltaraBankError extends Error {
  readonly code: NetAltaraBankErrorCode

  constructor(code: NetAltaraBankErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'NetAltaraBankError'
    this.code = code
  }
}

export function isNetAltaraBankError(error: unknown): error is NetAltaraBankError {
  return error instanceof NetAltaraBankError
}

export function formatNetAltaraBankAmount(amount: number, currency: NetAltaraCurrency): string {
  const value = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(amount)
  return `${value} ${amount === 1 ? currency.singularLabel : currency.pluralLabel}`
}
