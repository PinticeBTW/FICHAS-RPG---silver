import { Check, ChevronRight, Copy, LoaderCircle, Search, Send, UserRound, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import type { NetBankPayee } from '../../lib/netBankPaymentTypes'
import { useNetDialog } from './netDialogStack'

import '../../styles/bankPayments.css'

interface BankPaymentReview {
  readonly payee: NetBankPayee
  readonly amount: number
  readonly requestKey: string
  readonly quote?: BankPaymentQuote
}

interface BankPaymentQuote {
  readonly sourceAmount: number
  readonly targetAmount: number
  readonly sourceLabel: string
  readonly targetLabel: string
  readonly sourceRateLabel?: string
  readonly targetRateLabel?: string
  readonly sourceUnits: number
  readonly targetUnits: number
  readonly rateRevision?: string
  readonly sameCurrency: boolean
}

interface BankPaySurfaceProps {
  readonly idPrefix: string
  readonly institutionName: string
  readonly balanceAmount: number
  readonly maximumAmount: number
  readonly currencyLabel?: string
  readonly currencySingularLabel?: string
  readonly currencyPluralLabel?: string
  readonly showPayeeAvatars?: boolean
  readonly describePayee?: (payee: NetBankPayee) => string | undefined
  readonly formatQuoteError?: (error: unknown, payee: NetBankPayee) => string | undefined
  readonly pending: boolean
  readonly searchPayees: (query: string) => Promise<readonly NetBankPayee[]>
  readonly quotePayment?: (input: {
    paymentIdentifier: string
    amount: number
  }) => Promise<BankPaymentQuote>
  readonly onPay: (input: {
    paymentIdentifier: string
    amount: number
    rateRevision?: string
    requestKey: string
  }) => Promise<void>
  readonly onSuccess: (payee: NetBankPayee, amount: number) => void
}

interface BankReceiveSurfaceProps {
  readonly institutionName: string
  readonly paymentIdentifier: string
  readonly currencyLabel?: string
}

function formatAmount(amount: number, currencyLabel: string) {
  return `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(amount)} ${currencyLabel}`
}

function amountLabel(
  amount: number,
  fallback: string,
  singular?: string,
  plural?: string,
) {
  return amount === 1 ? singular ?? fallback : plural ?? fallback
}

function initials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'A'
}

function BankPayeeAvatar({ payee }: { readonly payee: NetBankPayee }) {
  const [failedUrl, setFailedUrl] = useState<string>()
  const avatarUrl = payee.avatarUrl && payee.avatarUrl !== failedUrl
    ? payee.avatarUrl
    : undefined

  return (
    <span className="bank-payment-payee-avatar" aria-hidden="true">
      {avatarUrl
        ? <img src={avatarUrl} alt="" onError={() => setFailedUrl(avatarUrl)} />
        : initials(payee.displayName)}
    </span>
  )
}

