import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'
import type { NetBankInstitution, NetBankPayee } from './netBankPaymentTypes'

interface RpcErrorLike {
  readonly code?: string
  readonly message: string
}

const PAYMENT_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function parsePayees(value: unknown): readonly NetBankPayee[] {
  if (!Array.isArray(value)) throw new Error('The bank directory response was invalid.')
  return value.map((entry) => {
    const row = asRecord(entry)
    if (
      !row
      || typeof row.display_name !== 'string'
      || !row.display_name.trim()
      || row.display_name.length > 160
      || typeof row.payment_identifier !== 'string'
      || !PAYMENT_IDENTIFIER_PATTERN.test(row.payment_identifier)
    ) {
      throw new Error('The bank directory response was invalid.')
    }
    return {
      displayName: row.display_name,
      paymentIdentifier: row.payment_identifier,
    }
  })
}

export function mapNetBankPaymentError(
  institutionLabel: string,
  error: RpcErrorLike,
): Error {
  const message = error.message ?? ''
  if (message.includes('ECONOMY_ACTIVE_IDENTITY_REQUIRED')) {
    return new Error(`Select a playable identity before using ${institutionLabel}.`)
  }
  if (error.code === '42501' || message.includes('ECONOMY_AUTH_REQUIRED')) {
    return new Error('Authentication through VEGA MESH is required.')
  }
  if (message.includes('ECONOMY_BANK_ACCOUNT_NOT_FOUND')) {
    return new Error(`Open your ${institutionLabel} account before making a payment.`)
  }
  if (message.includes('ECONOMY_BANK_PAYEE_NOT_FOUND')) {
    return new Error(`That recipient does not have an active ${institutionLabel} account.`)
  }
  if (message.includes('ECONOMY_SELF_TRANSFER_INVALID')) {
    return new Error('Choose another account holder.')
  }
  if (message.includes('ECONOMY_BANK_INSUFFICIENT_FUNDS')) {
    return new Error(`Your ${institutionLabel} balance is too low for this payment.`)
  }
  if (message.includes('ECONOMY_IDEMPOTENCY_CONFLICT')) {
    return new Error('This request key was already used for a different bank action.')
  }
  if (message.includes('ECONOMY_') || message.includes('_BANK_')) {
    return new Error(`${institutionLabel} rejected this request.`)
  }
  return new Error(`${institutionLabel} request failed: ${message}`)
}

export async function searchNetBankPayees(
  institution: NetBankInstitution,
  expectedIdentityLinkId: string,
  query: string,
): Promise<readonly NetBankPayee[]> {
  if (!supabase) throw new Error(SUPABASE_CONFIG_ERROR)
  const normalized = query.trim().slice(0, 80)
  if (normalized.length < 2) return []
  const functionName = institution === 'vox'
    ? 'search_net_economy_vox_bank_payees'
    : 'search_net_economy_shneider_bank_payees'
  const { data, error } = await supabase.rpc(functionName, {
    requested_expected_identity_link_id: expectedIdentityLinkId,
    requested_query: normalized,
    requested_limit: 12,
  })
  const label = institution === 'vox' ? 'VOX BANK' : 'SHNEIDER BANK'
  if (error) throw mapNetBankPaymentError(label, error)
  return parsePayees(data)
}
