export interface NetBankPayee {
  readonly displayName: string
  readonly paymentIdentifier: string
  readonly avatarUrl?: string
  readonly currency?: {
    readonly currencyCode: string
    readonly displayName: string
    readonly singularLabel: string
    readonly pluralLabel: string
  }
}

export type NetBankInstitution = 'vox' | 'shneider'