function BankPaymentConfirmation({
  idPrefix,
  institutionName,
  review,
  currencyLabel,
  pending,
  error,
  showPayeeAvatar,
  payeeContext,
  onCancel,
  onConfirm,
}: {
  readonly idPrefix: string
  readonly institutionName: string
  readonly review: BankPaymentReview
  readonly currencyLabel: string
  readonly pending: boolean
  readonly error?: string
  readonly showPayeeAvatar: boolean
  readonly payeeContext?: string
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  const { dialogRef, onFocusCapture } = useNetDialog<HTMLDivElement>(onCancel)
  return (
    <div className="bank-payment-dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !pending) onCancel()
    }}>
      <div
        ref={dialogRef}
        className="bank-payment-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${idPrefix}-payment-confirmation-title`}
        tabIndex={-1}
        onFocusCapture={onFocusCapture}
      >
        <header>
          <span><Send size={16} /></span>
          <strong id={`${idPrefix}-payment-confirmation-title`}>Confirm bank payment</strong>
          <button type="button" aria-label="Close confirmation" disabled={pending} onClick={onCancel}>
            <X size={15} />
          </button>
        </header>
        {showPayeeAvatar ? (
          <div className="bank-payment-dialog__recipient">
            <BankPayeeAvatar payee={review.payee} />
            <span><small>RECIPIENT</small><strong>{review.payee.displayName}</strong>{payeeContext ? <em>{payeeContext}</em> : null}</span>
          </div>
        ) : (
          <div className="bank-payment-dialog__route">
            <span>{institutionName}</span><ChevronRight size={15} /><span>{review.payee.displayName}</span>
          </div>
        )}
        {!showPayeeAvatar ? <p>Pay {formatAmount(review.amount, currencyLabel)} to {review.payee.displayName}?</p> : null}
        {review.quote && !review.quote.sameCurrency ? (
          <div className="bank-payment-dialog__fx">
            <span><small>YOU SEND</small><strong>{formatAmount(review.quote.sourceAmount, review.quote.sourceLabel)}</strong></span>
            <ChevronRight size={16} aria-hidden="true" />
            <span><small>{review.payee.displayName.toUpperCase()} RECEIVES</small><strong>{formatAmount(review.quote.targetAmount, review.quote.targetLabel)}</strong></span>
            <p><small>EXCHANGE RATE</small><strong>{review.quote.sourceUnits} {review.quote.sourceRateLabel ?? review.quote.sourceLabel} = {review.quote.targetUnits} {review.quote.targetRateLabel ?? review.quote.targetLabel}</strong></p>
          </div>
        ) : showPayeeAvatar ? (
          <div className="bank-payment-dialog__same-currency">
            <span><small>YOU SEND</small><strong>{formatAmount(review.amount, currencyLabel)}</strong></span>
            <span><small>{review.payee.displayName.toUpperCase()} RECEIVES</small><strong>{formatAmount(review.amount, currencyLabel)}</strong></span>
          </div>
        ) : null}
        <small>{review.quote?.sameCurrency
          ? `Funds move directly between two ${institutionName} accounts. This payment cannot be undone.`
          : 'Two currency-homogeneous ledger transactions will settle this quoted exchange. This payment cannot be undone.'}</small>
        {error ? <div className="bank-payment-error" role="alert">{error}</div> : null}
        <footer>
          <button type="button" data-net-dialog-initial-focus disabled={pending} onClick={onCancel}>Cancel</button>
          <button type="button" className="bank-payment-primary" disabled={pending} onClick={onConfirm}>
            {pending ? <LoaderCircle className="bank-payment-spin" size={14} /> : <Check size={14} />}
            {pending ? 'Authorizing…' : `Pay ${formatAmount(review.amount, currencyLabel)}`}
          </button>
        </footer>
      </div>
    </div>
  )
}

