export const NET_SHNEIDER_BANK_HISTORY_DEFAULT_LIMIT = 20
export const NET_SHNEIDER_BANK_HISTORY_MAX_LIMIT = 40
export const NET_SHNEIDER_BANK_MAX_TRANSFER_AMOUNT = 1_000_000_000

export type NetShneiderBankDirection = 'deposit' | 'withdraw'
export type NetShneiderBankMutation = 'open' | NetShneiderBankDirection | 'payment'
export type NetShneiderBankActivityKind = 'bank-deposit' | 'bank-withdrawal' | 'bank-transfer'
export type NetShneiderBenefitCategory = 'hospital' | 'clinic' | 'pharmacy'

export interface NetShneiderBankCursor {
  readonly at: string
  readonly id: string
}

export interface NetShneiderBankAccount {
  readonly accountId: string
  readonly paymentIdentifier: string
  readonly balanceAmount: number
  readonly status: 'active' | 'closed'
  readonly openedAt: string
  readonly updatedAt: string
}

export interface NetShneiderBankActivity {
  readonly transactionId: string
  readonly amount: number
  readonly transactionKind: NetShneiderBankActivityKind
  readonly counterpartyDisplayName?: string
  readonly counterpartyPaymentIdentifier?: string
  readonly createdAt: string
}

export interface NetShneiderBankActivityPage {
  readonly items: readonly NetShneiderBankActivity[]
  readonly hasMore: boolean
  readonly nextCursor?: NetShneiderBankCursor
}

export interface NetShneiderBankBenefit {
  readonly merchantCategory: NetShneiderBenefitCategory
  readonly discountBasisPoints: number
}

export interface NetShneiderBankPayload {
  readonly serverNow: string
  readonly clientReceivedAtMs: number
  readonly identity: { readonly displayName: string }
  readonly institution: {
    readonly institutionCode: 'SHNEIDER'
    readonly displayName: 'SHNEIDER BANK'
    readonly ownerName: 'SHNEIDER'
  }
  readonly wallet: {
    readonly accountId: string
    readonly balanceAmount: number
    readonly updatedAt: string
  }
  readonly bank: NetShneiderBankAccount | null
  readonly benefits: readonly NetShneiderBankBenefit[]
  readonly activity: NetShneiderBankActivityPage
}

export function formatNetShneiderBankAmount(amount: number): string {
  return `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(amount)} vG`
}
