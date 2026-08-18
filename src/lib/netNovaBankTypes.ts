export const NET_NOVA_BANK_HISTORY_DEFAULT_LIMIT = 20
export const NET_NOVA_BANK_HISTORY_MAX_LIMIT = 40
export const NET_NOVA_BANK_MAX_TRANSFER_AMOUNT = 1_000_000_000
export const NET_NOVA_BANK_NOTE_MAX_LENGTH = 200

export type NetNovaCurrencyCode = 'FINIT' | 'SECTUS'
export type NetNovaBankMutation = 'open' | 'payment'
export type NetNovaBankActivityKind = 'bank-transfer' | 'bank-fx-debit' | 'bank-fx-credit' | 'gm-credit' | 'gm-debit'

export interface NetNovaCurrency {
  readonly currencyCode: NetNovaCurrencyCode
  readonly displayName: string
  readonly singularLabel: string
  readonly pluralLabel: string
  readonly decimals: 0
  readonly status: 'active' | 'inactive'
}

export interface NetNovaBankCursor {
  readonly at: string
  readonly id: string
}

export interface NetNovaBankAccount {
  /** Private key used only to filter the authorized shared Economy revision stream. */
  readonly accountId: string
  readonly paymentIdentifier: string
  readonly currencyCode: NetNovaCurrencyCode
  readonly currency: NetNovaCurrency
  readonly balanceAmount: number
  readonly status: 'active' | 'closed'
  readonly openedAt: string
  readonly updatedAt: string
}

export interface NetNovaBankActivity {
  readonly transactionId: string
  readonly amount: number
  readonly currencyCode: NetNovaCurrencyCode
  readonly transactionKind: NetNovaBankActivityKind
  readonly counterpartyDisplayName?: string
  readonly counterpartyPaymentIdentifier?: string
  readonly note?: string
  readonly createdAt: string
  readonly fx?: {
    readonly operationId: string
    readonly sourceCurrencyCode: NetNovaCurrencyCode
    readonly targetCurrencyCode: NetNovaCurrencyCode
    readonly sourceAmount: number
    readonly targetAmount: number
    readonly sourceUnits: number
    readonly targetUnits: number
    readonly rateRevision: string
  }
}

export interface NetNovaBankActivityPage {
  readonly items: readonly NetNovaBankActivity[]
  readonly hasMore: boolean
  readonly nextCursor?: NetNovaBankCursor
}

export interface NetNovaBankPayload {
  readonly serverNow: string
  readonly clientReceivedAtMs: number
  readonly identity: {
    readonly identityLinkId: string
    readonly displayName: string
  }
  readonly institution: {
    readonly institutionCode: 'NOVA'
    readonly displayName: 'NOVA BANK'
    readonly ownerName: 'NOVA FINANCIAL'
  }
  readonly currencyRequired: boolean
  readonly homeCurrency: NetNovaCurrency | null
  readonly bank: NetNovaBankAccount | null
  readonly activity: NetNovaBankActivityPage
}

export interface NetNovaBankQuote {
  readonly serverNow: string
  readonly recipient: {
    readonly displayName: string
    readonly paymentIdentifier: string
    readonly currency: NetNovaCurrency
    readonly avatarUrl?: string
  }
  readonly sourceCurrency: NetNovaCurrency
  readonly targetCurrency: NetNovaCurrency
  readonly sourceAmount: number
  readonly targetAmount: number
  readonly sourceUnits: number
  readonly targetUnits: number
  readonly rateRevision?: string
  readonly sameCurrency: boolean
}

export type NetNovaBankErrorCode =
  | 'authentication-required'
  | 'service-access-denied'
  | 'identity-context-changed'
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

export class NetNovaBankError extends Error {
  readonly code: NetNovaBankErrorCode

  constructor(code: NetNovaBankErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'NetNovaBankError'
    this.code = code
  }
}

export function isNetNovaBankError(error: unknown): error is NetNovaBankError {
  return error instanceof NetNovaBankError
}

export function formatNetNovaBankAmount(amount: number, currency: NetNovaCurrency): string {
  const value = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(amount)
  return `${value} ${amount === 1 ? currency.singularLabel : currency.pluralLabel}`
}
