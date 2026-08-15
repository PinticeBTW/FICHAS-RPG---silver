import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clipboard,
  Coins,
  CreditCard,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  WalletCards,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import {
  adjustNetEconomyGmWallet,
  enableNetEconomyGmKarmaProfile,
  fetchNetEconomyGmWallet,
  fetchNetEconomyGmWalletDirectory,
  searchNetEconomyPayees,
} from '../../lib/netEconomyService'
import {
  NET_ECONOMY_MAX_TRANSACTION_AMOUNT,
  NET_ECONOMY_NOTE_MAX_LENGTH,
  NET_ECONOMY_REASON_MAX_LENGTH,
  formatNetEconomyAmount,
  formatNetEconomyBalance,
  netEconomyCurrencyLabel,
  type NetEconomyActivity,
  type NetEconomyCurrency,
  type NetEconomyGmAdjustmentAction,
  type NetEconomyGmWalletDirectoryRow,
  type NetEconomyPayee,
  type NetEconomyWalletPayload,
} from '../../lib/netEconomyTypes'
import type { NetAppAccessMode } from './netAppCatalog'
import { useNetDialog } from './netDialogStack'
import { useNetEconomyWallet } from './useNetEconomyWallet'

import '../../styles/vlt.css'

interface VltAppProps {
  readonly accessMode: NetAppAccessMode
  readonly expectedIdentityLinkId?: string
  readonly identitySessionKey: string | null
  readonly isWindowOpen: boolean
  readonly onNotice: (message: string) => void
}

type PlayerSection = 'wallet' | 'pay' | 'receive'

interface PaymentReview {
  readonly payee: NetEconomyPayee
  readonly currency: NetEconomyCurrency
  readonly amount: number
  readonly note?: string
  readonly requestKey: string
}

interface AdjustmentReview {
  readonly currency: NetEconomyCurrency
  readonly action: NetEconomyGmAdjustmentAction
  readonly amount: number
  readonly reason: string
  readonly requestKey: string
}

function requestKey(): string {
  return crypto.randomUUID()
}

