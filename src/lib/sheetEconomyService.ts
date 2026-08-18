import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'
import { isNetOsId, type NetOsId } from './netOsTypes'

export const SHEET_ECONOMY_AUTHORITY_CHANGED_EVENT = 'rpgsilver:sheet-economy-authority-changed'

export function notifySheetEconomyAuthorityChanged(): void {
  window.dispatchEvent(new Event(SHEET_ECONOMY_AUTHORITY_CHANGED_EVENT))
}

export type SheetEconomySubjectKind = 'profile-sheet' | 'npc-card'

export interface SheetEconomyAccountSummary {
  readonly accountId: string
  readonly balanceAmount: number
  readonly currencyCode: 'VG' | 'FINIT' | 'SECTUS'
  readonly currency?: {
    readonly singularLabel: string
    readonly pluralLabel: string
  }
  readonly updatedAt: string
}

export interface SheetEconomyAccountSources {
  readonly serverNow: string
  readonly primaryOsId: NetOsId | null
  readonly vlt: SheetEconomyAccountSummary | null
  readonly voxBank: SheetEconomyAccountSummary | null
  readonly shneiderBank: SheetEconomyAccountSummary | null
  readonly altaraBank: SheetEconomyAccountSummary | null
  readonly novaBank: SheetEconomyAccountSummary | null
  readonly altaraFundsTotal: number | null
  readonly homeCurrency: {
    readonly currencyCode: 'VG' | 'FINIT' | 'SECTUS'
    readonly displayName: string
    readonly singularLabel: string
    readonly pluralLabel: string
  } | null
}

const SHEET_CURRENCY_CODES = ['VG', 'FINIT', 'SECTUS'] as const
type SheetCurrencyCode = typeof SHEET_CURRENCY_CODES[number]

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function parseHomeCurrency(value: unknown): SheetEconomyAccountSources['homeCurrency'] {
  if (value === null) return null
  const row = asRecord(value)
  if (
    !row
    || !SHEET_CURRENCY_CODES.includes(row.currency_code as SheetCurrencyCode)
    || typeof row.display_name !== 'string'
    || !row.display_name.trim()
    || typeof row.singular_label !== 'string'
    || !row.singular_label.trim()
    || typeof row.plural_label !== 'string'
    || !row.plural_label.trim()
  ) {
    throw new Error('The sheet currency response was invalid.')
  }
  return {
    currencyCode: row.currency_code as SheetCurrencyCode,
    displayName: row.display_name,
    singularLabel: row.singular_label,
    pluralLabel: row.plural_label,
  }
}

function parseAccount(
  value: unknown,
  expectedCurrency: 'VG' | 'FINIT' | 'SECTUS' | null,
): SheetEconomyAccountSummary | null {
  if (value === null) return null
  const row = asRecord(value)
  const rawBalance = row?.balance_amount
  const balanceAmount = typeof rawBalance === 'number' ? rawBalance : Number(rawBalance)

  if (
    !row ||
    typeof row.account_id !== 'string' ||
    (expectedCurrency !== null && row.currency_code !== expectedCurrency) ||
    !SHEET_CURRENCY_CODES.includes(row.currency_code as SheetCurrencyCode) ||
    !Number.isSafeInteger(balanceAmount) ||
    balanceAmount < 0 ||
    typeof row.updated_at !== 'string'
  ) {
    throw new Error('The sheet account response was invalid.')
  }

  return {
    accountId: row.account_id,
    balanceAmount,
    currencyCode: row.currency_code as SheetEconomyAccountSummary['currencyCode'],
    ...(asRecord(row.currency)
      ? { currency: {
          singularLabel: String(asRecord(row.currency)?.singular_label ?? ''),
          pluralLabel: String(asRecord(row.currency)?.plural_label ?? ''),
        } }
      : {}),
    updatedAt: row.updated_at,
  }
}

export async function fetchSheetEconomyAccountSources(input: {
  subjectKind: SheetEconomySubjectKind
  subjectId: string
}): Promise<SheetEconomyAccountSources> {
  if (!supabase) throw new Error(SUPABASE_CONFIG_ERROR)

  const { data, error } = await supabase.rpc('fetch_net_economy_sheet_account_sources', {
    requested_subject_kind: input.subjectKind,
    requested_subject_id: input.subjectId,
  })
  if (error) throw error

  const payload = asRecord(data)
  if (!payload || typeof payload.server_now !== 'string') {
    throw new Error('The sheet account response was invalid.')
  }
  const primaryOsId = payload.primary_os_id
  if (primaryOsId !== null && primaryOsId !== undefined && !isNetOsId(primaryOsId)) {
    throw new Error('The sheet account response contained an unsupported operating system.')
  }
  const altaraBank = parseAccount(payload.altara_bank ?? null, null)
  const novaBank = parseAccount(payload.nova_bank ?? null, null)
  const rawFundsTotal = payload.altara_funds_total
  // The server distinguishes "no active bank account" (null) from a
  // legitimate zero balance. Trust it directly rather than re-deriving a
  // fabricated sum, which would turn absence back into a fake 0.
  const altaraFundsTotal = rawFundsTotal === null || rawFundsTotal === undefined
    ? null
    : Number(rawFundsTotal)
  if (
    altaraFundsTotal !== null
    && (!Number.isSafeInteger(altaraFundsTotal) || altaraFundsTotal < 0)
  ) {
    throw new Error('The sheet funds response was invalid.')
  }

  return {
    serverNow: payload.server_now,
    primaryOsId: isNetOsId(primaryOsId) ? primaryOsId : null,
    homeCurrency: parseHomeCurrency(payload.home_currency ?? null),
    vlt: parseAccount(payload.vlt, 'VG'),
    voxBank: parseAccount(payload.vox_bank, 'VG'),
    shneiderBank: parseAccount(payload.shneider_bank, 'VG'),
    altaraBank,
    novaBank,
    altaraFundsTotal,
  }
}
