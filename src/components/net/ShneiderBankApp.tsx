import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Building2,
  Check,
  ChevronRight,
  Cross,
  HeartPulse,
  LoaderCircle,
  LockKeyhole,
  Pill,
  RefreshCw,
  Send,
  ShieldCheck,
} from 'lucide-react'
import { useState, type FormEvent } from 'react'

import {
  NET_SHNEIDER_BANK_MAX_TRANSFER_AMOUNT,
  formatNetShneiderBankAmount,
  type NetShneiderBankActivity,
  type NetShneiderBankDirection,
} from '../../lib/netShneiderBankTypes'
import { BankPaySurface, BankReceiveSurface } from './BankPaymentSurface'
import { useNetShneiderBank } from './useNetShneiderBank'

import '../../styles/shneiderBank.css'

interface ShneiderBankAppProps {
  readonly expectedIdentityLinkId?: string
  readonly identitySessionKey: string | null
  readonly isWindowOpen: boolean
  readonly onNotice: (message: string) => void
  readonly allowVltMoves?: boolean
  readonly networkAuthorityLabel?: string
}

type ShneiderBankSection = 'overview' | 'move' | 'pay' | 'receive' | 'activity'

function benefitLabel(category: string) {
  if (category === 'hospital') return 'Hospitals'
  if (category === 'clinic') return 'Clinics'
  return 'Pharmacies'
}

function benefitIcon(category: string) {
  return category === 'pharmacy' ? <Pill size={16} /> : <Cross size={16} />
}

function percentage(basisPoints: number) {
  return `${(basisPoints / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}%`
}

function activityLabel(activity: NetShneiderBankActivity) {
  if (activity.transactionKind === 'bank-deposit') return 'Deposit from VLT'
  if (activity.transactionKind === 'bank-withdrawal') return 'Withdrawal to VLT'
  return activity.amount > 0
    ? `Payment from ${activity.counterpartyDisplayName ?? 'SHNEIDER customer'}`
    : `Payment to ${activity.counterpartyDisplayName ?? 'SHNEIDER customer'}`
}

function ShneiderActivity({ items }: { readonly items: readonly NetShneiderBankActivity[] }) {
  if (items.length === 0) {
    return <div className="shneider-bank-empty"><Building2 size={24} /><strong>No account activity</strong><span>Deposits, withdrawals, and direct SHNEIDER payments will appear here.</span></div>
  }
  return (
    <div className="shneider-bank-activity-list">
      {items.map((activity) => {
        const incoming = activity.amount > 0
        return (
          <article key={activity.transactionId} className="shneider-bank-activity">
            <span data-direction={incoming ? 'incoming' : 'outgoing'}>{incoming ? <ArrowDownToLine size={15} /> : <ArrowUpFromLine size={15} />}</span>
            <div><strong>{activityLabel(activity)}</strong>{activity.counterpartyPaymentIdentifier ? <small>@{activity.counterpartyPaymentIdentifier}</small> : null}<time>{new Date(activity.createdAt).toLocaleString()}</time></div>
            <b data-direction={incoming ? 'incoming' : 'outgoing'}>{incoming ? '+' : '−'}{formatNetShneiderBankAmount(Math.abs(activity.amount))}</b>
          </article>
        )
      })}
    </div>
  )
}