function ActivityList({ items }: { readonly items: readonly NetEconomyActivity[] }) {
  if (items.length === 0) {
    return <div className="vlt-empty"><Coins size={22} /><strong>No activity yet</strong><span>This VLT identity has no recorded transactions.</span></div>
  }

  return <div className="vlt-activity-list">{items.map((activity) => {
    const incoming = activity.amount > 0
    let title = activity.counterpartyDisplayName ?? 'VLT transfer'
    // The fallback preserves the deployed VOX-only projection during a rolling
    // frontend/SQL handoff. The new migration always names VOX or SHNEIDER.
    const bankName = activity.counterpartyInstitutionName ?? 'VOX BANK'

    if (activity.transactionKind === 'bank-deposit') title = `Deposit to ${bankName}`
    else if (activity.transactionKind === 'bank-withdrawal') title = `Withdrawal from ${bankName}`
    else if (activity.transactionKind === 'bank-yield') title = 'VOX Yield'
    else if (activity.transactionKind === 'bank-adoption-correction') title = 'ALTARA VG adoption correction'
    else if (activity.transactionKind === 'sheet-vg-adjustment') title = 'Sheet adjustment'
    else if (activity.transactionKind === 'sheet-karma-adjustment') title = 'Sheet reputation adjustment'
    else if (activity.transactionKind === 'opening-balance') title = 'Opening balance'
    else if (activity.transactionKind === 'gm-credit' || activity.transactionKind === 'gm-debit') {
      title = 'Network adjustment'
    }
    return (
      <article className="vlt-activity" key={activity.transactionId}>
        <span className="vlt-activity__icon" data-direction={incoming ? 'incoming' : 'outgoing'}>
          {incoming ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
        </span>
        <div>
          <strong>{title}</strong>
          <span>{new Date(activity.createdAt).toLocaleString()}</span>
          {activity.note ? <small>{activity.note}</small> : null}
        </div>
        <b data-direction={incoming ? 'incoming' : 'outgoing'}>
          {incoming ? '+' : '−'}{formatNetEconomyAmount(Math.abs(activity.amount), activity.currencyCode)}
        </b>
      </article>
    )
  })}</div>
}

function CurrencyPicker({ value, onChange, label = 'PAY WITH', karmaDisabledReason }: {
  readonly value: NetEconomyCurrency
  readonly onChange: (currency: NetEconomyCurrency) => void
  readonly label?: string
  readonly karmaDisabledReason?: string
}) {
  return (
    <fieldset className="vlt-currency-picker">
      <legend>{label}</legend>
      <div className="vlt-segmented">
        <button type="button" aria-pressed={value === 'VG'} onClick={() => onChange('VG')}>vG</button>
        <button type="button" aria-pressed={value === 'KARMA'} disabled={Boolean(karmaDisabledReason)} onClick={() => onChange('KARMA')}>Karma</button>
      </div>
      {karmaDisabledReason ? <small className="vlt-helper">{karmaDisabledReason}</small> : null}
    </fieldset>
  )
}

function VltConfirmation({
  title,
  body,
  confirmLabel,
  pending,
  error,
  footnote = 'This ledger action cannot be undone.',
  onCancel,
  onConfirm,
}: {
  readonly title: string
  readonly body: string
  readonly confirmLabel: string
  readonly pending: boolean
  readonly error?: string
  readonly footnote?: string
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  const { dialogRef, onFocusCapture } = useNetDialog<HTMLDivElement>(onCancel)
  return (
    <div className="vlt-dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !pending) onCancel()
    }}>
      <div
        ref={dialogRef}
        className="vlt-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="vlt-confirmation-title"
        tabIndex={-1}
        onFocusCapture={onFocusCapture}
      >
        <header><ShieldCheck size={18} /><strong id="vlt-confirmation-title">{title}</strong><button type="button" aria-label="Close confirmation" disabled={pending} onClick={onCancel}><X size={15} /></button></header>
        <p>{body}</p>
        <small>{footnote}</small>
        {error ? <div className="vlt-inline-error" role="alert">{error}</div> : null}
        <footer>
          <button type="button" data-net-dialog-initial-focus disabled={pending} onClick={onCancel}>Cancel</button>
          <button type="button" className="vlt-primary" disabled={pending} onClick={onConfirm}>
            {pending ? <LoaderCircle className="vlt-spin" size={14} /> : <Check size={14} />}{pending ? 'Authorizing…' : confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  )
}

function VltPlayer({ expectedIdentityLinkId, identitySessionKey, enabled, onNotice }: {
  readonly expectedIdentityLinkId?: string
  readonly identitySessionKey: string | null
  readonly enabled: boolean
  readonly onNotice: (message: string) => void
}) {
  const wallet = useNetEconomyWallet(enabled, expectedIdentityLinkId ?? null, identitySessionKey)
  const [section, setSection] = useState<PlayerSection>('wallet')
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string>()
  const [payees, setPayees] = useState<readonly NetEconomyPayee[]>([])
  const [selectedPayee, setSelectedPayee] = useState<NetEconomyPayee | null>(null)
  const [currency, setCurrency] = useState<NetEconomyCurrency>('VG')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [review, setReview] = useState<PaymentReview | null>(null)
  const [reviewError, setReviewError] = useState<string>()
  const searchGenerationRef = useRef(0)
  const vgBalance = wallet.balances.find((balance) => balance.currencyCode === 'VG')
  const karmaBalance = wallet.balances.find((balance) => balance.currencyCode === 'KARMA')
  const karmaSpendDisabledReason = !karmaBalance
    ? 'Karma profile not registered.'
    : karmaBalance.balanceAmount <= 0
      ? 'Positive Karma is required to spend social capital.'
      : undefined
  const paymentCurrency = currency === 'KARMA' && karmaSpendDisabledReason ? 'VG' : currency

  useEffect(() => {
    if (section !== 'pay') return
    const normalized = query.trim()
    const generation = ++searchGenerationRef.current
    if (normalized.length < 2 || !expectedIdentityLinkId) return
    const timer = window.setTimeout(() => {
      void searchNetEconomyPayees(expectedIdentityLinkId, normalized).then((next) => {
        if (generation !== searchGenerationRef.current) return
        setPayees(next)
        setSearchError(undefined)
      }).catch((caught) => {
        if (generation !== searchGenerationRef.current) return
        setPayees([])
        setSearchError(caught instanceof Error ? caught.message : 'Recipient search failed.')
      }).finally(() => {
        if (generation === searchGenerationRef.current) setSearching(false)
      })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [expectedIdentityLinkId, query, section])

  const openReview = (event: FormEvent) => {
    event.preventDefault()
    const parsedAmount = Number(amount)
    if (!selectedPayee || !Number.isSafeInteger(parsedAmount) || parsedAmount < 1 || parsedAmount > NET_ECONOMY_MAX_TRANSACTION_AMOUNT) {
      setSearchError(`Choose a recipient and enter a valid whole-${netEconomyCurrencyLabel(paymentCurrency)} amount.`)
      return
    }
    if (paymentCurrency === 'KARMA' && (!karmaBalance || karmaBalance.balanceAmount < parsedAmount)) {
      setSearchError('Positive available Karma is required for this payment.')
      return
    }
    if (paymentCurrency === 'KARMA' && !selectedPayee.karmaAvailable) {
      setSearchError('That VLT recipient does not have a Karma profile.')
      return
    }
    if (note.trim().length > NET_ECONOMY_NOTE_MAX_LENGTH) {
      setSearchError(`Payment notes are limited to ${NET_ECONOMY_NOTE_MAX_LENGTH} characters.`)
      return
    }
    setReview({
      payee: selectedPayee,
      currency: paymentCurrency,
      amount: parsedAmount,
      ...(note.trim() ? { note: note.trim() } : {}),
      requestKey: requestKey(),
    })
    setReviewError(undefined)
  }

  const confirmPayment = async () => {
    if (!review) return
    setReviewError(undefined)
    try {
      await wallet.transfer({
        paymentIdentifier: review.payee.paymentIdentifier,
        currency: review.currency,
        amount: review.amount,
        note: review.note,
        requestKey: review.requestKey,
      })
      onNotice(`VLT // ${formatNetEconomyAmount(review.amount, review.currency)} SENT TO ${review.payee.displayName.toUpperCase()}`)
      setReview(null)
      setSelectedPayee(null)
      setQuery('')
      setAmount('')
      setNote('')
      setSection('wallet')
    } catch (caught) {
      setReviewError(caught instanceof Error ? caught.message : 'Payment failed.')
    }
  }

  if (wallet.status === 'idle' || wallet.status === 'loading') {
    return <div className="vlt-state"><LoaderCircle className="vlt-spin" size={25} /><strong>Opening VLT wallet</strong><span>Resolving the active identity through VEGA MESH.</span></div>
  }
  if (wallet.status === 'error' || !wallet.identity) {
    return <div className="vlt-state" data-tone="error"><ShieldCheck size={25} /><strong>Wallet unavailable</strong><span>{wallet.error ?? 'The VLT wallet could not be opened.'}</span><button type="button" onClick={() => void wallet.retry()}><RefreshCw size={14} /> Retry</button></div>
  }

  return (
    <div className="vlt-app">
      <header className="vlt-header">
        <div><span className="vlt-kicker">NEW VEGA NETWORK // PAYMENTS</span><h1>VLT</h1><small><i /> VEGA MESH // AUTHENTICATED</small></div>
        <div className="vlt-header__identity"><span>WALLET HOLDER</span><strong>{wallet.identity.displayName}</strong><small>@{wallet.identity.paymentIdentifier}</small></div>
      </header>

      <nav className="vlt-tabs" aria-label="Wallet sections">
        <button type="button" aria-current={section === 'wallet' ? 'page' : undefined} onClick={() => setSection('wallet')}>Wallet</button>
        <button type="button" aria-current={section === 'pay' ? 'page' : undefined} onClick={() => setSection('pay')}>Pay</button>
        <button type="button" aria-current={section === 'receive' ? 'page' : undefined} onClick={() => setSection('receive')}>Receive</button>
      </nav>

      {wallet.error ? <div className="vlt-refresh-notice" role="alert">{wallet.error}<button type="button" onClick={() => void wallet.retry()}>Retry</button></div> : null}

      {section === 'wallet' ? <main className="vlt-player-grid">
        <section className="vlt-balance-card">
          <span>AVAILABLE BALANCES</span>
          <div className="vlt-balances">
            {vgBalance ? <div data-currency="VG"><small>vG</small><strong>{formatNetEconomyBalance(vgBalance.balanceAmount, 'VG')}</strong></div> : null}
            {karmaBalance ? <div data-currency="KARMA" data-negative={karmaBalance.balanceAmount < 0 ? 'true' : undefined}>
              <small>Karma</small>
              <strong>{formatNetEconomyBalance(karmaBalance.balanceAmount, 'KARMA')}</strong>
              {karmaBalance.balanceAmount < 0 ? <small className="vlt-balance-state">Negative reputation · Karma payments unavailable</small> : null}
              {karmaBalance.balanceAmount === 0 ? <small className="vlt-balance-state" data-tone="neutral">Neutral reputation · Karma payments unavailable</small> : null}
            </div> : <div data-currency="KARMA" data-unregistered="true"><small>Karma</small><strong>Not registered</strong><small className="vlt-balance-state" data-tone="neutral">No Karma profile</small></div>}
          </div>
          <small>vG and Karma are independent · Karma represents rare spendable social capital · no conversion</small>
          <div className="vlt-balance-actions"><button type="button" className="vlt-primary" onClick={() => setSection('pay')}><ArrowUpRight size={15} /> Pay</button><button type="button" onClick={() => setSection('receive')}><ArrowDownLeft size={15} /> Receive</button></div>
        </section>
        <section className="vlt-ledger-card">
          <header><div><span>RECENT ACTIVITY</span><strong>Combined authoritative ledger</strong></div>{wallet.refreshing ? <small><LoaderCircle className="vlt-spin" size={12} /> Syncing</small> : null}</header>
          <ActivityList items={wallet.activity} />
          {wallet.hasMore ? <button type="button" className="vlt-load-more" disabled={wallet.loadingMore} onClick={() => void wallet.loadMore()}>{wallet.loadingMore ? <LoaderCircle className="vlt-spin" size={13} /> : null}Load older activity</button> : null}
        </section>
      </main> : null}

      {section === 'pay' ? <main className="vlt-flow">
        <header><span>PAY</span><h2>Send from {wallet.identity.displayName}</h2><p>Choose one currency. VLT resolves the same payment identity to the matching authoritative balance.</p></header>
        <form onSubmit={openReview}>
          <label><span>TO</span><div className="vlt-search"><Search size={15} /><input type="search" value={query} maxLength={60} placeholder="Name or VLT payment ID" onChange={(event) => {
            const next = event.target.value
            setQuery(next)
            setSelectedPayee(null)
            setSearching(next.trim().length >= 2)
            if (next.trim().length < 2) {
              setPayees([])
              setSearchError(undefined)
            }
          }} /></div></label>
          {searching ? <small className="vlt-helper"><LoaderCircle className="vlt-spin" size={12} /> Searching VLT identities…</small> : null}
          {selectedPayee ? <button type="button" className="vlt-selected-payee" onClick={() => setSelectedPayee(null)}><span><strong>{selectedPayee.displayName}</strong><small>@{selectedPayee.paymentIdentifier} · {selectedPayee.karmaAvailable ? 'vG + Karma' : 'vG only'}</small></span><X size={14} /></button> : query.trim().length >= 2 && !searching ? <div className="vlt-payee-results">{payees.length ? payees.map((payee) => {
            const unavailable = paymentCurrency === 'KARMA' && !payee.karmaAvailable
            return <button type="button" key={payee.paymentIdentifier} disabled={unavailable} onClick={() => { setSelectedPayee(payee); setSearchError(undefined) }}><span><strong>{payee.displayName}</strong><small>@{payee.paymentIdentifier} · {payee.karmaAvailable ? 'vG + Karma' : 'vG only'}</small></span><ChevronRight size={14} /></button>
          }) : <small>No matching VLT identities.</small>}</div> : null}
          <CurrencyPicker value={paymentCurrency} karmaDisabledReason={karmaSpendDisabledReason} onChange={(next) => {
            setCurrency(next)
            if (next === 'KARMA' && selectedPayee && !selectedPayee.karmaAvailable) setSelectedPayee(null)
            setSearchError(undefined)
          }} />
          <label><span>AMOUNT</span><div className="vlt-amount-input"><input inputMode="numeric" pattern="[0-9]*" value={amount} placeholder="0" onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, '').slice(0, 10))} /><b>{netEconomyCurrencyLabel(paymentCurrency)}</b></div></label>
          <label><span>OPTIONAL NOTE</span><textarea value={note} maxLength={NET_ECONOMY_NOTE_MAX_LENGTH} placeholder="Short payment context" onChange={(event) => setNote(event.target.value)} /><small>{note.length}/{NET_ECONOMY_NOTE_MAX_LENGTH}</small></label>
          {searchError ? <div className="vlt-inline-error" role="alert">{searchError}</div> : null}
          <button type="submit" className="vlt-primary" disabled={!selectedPayee || !amount}>Review payment <ChevronRight size={14} /></button>
        </form>
      </main> : null}

      {section === 'receive' ? <main className="vlt-flow vlt-receive">
        <header><span>RECEIVE</span><h2>Your VLT payment identity</h2><p>One public identifier resolves to the payment methods registered for this identity. It reveals no email, login, or internal account UUID.</p></header>
        <div className="vlt-receive-card"><WalletCards size={27} /><span>PAYMENT IDENTIFIER</span><strong>@{wallet.identity.paymentIdentifier}</strong><small>{wallet.identity.displayName} · accepts {karmaBalance ? 'vG + Karma' : 'vG'}</small><button type="button" onClick={() => {
          const copy = navigator.clipboard?.writeText(wallet.identity!.paymentIdentifier)
          if (!copy) {
            onNotice('VLT // CLIPBOARD UNAVAILABLE')
            return
          }
          void copy.then(() => onNotice('VLT // PAYMENT IDENTIFIER COPIED')).catch(() => onNotice('VLT // COPY FAILED'))
        }}><Clipboard size={14} /> Copy identifier</button></div>
      </main> : null}

      {review ? <VltConfirmation
        title={`Send ${formatNetEconomyAmount(review.amount, review.currency)} to ${review.payee.displayName}?`}
        body={`${formatNetEconomyAmount(review.amount, review.currency)} will move atomically between matching ${netEconomyCurrencyLabel(review.currency)} balances.`}
        confirmLabel="Send payment"
        pending={wallet.mutationPending}
        error={reviewError}
        onCancel={() => { if (!wallet.mutationPending) setReview(null) }}
        onConfirm={() => void confirmPayment()}
      /> : null}
    </div>
  )
}

function VltGmControl({ enabled, onNotice }: { readonly enabled: boolean; readonly onNotice: (message: string) => void }) {
  const [directory, setDirectory] = useState<readonly NetEconomyGmWalletDirectoryRow[]>([])
  const [query, setQuery] = useState('')
  const [directoryLoading, setDirectoryLoading] = useState(true)
  const [directoryError, setDirectoryError] = useState<string>()
  const [selectedId, setSelectedId] = useState<string>()
  const [selected, setSelected] = useState<NetEconomyWalletPayload>()
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string>()
  const [currency, setCurrency] = useState<NetEconomyCurrency>('VG')
  const [action, setAction] = useState<NetEconomyGmAdjustmentAction>('credit')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [review, setReview] = useState<AdjustmentReview | null>(null)
  const [enrollmentReview, setEnrollmentReview] = useState(false)
  const [reviewError, setReviewError] = useState<string>()
  const [mutationPending, setMutationPending] = useState(false)
  const directoryGenerationRef = useRef(0)
  const detailGenerationRef = useRef(0)
  const selectedVgBalance = selected?.balances.find((balance) => balance.currencyCode === 'VG')
  const selectedKarmaBalance = selected?.balances.find((balance) => balance.currencyCode === 'KARMA')

  const loadDirectory = useCallback(async (search = '') => {
    const generation = ++directoryGenerationRef.current
    setDirectoryLoading(true)
    try {
      const next = await fetchNetEconomyGmWalletDirectory(search)
      if (generation !== directoryGenerationRef.current) return
      setDirectory(next)
      setDirectoryError(undefined)
    } catch (caught) {
      if (generation === directoryGenerationRef.current) setDirectoryError(caught instanceof Error ? caught.message : 'Economy directory failed.')
    } finally {
      if (generation === directoryGenerationRef.current) setDirectoryLoading(false)
    }
  }, [])

  const loadSelected = useCallback(async (paymentIdentifier: string, cursor?: NetEconomyWalletPayload['activity']['nextCursor']) => {
    const generation = ++detailGenerationRef.current
    setDetailLoading(true)
    try {
      const next = await fetchNetEconomyGmWallet(paymentIdentifier, cursor)
      if (generation !== detailGenerationRef.current) return
      setSelected((previous) => cursor && previous
        ? { ...next, activity: { ...next.activity, items: [...previous.activity.items, ...next.activity.items] } }
        : next)
      setDetailError(undefined)
    } catch (caught) {
      if (generation === detailGenerationRef.current) setDetailError(caught instanceof Error ? caught.message : 'Wallet detail failed.')
    } finally {
      if (generation === detailGenerationRef.current) setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    const timer = window.setTimeout(() => { void loadDirectory(query.trim()) }, query ? 300 : 0)
    return () => window.clearTimeout(timer)
  }, [enabled, loadDirectory, query])

  useEffect(() => {
    if (!enabled || !selectedId) return
    void loadSelected(selectedId)
  }, [enabled, loadSelected, selectedId])

  const submitAdjustment = (event: FormEvent) => {
    event.preventDefault()
    const parsed = Number(amount)
    if (!selectedId || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > NET_ECONOMY_MAX_TRANSACTION_AMOUNT) {
      setDetailError(`Enter a valid whole-${netEconomyCurrencyLabel(currency)} amount.`)
      return
    }
    if (!reason.trim() || reason.trim().length > NET_ECONOMY_REASON_MAX_LENGTH) {
      setDetailError(`A reason of 1–${NET_ECONOMY_REASON_MAX_LENGTH} characters is required.`)
      return
    }
    setReview({ currency, action, amount: parsed, reason: reason.trim(), requestKey: requestKey() })
    setReviewError(undefined)
  }

  const confirmAdjustment = async () => {
    if (!review || !selectedId) return
    setMutationPending(true)
    setReviewError(undefined)
    try {
      const next = await adjustNetEconomyGmWallet({ paymentIdentifier: selectedId, ...review })
      setSelected(next)
      const vg = next.balances.find((balance) => balance.currencyCode === 'VG')?.balanceAmount ?? 0
      const karma = next.balances.find((balance) => balance.currencyCode === 'KARMA')?.balanceAmount ?? null
      setDirectory((current) => current.map((row) => row.paymentIdentifier === selectedId
        ? { ...row, vgBalanceAmount: vg, karmaBalanceAmount: karma }
        : row))
      const actionLabel = review.currency === 'KARMA'
        ? (review.action === 'credit' ? 'INCREASED' : 'DECREASED')
        : review.action.toUpperCase()
      onNotice(`ECONOMY CONTROL // ${actionLabel} ${formatNetEconomyAmount(review.amount, review.currency)}`)
      setReview(null)
      setAmount('')
      setReason('')
    } catch (caught) {
      setReviewError(caught instanceof Error ? caught.message : 'Adjustment failed.')
    } finally {
      setMutationPending(false)
    }
  }

  const confirmEnrollment = async () => {
    if (!selectedId) return
    setMutationPending(true)
    setReviewError(undefined)
    try {
      const next = await enableNetEconomyGmKarmaProfile(selectedId)
      setSelected(next)
      setDirectory((current) => current.map((row) => row.paymentIdentifier === selectedId
        ? { ...row, karmaBalanceAmount: 0 }
        : row))
      setEnrollmentReview(false)
      setCurrency('KARMA')
      onNotice('ECONOMY CONTROL // KARMA PROFILE ENABLED')
    } catch (caught) {
      setReviewError(caught instanceof Error ? caught.message : 'Karma enrolment failed.')
    } finally {
      setMutationPending(false)
    }
  }

  return (
    <div className="vlt-app vlt-gm">
      <header className="vlt-header"><div><span className="vlt-kicker">NEW VEGA NETWORK // GM SYSTEM</span><h1>ECONOMY CONTROL</h1><small><i /> AUTHORITATIVE LEDGER ACCESS</small></div><div className="vlt-header__identity"><span>AUTHORITY</span><strong>VEGA MESH</strong><small>Persona-independent</small></div></header>
      <main className="vlt-gm-grid">
        <aside className="vlt-directory">
          <header><span>VLT IDENTITIES</span><strong>{directory.length} bounded results</strong></header>
          <div className="vlt-search"><Search size={14} /><input type="search" value={query} maxLength={60} placeholder="Name or payment ID" onChange={(event) => setQuery(event.target.value)} /></div>
          {directoryError ? <div className="vlt-inline-error">{directoryError}<button type="button" onClick={() => void loadDirectory(query)}>Retry</button></div> : null}
          <div className="vlt-directory__list">{directoryLoading && directory.length === 0 ? <div className="vlt-helper"><LoaderCircle className="vlt-spin" size={13} /> Loading wallets…</div> : directory.map((row) => <button type="button" key={row.paymentIdentifier} aria-current={selectedId === row.paymentIdentifier ? 'true' : undefined} onClick={() => { setSelected(undefined); setCurrency('VG'); setSelectedId(row.paymentIdentifier) }}><span><strong>{row.displayName}</strong><small>@{row.paymentIdentifier}</small></span><b><em>{formatNetEconomyBalance(row.vgBalanceAmount, 'VG')}</em><em>{row.karmaBalanceAmount === null ? 'NO KARMA' : formatNetEconomyBalance(row.karmaBalanceAmount, 'KARMA')}</em></b></button>)}</div>
        </aside>

        {!selectedId ? <section className="vlt-gm-empty"><CreditCard size={28} /><strong>Select a VLT identity</strong><span>Inspect vG, optional Karma reputation, and one bounded authoritative ledger.</span></section> : detailLoading && !selected ? <section className="vlt-gm-empty"><LoaderCircle className="vlt-spin" size={25} /><strong>Loading authoritative wallet</strong></section> : selected ? <section className="vlt-gm-detail">
          <header><div><span>SELECTED VLT IDENTITY</span><h2>{selected.identity.displayName}</h2><small>@{selected.identity.paymentIdentifier}</small></div><div className="vlt-gm-balances"><strong>{selectedVgBalance ? formatNetEconomyBalance(selectedVgBalance.balanceAmount, 'VG') : 'vG unavailable'}</strong><strong data-unregistered={!selectedKarmaBalance ? 'true' : undefined}>{selectedKarmaBalance ? formatNetEconomyBalance(selectedKarmaBalance.balanceAmount, 'KARMA') : 'Karma · Not registered'}</strong></div></header>
          {detailError ? <div className="vlt-inline-error">{detailError}</div> : null}
          <form onSubmit={submitAdjustment}>
            <CurrencyPicker value={currency} onChange={setCurrency} label="CURRENCY" karmaDisabledReason={!selectedKarmaBalance ? 'Enable a Karma profile before adjusting reputation.' : undefined} />
            {!selectedKarmaBalance ? <div className="vlt-karma-enrollment"><span>KARMA</span><strong>NOT REGISTERED</strong><p>This identity is outside the Karma reputation system. Silver may explicitly enrol it at neutral 0.</p><button type="button" disabled={mutationPending} onClick={() => { setReviewError(undefined); setEnrollmentReview(true) }}><ShieldCheck size={14} /> Enable Karma profile</button></div> : null}
            <div className="vlt-segmented"><button type="button" aria-pressed={action === 'credit'} onClick={() => setAction('credit')}>{currency === 'KARMA' ? 'Increase Karma' : 'Credit'}</button><button type="button" aria-pressed={action === 'debit'} onClick={() => setAction('debit')}>{currency === 'KARMA' ? 'Decrease Karma' : 'Debit'}</button></div>
            <label><span>AMOUNT</span><div className="vlt-amount-input"><input inputMode="numeric" value={amount} placeholder="0" onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, '').slice(0, 10))} /><b>{netEconomyCurrencyLabel(currency)}</b></div></label>
            <label><span>REASON</span><textarea value={reason} maxLength={NET_ECONOMY_REASON_MAX_LENGTH} placeholder="Required ledger reason" onChange={(event) => setReason(event.target.value)} /><small>{reason.length}/{NET_ECONOMY_REASON_MAX_LENGTH}</small></label>
            <button type="submit" className="vlt-primary" disabled={!amount || !reason.trim()}><ShieldCheck size={14} /> Review {currency === 'KARMA' ? (action === 'credit' ? 'increase' : 'decrease') : action}</button>
          </form>
          <div className="vlt-gm-ledger"><header><span>COMBINED HISTORY</span><strong>Recent first</strong></header><ActivityList items={selected.activity.items} />{selected.activity.hasMore ? <button type="button" className="vlt-load-more" disabled={detailLoading} onClick={() => void loadSelected(selected.identity.paymentIdentifier, selected.activity.nextCursor)}>Load older activity</button> : null}</div>
        </section> : <section className="vlt-gm-empty" data-tone="error"><ShieldCheck size={25} /><strong>Wallet unavailable</strong><span>{detailError}</span><button type="button" onClick={() => void loadSelected(selectedId)}>Retry</button></section>}
      </main>
      {review && selected ? <VltConfirmation
        title={`${review.currency === 'KARMA' ? (review.action === 'credit' ? 'Increase' : 'Decrease') : (review.action === 'credit' ? 'Credit' : 'Debit')} ${formatNetEconomyAmount(review.amount, review.currency)}?`}
        body={review.currency === 'KARMA'
          ? `${selected.identity.displayName}'s signed reputation will receive this ledgered ${review.action === 'credit' ? 'increase' : 'decrease'}.`
          : `${selected.identity.displayName} will receive a ledgered ${review.action} against the vG clearing account.`}
        confirmLabel={`Authorize ${review.currency === 'KARMA' ? (review.action === 'credit' ? 'increase' : 'decrease') : review.action}`}
        pending={mutationPending}
        error={reviewError}
        onCancel={() => { if (!mutationPending) setReview(null) }}
        onConfirm={() => void confirmAdjustment()}
      /> : null}
      {enrollmentReview && selected ? <VltConfirmation
        title={`Enable Karma for ${selected.identity.displayName}?`}
        body="This enrols the identity in New Vega's Karma reputation system at exactly 0. It does not alter vG or create an opening transaction."
        confirmLabel="Enable Karma profile"
        pending={mutationPending}
        error={reviewError}
        footnote="Karma-profile removal is not available in V1."
        onCancel={() => { if (!mutationPending) setEnrollmentReview(false) }}
        onConfirm={() => void confirmEnrollment()}
      /> : null}
    </div>
  )
}

export function VltApp({ accessMode, expectedIdentityLinkId, identitySessionKey, isWindowOpen, onNotice }: VltAppProps) {
  if (accessMode === 'gm-system') {
    return <VltGmControl enabled={isWindowOpen} onNotice={onNotice} />
  }
  return <VltPlayer key={identitySessionKey ?? 'no-identity'} expectedIdentityLinkId={expectedIdentityLinkId} identitySessionKey={identitySessionKey} enabled={isWindowOpen} onNotice={onNotice} />
}
