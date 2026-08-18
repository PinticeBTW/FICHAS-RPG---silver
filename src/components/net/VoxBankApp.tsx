import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Building2,
  Check,
  ChevronRight,
  Clock3,
  Landmark,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Send,
  TrendingUp,
  X,
} from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import {
  NET_VOX_BANK_MAX_TRANSFER_AMOUNT,
  formatNetVoxBankAmount,
  type NetVoxBankActivity,
  type NetVoxBankDirection,
} from '../../lib/netVoxBankTypes'
import { useNetDialog } from './netDialogStack'
import { useNetVoxBank } from './useNetVoxBank'
import { BankPaySurface, BankReceiveSurface } from './BankPaymentSurface'

import '../../styles/voxBank.css'

interface VoxBankAppProps {
  readonly expectedIdentityLinkId?: string
  readonly identitySessionKey: string | null
  readonly isWindowOpen: boolean
  readonly onNotice: (message: string) => void
  readonly allowVltMoves?: boolean
  readonly networkAuthorityLabel?: string
}

type VoxBankSection = 'overview' | 'move' | 'pay' | 'receive' | 'activity'

interface TransferReview {
  readonly direction: NetVoxBankDirection
  readonly amount: number
  readonly requestKey: string
}

function formatDuration(milliseconds: number): string {
  if (milliseconds <= 0) return 'READY NOW'
  const totalMinutes = Math.ceil(milliseconds / 60_000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${Math.max(1, minutes)}m`
}

function yieldRateLabel(rateBasisPoints: number, periodSeconds: number): string {
  const percentage = rateBasisPoints / 100
  const days = Math.round(periodSeconds / 86_400)
  return `${percentage.toLocaleString('en-GB', { maximumFractionDigits: 2 })}% every ${days} real days`
}

function activityLabel(activity: NetVoxBankActivity): string {
  if (activity.transactionKind === 'gm-credit') return 'Authorized bank credit'
  if (activity.transactionKind === 'gm-debit') return 'Authorized bank debit'
  if (activity.transactionKind === 'bank-deposit') return 'Deposit from VLT'
  if (activity.transactionKind === 'bank-withdrawal') return 'Withdrawal to VLT'
  if (activity.transactionKind === 'bank-transfer') {
    return activity.amount > 0
      ? `Payment from ${activity.counterpartyDisplayName ?? 'VOX customer'}`
      : `Payment to ${activity.counterpartyDisplayName ?? 'VOX customer'}`
  }
  return 'VOX Yield'
}

function realtimeLabel(status: 'idle' | 'connecting' | 'subscribed' | 'disconnected', refreshing: boolean): string {
  if (refreshing) return 'Synchronizing'
  if (status === 'subscribed') return 'Secure link'
  if (status === 'connecting') return 'Connecting'
  if (status === 'disconnected') return 'Link offline'
  return 'Awaiting link'
}

function VoxBankConfirmation({
  review,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  readonly review: TransferReview
  readonly pending: boolean
  readonly error?: string
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  const { dialogRef, onFocusCapture } = useNetDialog<HTMLDivElement>(onCancel)
  const depositing = review.direction === 'deposit'
  return (
    <div className="vox-bank-dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !pending) onCancel()
    }}>
      <div
        ref={dialogRef}
        className="vox-bank-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="vox-bank-confirmation-title"
        tabIndex={-1}
        onFocusCapture={onFocusCapture}
      >
        <header>
          <span><ShieldCheck size={17} /></span>
          <strong id="vox-bank-confirmation-title">
            {depositing ? 'Confirm deposit' : 'Confirm withdrawal'}
          </strong>
          <button type="button" aria-label="Close confirmation" disabled={pending} onClick={onCancel}>
            <X size={15} />
          </button>
        </header>
        <div className="vox-bank-dialog__route">
          <span>{depositing ? 'VLT' : 'VOX BANK'}</span>
          <ChevronRight size={16} />
          <span>{depositing ? 'VOX BANK' : 'VLT'}</span>
        </div>
        <p>{formatNetVoxBankAmount(review.amount)} will move atomically between your own vG accounts.</p>
        <small>This movement restarts the seven-day VOX Yield eligibility period.</small>
        {error ? <div className="vox-bank-error" role="alert">{error}</div> : null}
        <footer>
          <button type="button" data-net-dialog-initial-focus disabled={pending} onClick={onCancel}>Cancel</button>
          <button type="button" className="vox-bank-primary" disabled={pending} onClick={onConfirm}>
            {pending ? <LoaderCircle className="vox-bank-spin" size={14} /> : <Check size={14} />}
            {pending ? 'Authorizing…' : depositing ? 'Deposit vG' : 'Withdraw vG'}
          </button>
        </footer>
      </div>
    </div>
  )
}

function VoxBankActivityList({ items }: { readonly items: readonly NetVoxBankActivity[] }) {
  if (items.length === 0) {
    return (
      <div className="vox-bank-empty">
        <Building2 size={23} />
        <strong>No bank activity yet</strong>
        <span>Deposits, payments, withdrawals, and claimed VOX Yield will appear here.</span>
      </div>
    )
  }
  return (
    <div className="vox-bank-activity-list">
      {items.map((activity) => {
        const incoming = activity.amount > 0
        return (
          <article className="vox-bank-activity" key={activity.transactionId}>
            <span className="vox-bank-activity__mark" data-direction={incoming ? 'incoming' : 'outgoing'}>
              {activity.transactionKind === 'bank-yield'
                ? <TrendingUp size={15} />
                : incoming ? <ArrowDownToLine size={15} /> : <ArrowUpFromLine size={15} />}
            </span>
            <div>
              <strong>{activityLabel(activity)}</strong>
              {activity.note ? <small>{activity.note}</small> : null}
              {activity.counterpartyPaymentIdentifier ? <small>@{activity.counterpartyPaymentIdentifier}</small> : null}
              <time>{new Date(activity.createdAt).toLocaleString()}</time>
            </div>
            <b data-direction={incoming ? 'incoming' : 'outgoing'}>
              {incoming ? '+' : '−'}{formatNetVoxBankAmount(Math.abs(activity.amount))}
            </b>
          </article>
        )
      })}
    </div>
  )
}

export function VoxBankApp({
  expectedIdentityLinkId,
  identitySessionKey,
  isWindowOpen,
  onNotice,
  allowVltMoves = true,
  networkAuthorityLabel = 'VEGA MESH',
}: VoxBankAppProps) {
  const controller = useNetVoxBank(isWindowOpen, expectedIdentityLinkId ?? null, identitySessionKey)
  const [section, setSection] = useState<VoxBankSection>('overview')
  const [direction, setDirection] = useState<NetVoxBankDirection>('deposit')
  const [amount, setAmount] = useState('')
  const [review, setReview] = useState<TransferReview | null>(null)
  const [transferError, setTransferError] = useState<string>()
  const [yieldError, setYieldError] = useState<string>()
  const [clock, setClock] = useState(() => Date.now())
  const payload = controller.payload
  const bank = payload?.bank ?? null
  const bankYield = payload?.yield ?? null

  useEffect(() => {
    if (!isWindowOpen || !bankYield) return
    const timer = window.setInterval(() => setClock(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [bankYield, isWindowOpen])

  const estimatedServerNow = payload
    ? Date.parse(payload.serverNow) + Math.max(0, clock - payload.clientReceivedAtMs)
    : clock
  const yieldRemaining = bankYield ? Date.parse(bankYield.eligibleAt) - estimatedServerNow : 0
  const yieldReady = Boolean(bankYield && bankYield.projectedAmount > 0 && yieldRemaining <= 0)
  const availableSource = direction === 'deposit'
    ? payload?.wallet.balanceAmount ?? 0
    : bank?.balanceAmount ?? 0

  const openTransferReview = (event: FormEvent) => {
    event.preventDefault()
    const parsed = Number(amount)
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > NET_VOX_BANK_MAX_TRANSFER_AMOUNT) {
      setTransferError('Enter a valid whole-vG amount.')
      return
    }
    if (parsed > availableSource) {
      setTransferError(direction === 'deposit'
        ? 'Your VLT wallet does not have enough vG for that deposit.'
        : 'Your VOX BANK account does not have enough vG for that withdrawal.')
      return
    }
    setReview({ direction, amount: parsed, requestKey: crypto.randomUUID() })
    setTransferError(undefined)
  }

  const confirmTransfer = async () => {
    if (!review) return
    setTransferError(undefined)
    try {
      await controller.transfer(review)
      onNotice(`VOX BANK // ${review.direction === 'deposit' ? 'DEPOSIT' : 'WITHDRAWAL'} COMPLETE`)
      setReview(null)
      setAmount('')
      setSection('overview')
    } catch (caught) {
      setTransferError(caught instanceof Error ? caught.message : 'Bank transfer failed.')
    }
  }

  const claimYield = async () => {
    setYieldError(undefined)
    try {
      await controller.claimYield(crypto.randomUUID())
      onNotice('VOX BANK // YIELD CLAIMED')
    } catch (caught) {
      setYieldError(caught instanceof Error ? caught.message : 'VOX Yield claim failed.')
    }
  }

  if (controller.status === 'idle' || controller.status === 'loading') {
    return (
      <div className="vox-bank-app vox-bank-state" role="status" aria-live="polite">
        <LoaderCircle className="vox-bank-spin" size={26} />
        <strong>Opening secure bank terminal</strong>
        <span>Resolving the active identity through {networkAuthorityLabel}.</span>
      </div>
    )
  }

  if (controller.status === 'error' || !payload) {
    return (
      <div className="vox-bank-app vox-bank-state" data-tone="error">
        <LockKeyhole size={26} />
        <strong>VOX BANK unavailable</strong>
        <span>{controller.error ?? 'The private account service could not be opened.'}</span>
        <button type="button" onClick={() => void controller.retry()}><RefreshCw size={14} /> Retry</button>
      </div>
    )
  }

  if (!bank || !bankYield) {
    return (
      <div className="vox-bank-app vox-bank-onboarding">
        <header className="vox-bank-header">
          <div><Landmark size={24} /><h1>VOX BANK</h1><span>VOX NET // DIGITAL BANKING</span></div>
          <small><i /> {networkAuthorityLabel} // AUTHENTICATED</small>
        </header>
        <main>
          <div className="vox-bank-onboarding__seal"><Landmark size={38} /><span>VG</span></div>
          <div>
            <h2>Open a VOX BANK account</h2>
            <p>{allowVltMoves
              ? 'Store vG securely, move funds directly from VLT, and earn periodic VOX Yield.'
              : 'Store vG securely, make direct VOX payments, and earn periodic VOX Yield.'}</p>
            <dl>
              <div><dt>Opening balance</dt><dd>0 vG</dd></div>
              <div><dt>Yield rule</dt><dd>1% every 7 real days</dd></div>
              <div><dt>Account currency</dt><dd>vG only</dd></div>
            </dl>
            {controller.error ? <div className="vox-bank-error" role="alert">{controller.error}</div> : null}
            <button
              type="button"
              className="vox-bank-primary"
              disabled={controller.mutation === 'open'}
              onClick={() => void controller.openAccount().then(() => {
                onNotice('VOX BANK // ACCOUNT OPENED')
              }).catch(() => undefined)}
            >
              {controller.mutation === 'open' ? <LoaderCircle className="vox-bank-spin" size={15} /> : <ShieldCheck size={15} />}
              {controller.mutation === 'open' ? 'Opening account…' : 'Open account'}
            </button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="vox-bank-app">
      <header className="vox-bank-header">
        <div><Landmark size={24} /><h1>VOX BANK</h1><span>VOX NET // DIGITAL BANKING</span></div>
        <div className="vox-bank-header__holder">
          <span>ACCOUNT HOLDER</span>
          <strong>{payload.identity.displayName}</strong>
          <small><i /> {networkAuthorityLabel} // VERIFIED</small>
        </div>
      </header>

      <nav className="vox-bank-nav" aria-label="VOX BANK sections">
        <button type="button" aria-current={section === 'overview' ? 'page' : undefined} onClick={() => { setSection('overview'); setTransferError(undefined) }}>Overview</button>
        {allowVltMoves ? <button type="button" aria-current={section === 'move' ? 'page' : undefined} onClick={() => { setSection('move'); setYieldError(undefined) }}>Move vG</button> : null}
        <button type="button" aria-current={section === 'pay' ? 'page' : undefined} onClick={() => { setSection('pay'); setTransferError(undefined); setYieldError(undefined) }}>Pay</button>
        <button type="button" aria-current={section === 'receive' ? 'page' : undefined} onClick={() => { setSection('receive'); setTransferError(undefined); setYieldError(undefined) }}>Receive</button>
        <button type="button" aria-current={section === 'activity' ? 'page' : undefined} onClick={() => { setSection('activity'); setTransferError(undefined); setYieldError(undefined) }}>Activity</button>
        <span data-status={controller.realtimeStatus} aria-live="polite">
          {realtimeLabel(controller.realtimeStatus, controller.refreshing)}
        </span>
      </nav>

      {controller.error ? <div className="vox-bank-refresh-error" role="alert">{controller.error}<button type="button" onClick={() => void controller.retry()}>Retry</button></div> : null}

      {section === 'overview' ? (
        <main className="vox-bank-overview">
          <section className="vox-bank-balance-register">
            <span>AVAILABLE BANK BALANCE</span>
            <strong>{formatNetVoxBankAmount(bank.balanceAmount)}</strong>
            <small>VOX savings · vG only</small>
            <div className="vox-bank-balance-register__actions">
              {allowVltMoves ? <button type="button" className="vox-bank-primary" onClick={() => { setDirection('deposit'); setSection('move') }}><ArrowDownToLine size={15} /> Deposit</button> : null}
              {allowVltMoves ? <button type="button" onClick={() => { setDirection('withdraw'); setSection('move') }}><ArrowUpFromLine size={15} /> Withdraw</button> : null}
              <button type="button" onClick={() => setSection('pay')}><Send size={15} /> Pay</button>
            </div>
          </section>

          <section className="vox-bank-yield-register" data-ready={yieldReady ? 'true' : undefined}>
            <header><TrendingUp size={18} /><span>VOX YIELD</span><small>{yieldRateLabel(bankYield.rateBasisPoints, bankYield.periodSeconds)}</small></header>
            <div className="vox-bank-yield-register__amount">
              <span>NEXT YIELD</span>
              <strong>+{formatNetVoxBankAmount(bankYield.projectedAmount)}</strong>
              <small>{bankYield.projectedAmount < 1
                ? 'The current eligible principal does not produce a whole-vG yield.'
                : yieldReady ? 'READY TO CLAIM' : `Available in ${formatDuration(yieldRemaining)}`}</small>
            </div>
            <button
              type="button"
              className="vox-bank-primary"
              disabled={!yieldReady || controller.mutation !== null}
              onClick={() => void claimYield()}
            >
              {controller.mutation === 'yield' ? <LoaderCircle className="vox-bank-spin" size={14} /> : <TrendingUp size={14} />}
              {controller.mutation === 'yield' ? 'Claiming…' : 'Claim yield'}
            </button>
            {yieldError ? <div className="vox-bank-error" role="alert">{yieldError}</div> : null}
          </section>

          <section className="vox-bank-account-line">
            {allowVltMoves ? <div><span>VLT AVAILABLE</span><strong>{formatNetVoxBankAmount(payload.wallet.balanceAmount)}</strong></div> : null}
            <div><span>YIELD ANCHOR</span><strong>{new Date(bankYield.anchorAt).toLocaleDateString()}</strong></div>
            <div><span>ACCOUNT OPENED</span><strong>{new Date(bank.openedAt).toLocaleDateString()}</strong></div>
          </section>
        </main>
      ) : null}

      {allowVltMoves && section === 'move' ? (
        <main className="vox-bank-move">
          <header><h2>Move vG</h2><p>Transfer principal between your VLT wallet and VOX BANK. Both entries commit together.</p></header>
          <form onSubmit={openTransferReview}>
            <fieldset>
              <legend>DIRECTION</legend>
              <div className="vox-bank-direction">
                <button type="button" aria-pressed={direction === 'deposit'} onClick={() => { setDirection('deposit'); setTransferError(undefined) }}><ArrowDownToLine size={16} /><span><strong>Deposit</strong><small>VLT → VOX BANK</small></span></button>
                <button type="button" aria-pressed={direction === 'withdraw'} onClick={() => { setDirection('withdraw'); setTransferError(undefined) }}><ArrowUpFromLine size={16} /><span><strong>Withdraw</strong><small>VOX BANK → VLT</small></span></button>
              </div>
            </fieldset>
            <div className="vox-bank-route-balance">
              <span>{direction === 'deposit' ? 'VLT AVAILABLE' : 'VOX BANK AVAILABLE'}</span>
              <strong>{formatNetVoxBankAmount(availableSource)}</strong>
            </div>
            <label>
              <span>AMOUNT</span>
              <div className="vox-bank-amount-input"><input autoFocus inputMode="numeric" pattern="[0-9]*" value={amount} placeholder="0" aria-invalid={Boolean(transferError)} aria-describedby={transferError ? 'vox-bank-transfer-error' : 'vox-bank-transfer-help'} onChange={(event) => { setAmount(event.target.value.replace(/[^0-9]/g, '').slice(0, 10)); setTransferError(undefined) }} /><b>vG</b></div>
            </label>
            <small id="vox-bank-transfer-help" className="vox-bank-helper"><Clock3 size={13} /> Deposit or withdrawal restarts the full seven-day yield period.</small>
            {transferError && !review ? <div id="vox-bank-transfer-error" className="vox-bank-error" role="alert">{transferError}</div> : null}
            <button type="submit" className="vox-bank-primary" disabled={!amount || controller.mutation !== null}>Review {direction}<ChevronRight size={14} /></button>
          </form>
        </main>
      ) : null}

      {section === 'activity' ? (
        <main className="vox-bank-ledger">
          <header><div><h2>Account activity</h2><p>Bounded VOX BANK statement · recent first</p></div>{controller.refreshing ? <small><LoaderCircle className="vox-bank-spin" size={12} /> Syncing</small> : null}</header>
          <VoxBankActivityList items={payload.activity.items} />
          {payload.activity.hasMore ? <button type="button" className="vox-bank-load-more" disabled={controller.loadingMore} onClick={() => void controller.loadMore()}>{controller.loadingMore ? <LoaderCircle className="vox-bank-spin" size={13} /> : null}Load older activity</button> : null}
        </main>
      ) : null}

      {section === 'pay' ? (
        <BankPaySurface
          idPrefix="vox-bank"
          institutionName="VOX BANK"
          balanceAmount={bank.balanceAmount}
          maximumAmount={NET_VOX_BANK_MAX_TRANSFER_AMOUNT}
          pending={controller.mutation === 'payment'}
          searchPayees={controller.searchPayees}
          onPay={controller.pay}
          onSuccess={(payee, paidAmount) => {
            onNotice(`VOX BANK // ${formatNetVoxBankAmount(paidAmount)} PAID TO ${payee.displayName.toUpperCase()}`)
            setSection('overview')
          }}
        />
      ) : null}

      {section === 'receive' ? (
        <BankReceiveSurface institutionName="VOX BANK" paymentIdentifier={bank.paymentIdentifier} />
      ) : null}

      {allowVltMoves && review ? <VoxBankConfirmation
        review={review}
        pending={controller.mutation === review.direction}
        error={transferError}
        onCancel={() => { if (!controller.mutation) setReview(null) }}
        onConfirm={() => void confirmTransfer()}
      /> : null}
    </div>
  )
}