export function ShneiderBankApp({
  expectedIdentityLinkId,
  identitySessionKey,
  isWindowOpen,
  onNotice,
  allowVltMoves = true,
  networkAuthorityLabel = 'VEGA MESH',
}: ShneiderBankAppProps) {
  const controller = useNetShneiderBank(isWindowOpen, expectedIdentityLinkId ?? null, identitySessionKey)
  const [section, setSection] = useState<ShneiderBankSection>('overview')
  const [direction, setDirection] = useState<NetShneiderBankDirection>('deposit')
  const [amount, setAmount] = useState('')
  const [review, setReview] = useState<{ direction: NetShneiderBankDirection; amount: number; requestKey: string } | null>(null)
  const [actionError, setActionError] = useState<string>()
  const payload = controller.payload
  const bank = payload?.bank ?? null

  const availableSource = direction === 'deposit'
    ? payload?.wallet.balanceAmount ?? 0
    : bank?.balanceAmount ?? 0

  const reviewMove = (event: FormEvent) => {
    event.preventDefault()
    const parsed = Number(amount)
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > NET_SHNEIDER_BANK_MAX_TRANSFER_AMOUNT) {
      setActionError('Enter a valid whole-vG amount.')
      return
    }
    if (parsed > availableSource) {
      setActionError(direction === 'deposit' ? 'Your VLT balance is too low for that deposit.' : 'Your SHNEIDER BANK balance is too low for that withdrawal.')
      return
    }
    setReview({ direction, amount: parsed, requestKey: crypto.randomUUID() })
    setActionError(undefined)
  }

  const confirmMove = async () => {
    if (!review) return
    setActionError(undefined)
    try {
      await controller.transfer(review)
      onNotice(`SHNEIDER BANK // ${review.direction === 'deposit' ? 'DEPOSIT' : 'WITHDRAWAL'} COMPLETE`)
      setReview(null)
      setAmount('')
      setSection('overview')
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Bank transfer failed.')
    }
  }

  if (controller.status === 'idle' || controller.status === 'loading') {
    return <div className="shneider-bank-app shneider-bank-state" role="status"><LoaderCircle className="shneider-bank-spin" size={25} /><strong>Opening private banking terminal</strong><span>Resolving the active identity through {networkAuthorityLabel}.</span></div>
  }

  if (controller.status === 'error' || !payload) {
    return <div className="shneider-bank-app shneider-bank-state" data-tone="error"><LockKeyhole size={25} /><strong>SHNEIDER BANK unavailable</strong><span>{controller.error ?? 'The private account service could not be opened.'}</span><button type="button" onClick={() => void controller.retry()}><RefreshCw size={14} /> Retry</button></div>
  }

  if (!bank) {
    return (
      <div className="shneider-bank-app shneider-bank-onboarding">
        <header className="shneider-bank-header"><div><HeartPulse size={24} /><h1>SHNEIDER BANK</h1><span>SHNEIDER // PRIVATE HEALTH BANKING</span></div><small><i /> {networkAuthorityLabel} // AUTHENTICATED</small></header>
        <main><div className="shneider-bank-seal"><ShieldCheck size={39} /><span>SB</span></div><div><h2>Open a SHNEIDER BANK account</h2><p>Private banking with preferred access across the SHNEIDER medical network.</p><dl><div><dt>Opening balance</dt><dd>0 vG</dd></div><div><dt>Payments</dt><dd>Direct SHNEIDER routing</dd></div><div><dt>Account currency</dt><dd>vG only</dd></div></dl>{controller.error ? <div className="shneider-bank-error" role="alert">{controller.error}</div> : null}<button type="button" className="shneider-bank-primary" disabled={controller.mutation === 'open'} onClick={() => void controller.openAccount().then(() => onNotice('SHNEIDER BANK // ACCOUNT OPENED')).catch(() => undefined)}>{controller.mutation === 'open' ? <LoaderCircle className="shneider-bank-spin" size={15} /> : <ShieldCheck size={15} />}{controller.mutation === 'open' ? 'Opening account…' : 'Open account'}</button></div></main>
      </div>
    )
  }

  return (
    <div className="shneider-bank-app">
      <header className="shneider-bank-header"><div><HeartPulse size={24} /><h1>SHNEIDER BANK</h1><span>SHNEIDER // PRIVATE HEALTH BANKING</span></div><div className="shneider-bank-holder"><span>PRIVATE CLIENT</span><strong>{payload.identity.displayName}</strong><small><i /> {networkAuthorityLabel} // VERIFIED</small></div></header>
      <nav className="shneider-bank-nav" aria-label="SHNEIDER BANK sections">
        {(['overview', ...(allowVltMoves ? ['move' as const] : []), 'pay', 'receive', 'activity'] as const).map((item) => <button key={item} type="button" aria-current={section === item ? 'page' : undefined} onClick={() => { setSection(item); setActionError(undefined); setReview(null) }}>{item === 'move' ? 'Move vG' : item}</button>)}
        <span data-status={controller.realtimeStatus}>{controller.refreshing ? 'Synchronizing' : controller.realtimeStatus === 'subscribed' ? 'Private link' : controller.realtimeStatus === 'connecting' ? 'Connecting' : 'Link offline'}</span>
      </nav>

      {controller.error ? <div className="shneider-bank-refresh-error" role="alert">{controller.error}<button type="button" onClick={() => void controller.retry()}>Retry</button></div> : null}

      {section === 'overview' ? (
        <main className="shneider-bank-overview">
          <section className="shneider-bank-balance"><span>AVAILABLE BANK BALANCE</span><strong>{formatNetShneiderBankAmount(bank.balanceAmount)}</strong><small>Private vG account · no Karma</small><div><button type="button" className="shneider-bank-primary" onClick={() => setSection('pay')}><Send size={15} /> Pay</button>{allowVltMoves ? <button type="button" onClick={() => { setDirection('deposit'); setSection('move') }}><ArrowDownToLine size={15} /> Deposit</button> : null}{allowVltMoves ? <button type="button" onClick={() => { setDirection('withdraw'); setSection('move') }}><ArrowUpFromLine size={15} /> Withdraw</button> : null}</div></section>
          <section className="shneider-bank-benefits"><header><HeartPulse size={18} /><div><strong>Health network benefits</strong><small>Applied by future qualifying merchant checkout</small></div></header><div>{payload.benefits.map((benefit) => <article key={benefit.merchantCategory}>{benefitIcon(benefit.merchantCategory)}<span>{benefitLabel(benefit.merchantCategory)}</span><strong>{percentage(benefit.discountBasisPoints)}</strong></article>)}</div><p>Benefits do not add free balance. They reduce a qualifying charge only when an authoritative merchant checkout supports it.</p></section>
          <section className="shneider-bank-account-line">{allowVltMoves ? <div><span>VLT AVAILABLE</span><strong>{formatNetShneiderBankAmount(payload.wallet.balanceAmount)}</strong></div> : null}<div><span>PAYMENT ID</span><strong>@{bank.paymentIdentifier}</strong></div><div><span>OPENED</span><strong>{new Date(bank.openedAt).toLocaleDateString()}</strong></div></section>
        </main>
      ) : null}

      {allowVltMoves && section === 'move' ? (
        <main className="shneider-bank-move"><header><h2>Move vG</h2><p>Deposit from or withdraw to your own VLT wallet through one balanced transaction.</p></header><form onSubmit={reviewMove}><fieldset><legend>DIRECTION</legend><div className="shneider-bank-direction"><button type="button" aria-pressed={direction === 'deposit'} onClick={() => { setDirection('deposit'); setReview(null); setActionError(undefined) }}><ArrowDownToLine size={16} /><span><strong>Deposit</strong><small>VLT → SHNEIDER</small></span></button><button type="button" aria-pressed={direction === 'withdraw'} onClick={() => { setDirection('withdraw'); setReview(null); setActionError(undefined) }}><ArrowUpFromLine size={16} /><span><strong>Withdraw</strong><small>SHNEIDER → VLT</small></span></button></div></fieldset><div className="shneider-bank-route"><span>AVAILABLE</span><strong>{formatNetShneiderBankAmount(availableSource)}</strong></div><label><span>AMOUNT</span><div><input inputMode="numeric" pattern="[0-9]*" value={amount} placeholder="0" onChange={(event) => { setAmount(event.target.value.replace(/[^0-9]/g, '').slice(0, 10)); setReview(null); setActionError(undefined) }} /><b>vG</b></div></label>{review ? <div className="shneider-bank-review"><strong>{review.direction === 'deposit' ? 'Deposit to SHNEIDER BANK' : 'Withdraw to VLT'}</strong><span>{formatNetShneiderBankAmount(review.amount)}</span><small>Both account entries commit together.</small><div><button type="button" disabled={controller.mutation !== null} onClick={() => setReview(null)}>Cancel</button><button type="button" className="shneider-bank-primary" disabled={controller.mutation !== null} onClick={() => void confirmMove()}>{controller.mutation ? <LoaderCircle className="shneider-bank-spin" size={14} /> : <Check size={14} />} Confirm</button></div></div> : null}{actionError ? <div className="shneider-bank-error" role="alert">{actionError}</div> : null}{!review ? <button type="submit" className="shneider-bank-primary" disabled={!amount || controller.mutation !== null}>Review {direction}<ChevronRight size={14} /></button> : null}</form></main>
      ) : null}

      {section === 'pay' ? <BankPaySurface idPrefix="shneider-bank" institutionName="SHNEIDER BANK" balanceAmount={bank.balanceAmount} maximumAmount={NET_SHNEIDER_BANK_MAX_TRANSFER_AMOUNT} pending={controller.mutation === 'payment'} searchPayees={controller.searchPayees} onPay={controller.pay} onSuccess={(payee, paidAmount) => { onNotice(`SHNEIDER BANK // ${formatNetShneiderBankAmount(paidAmount)} PAID TO ${payee.displayName.toUpperCase()}`); setSection('overview') }} /> : null}
      {section === 'receive' ? <BankReceiveSurface institutionName="SHNEIDER BANK" paymentIdentifier={bank.paymentIdentifier} /> : null}
      {section === 'activity' ? <main className="shneider-bank-ledger"><header><div><h2>Account activity</h2><p>Bounded SHNEIDER BANK statement · recent first</p></div>{controller.refreshing ? <small><LoaderCircle className="shneider-bank-spin" size={12} /> Syncing</small> : null}</header><ShneiderActivity items={payload.activity.items} />{payload.activity.hasMore ? <button type="button" className="shneider-bank-load-more" disabled={controller.loadingMore} onClick={() => void controller.loadMore()}>{controller.loadingMore ? <LoaderCircle className="shneider-bank-spin" size={13} /> : null}Load older activity</button> : null}</main> : null}
    </div>
  )
}
