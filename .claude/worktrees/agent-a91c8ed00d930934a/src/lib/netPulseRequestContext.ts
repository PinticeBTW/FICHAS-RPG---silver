export interface NetPulseCompromisedRequestContext {
  readonly expectedAccountId: string
  readonly expectedSessionGeneration: string
}

export interface NetPulseRequestContext {
  /** Comparison-only assertion. The server still derives the viewer account. */
  readonly expectedAccountId: string | null
  readonly compromised?: NetPulseCompromisedRequestContext
}

export type NetPulseContextChangeKind = 'account' | 'compromised'

export class NetPulseContextChangedError extends Error {
  readonly kind: NetPulseContextChangeKind

  constructor(kind: NetPulseContextChangeKind) {
    super(kind === 'compromised'
      ? 'Compromised session changed before this action completed.'
      : 'Character changed before this action completed.')
    this.name = 'NetPulseContextChangedError'
    this.kind = kind
  }
}

export class NetPulseRateLimitedError extends Error {
  constructor() {
    super("You're doing that too quickly. Try again in a moment.")
    this.name = 'NetPulseRateLimitedError'
  }
}

export function mapNetPulseRpcError(prefix: string, message: string): Error {
  if (message.includes('PULSE_RATE_LIMITED')) {
    return new NetPulseRateLimitedError()
  }
  if (message.includes('PULSE_COMPROMISED_CONTEXT_CHANGED')) {
    return new NetPulseContextChangedError('compromised')
  }
  if (message.includes('PULSE_ACCOUNT_CONTEXT_CHANGED')) {
    return new NetPulseContextChangedError('account')
  }
  return new Error(`${prefix}: ${message}`)
}

export function isNetPulseContextChangedError(
  error: unknown,
): error is NetPulseContextChangedError {
  return error instanceof NetPulseContextChangedError
}

export function pulseContextRpcArgs(context: NetPulseRequestContext) {
  return {
    requested_expected_account_id: context.expectedAccountId,
    requested_expected_session_generation:
      context.compromised?.expectedSessionGeneration ?? null,
    requested_expected_compromised_account_id:
      context.compromised?.expectedAccountId ?? null,
  }
}
