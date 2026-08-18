export const NET_VOX_BANK_HISTORY_DEFAULT_LIMIT = 20
export const NET_VOX_BANK_HISTORY_MAX_LIMIT = 40
export const NET_VOX_BANK_MAX_TRANSFER_AMOUNT = 1_000_000_000

export type NetVoxBankDirection = 'deposit' | 'withdraw'
export type NetVoxBankMutation = 'open' | NetVoxBankDirection | 'yield' | 'payment'
export type NetVoxBankActivityKind = 'bank-deposit' | 'bank-withdrawal' | 'bank-yield' | 'bank-transfer' | 'gm-credit' | 'gm-debit'

export interface NetVoxBankCursor {
  readonly at: string
  readonly id: string
}

export interface NetVoxBankIdentity {
  readonly displayName: string
}

export interface NetVoxBankWalletSummary {
  readonly accountId: string
  readonly balanceAmount: number
  readonly updatedAt: string
}

export interface NetVoxBankAccount {
  readonly accountId: string
  readonly paymentIdentifier: string
  readonly balanceAmount: number
  readonly status: 'active' | 'closed'
  readonly openedAt: string
  readonly updatedAt: string
}

export interface NetVoxBankYield {
  readonly rateBasisPoints: number
  readonly periodSeconds: number
  readonly anchorAt: string
  readonly eligibleAt: string
  readonly projectedAmount: number
  readonly ready: boolean
}

export interface NetVoxBankActivity {
  readonly transactionId: string
  readonly amount: number
  readonly transactionKind: NetVoxBankActivityKind
  readonly counterpartyDisplayName?: string
  readonly counterpartyPaymentIdentifier?: string
  readonly note?: string
  readonly createdAt: string
}

export interface NetVoxBankActivityPage {
  readonly items: readonly NetVoxBankActivity[]
  readonly hasMore: boolean
  readonly nextCursor?: NetVoxBankCursor
}

export interface NetVoxBankPayload {
  readonly serverNow: string
  readonly clientReceivedAtMs: number
  readonly identity: NetVoxBankIdentity
  readonly wallet: NetVoxBankWalletSummary
  readonly bank: NetVoxBankAccount | null
  readonly yield: NetVoxBankYield | null
  readonly activity: NetVoxBankActivityPage
}

export type NetVoxBankErrorCode =
  | 'authentication-required'
  | 'active-identity-required'
  | 'account-not-found'
  | 'account-inactive'
  | 'institution-unavailable'
  | 'insufficient-funds'
  | 'yield-not-ready'
  | 'yield-not-available'
  | 'idempotency-conflict'
  | 'invalid-request'
  | 'invalid-server-response'
  | 'request-failed'

export class NetVoxBankError extends Error {
  readonly code: NetVoxBankErrorCode

  constructor(code: NetVoxBankErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'NetVoxBankError'
    this.code = code
  }
}

export function formatNetVoxBankAmount(amount: number): string {
  return `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(amount)} vG`
}
