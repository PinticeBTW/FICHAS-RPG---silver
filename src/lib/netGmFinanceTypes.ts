export const NET_GM_FINANCE_MAX_ADJUSTMENT = 1_000_000_000
export const NET_GM_FINANCE_NOTE_MAX_LENGTH = 200

export type NetGmFinanceCurrencyCode = 'VG' | 'KARMA' | 'FINIT' | 'SECTUS'
export type NetGmFinanceAdjustmentAction = 'credit' | 'debit'

export interface NetGmFinanceCurrency {
  readonly currencyCode: NetGmFinanceCurrencyCode
  readonly displayName: string
  readonly singularLabel: string
  readonly pluralLabel: string
  readonly decimals: 0
  readonly status: 'active' | 'inactive'
}

export interface NetGmFinanceIdentitySummary {
  readonly identityLinkId: string
  readonly identityKind: 'player' | 'npc'
  readonly playability: 'playable' | 'non-playable'
  readonly subjectKind: 'profile-sheet' | 'npc-card' | 'character'
  readonly subjectId: string
  readonly displayName: string
  readonly avatarRef?: string
  readonly primaryOsId: 'veil' | 'altara'
  readonly homeCurrency: NetGmFinanceCurrency | null
  readonly accountCount: number
}

export interface NetGmFinanceAccount {
  readonly accountId: string
  readonly accountKind: 'wallet' | 'bank'
  readonly institutionCode: string
  readonly institutionName: string
  readonly paymentIdentifier?: string
  readonly currency: NetGmFinanceCurrency
  readonly balanceAmount: number
  readonly status: 'active' | 'closed'
  readonly updatedAt: string
}

export interface NetGmFinanceIdentityPayload {
  readonly serverNow: string
  readonly identity: Omit<NetGmFinanceIdentitySummary, 'accountCount'>
  readonly altaraFundsTotal: number | null
  readonly accounts: readonly NetGmFinanceAccount[]
}

export function formatNetGmFinanceAmount(
  amount: number,
  currency: NetGmFinanceCurrency,
): string {
  const formatted = new Intl.NumberFormat('en-GB', {
    maximumFractionDigits: 0,
  }).format(amount)
  const label = amount === 1 ? currency.singularLabel : currency.pluralLabel
  const sign = currency.currencyCode === 'KARMA' && amount > 0 ? '+' : ''
  return `${sign}${formatted} ${label}`
}