export function BankPaySurface({
  idPrefix,
  institutionName,
  balanceAmount,
  maximumAmount,
  currencyLabel = 'vG',
  currencySingularLabel,
  currencyPluralLabel,
  showPayeeAvatars = false,
  describePayee,
  formatQuoteError,
  pending,
  searchPayees,
  quotePayment,
  onPay,
  onSuccess,
}: BankPaySurfaceProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<readonly NetBankPayee[]>([])
  const [selected, setSelected] = useState<NetBankPayee | null>(null)
  const [amount, setAmount] = useState('')
  const [searching, setSearching] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string>()
  const [review, setReview] = useState<BankPaymentReview | null>(null)
  const searchGenerationRef = useRef(0)

  useEffect(() => () => { searchGenerationRef.current += 1 }, [])

  const runSearch = async (event: FormEvent) => {
    event.preventDefault()
    if (query.trim().length < 2 || searching) return
    const generation = ++searchGenerationRef.current
    setSearching(true)
    setError(undefined)
    try {
      const next = await searchPayees(query)
      if (generation !== searchGenerationRef.current) return
      setResults(next)
      setSearched(true)
      setSelected(null)
    } catch (caught) {
      if (generation !== searchGenerationRef.current) return
      setError(caught instanceof Error ? caught.message : 'Bank directory search failed.')
    } finally {
      if (generation === searchGenerationRef.current) setSearching(false)
    }
  }

  const openReview = async (event: FormEvent) => {
    event.preventDefault()
    const parsed = Number(amount)
    if (!selected) {
      setError('Choose a recipient from this bank directory.')
      return
    }
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximumAmount) {
      setError(`Enter a valid whole-${currencyLabel} amount.`)
      return
    }
    if (parsed > balanceAmount) {
      setError(`Your ${institutionName} balance is too low for this payment.`)
      return
    }
    setReviewing(true)
    setError(undefined)
    try {
      const quote = quotePayment
        ? await quotePayment({ paymentIdentifier: selected.paymentIdentifier, amount: parsed })
        : undefined
      setReview({ payee: selected, amount: parsed, requestKey: crypto.randomUUID(), ...(quote ? { quote } : {}) })
    } catch (caught) {
      setError(formatQuoteError?.(caught, selected)
        ?? (caught instanceof Error ? caught.message : 'The bank could not prepare this payment quote.'))
    } finally {
      setReviewing(false)
    }
  }

  const confirm = async () => {
    if (!review) return
    setError(undefined)
    try {
      await onPay({
        paymentIdentifier: review.payee.paymentIdentifier,
        amount: review.amount,
        ...(review.quote?.rateRevision ? { rateRevision: review.quote.rateRevision } : {}),
        requestKey: review.requestKey,
      })
      onSuccess(review.payee, review.amount)
      setReview(null)
      setSelected(null)
      setResults([])
      setSearched(false)
      setQuery('')
      setAmount('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Bank payment failed.')
    }
  }

  return (
    <main className="bank-payment-surface">
      <header><h2>Pay from {institutionName}</h2><p>Send {currencyPluralLabel ?? currencyLabel} directly to another customer at this bank.</p></header>
      <div className="bank-payment-layout">
        <form className="bank-payment-search" onSubmit={runSearch}>
          <label htmlFor={`${idPrefix}-payment-query`}>RECIPIENT</label>
          <div><Search size={15} /><input id={`${idPrefix}-payment-query`} value={query} onChange={(event) => { searchGenerationRef.current += 1; setSearching(false); setQuery(event.target.value.slice(0, 80)); setError(undefined) }} placeholder={`Name or ${institutionName} payment ID`} /><button type="submit" disabled={searching || query.trim().length < 2}>{searching ? <LoaderCircle className="bank-payment-spin" size={14} /> : 'Search'}</button></div>
          <small>Only active {institutionName} customers appear. Balances remain private.</small>
          <div className="bank-payment-results" aria-live="polite">
            {results.map((payee) => (
              <button key={payee.paymentIdentifier} type="button" aria-pressed={selected?.paymentIdentifier === payee.paymentIdentifier} onClick={() => { setSelected(payee); setError(undefined) }}>
                {showPayeeAvatars
                  ? <BankPayeeAvatar payee={payee} />
                  : <UserRound size={15} />}
                <span><strong>{payee.displayName}</strong><small>@{payee.paymentIdentifier}</small></span><ChevronRight size={14} />
              </button>
            ))}
            {searched && results.length === 0 ? <p>No matching {institutionName} customer.</p> : null}
          </div>
        </form>
        <form className="bank-payment-amount" onSubmit={(event) => { void openReview(event) }}>
          <span>AVAILABLE</span><strong>{formatAmount(balanceAmount, amountLabel(balanceAmount, currencyLabel, currencySingularLabel, currencyPluralLabel))}</strong>
          <label htmlFor={`${idPrefix}-payment-amount`}>AMOUNT</label>
          <div><input id={`${idPrefix}-payment-amount`} inputMode="numeric" pattern="[0-9]*" value={amount} onChange={(event) => { setAmount(event.target.value.replace(/[^0-9]/g, '').slice(0, 10)); setError(undefined) }} placeholder="0" /><b>{currencyPluralLabel ?? currencyLabel}</b></div>
          {selected && showPayeeAvatars ? (
            <div className="bank-payment-selected-recipient">
              <BankPayeeAvatar payee={selected} />
              <span><small>RECIPIENT</small><strong>{selected.displayName}</strong><em>{describePayee?.(selected) ?? `@${selected.paymentIdentifier}`}</em></span>
            </div>
          ) : selected ? <p>TO <strong>{selected.displayName}</strong><small>@{selected.paymentIdentifier}{selected.currency ? ` · ${selected.currency.currencyCode}` : ''}</small></p> : <p>Choose a same-bank recipient first.</p>}
          {error && !review ? <div className="bank-payment-error" role="alert">{error}</div> : null}
          <button type="submit" className="bank-payment-primary" disabled={!selected || !amount || pending || reviewing}>{reviewing ? <LoaderCircle className="bank-payment-spin" size={14} /> : null}{reviewing ? 'Preparing quote…' : 'Review payment'}{!reviewing ? <ChevronRight size={14} /> : null}</button>
        </form>
      </div>
      {review ? <BankPaymentConfirmation idPrefix={idPrefix} institutionName={institutionName} review={review} currencyLabel={amountLabel(review.amount, currencyLabel, currencySingularLabel, currencyPluralLabel)} pending={pending} error={error} showPayeeAvatar={showPayeeAvatars} payeeContext={describePayee?.(review.payee)} onCancel={() => { if (!pending) setReview(null) }} onConfirm={() => void confirm()} /> : null}
    </main>
  )
}

export function BankReceiveSurface({ institutionName, paymentIdentifier, currencyLabel = 'vG' }: BankReceiveSurfaceProps) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`@${paymentIdentifier}`)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }
  return (
    <main className="bank-receive-surface">
      <div>
        <h2>Receive at {institutionName}</h2>
        <p>Share this {currencyLabel} payment identity with another {institutionName} customer.</p>
        <div className="bank-receive-identifier"><span>PAYMENT ID</span><strong>@{paymentIdentifier}</strong><button type="button" onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy ID'}</button></div>
        <small>Account UUIDs and balances are never included in the public directory.</small>
      </div>
    </main>
  )
}
