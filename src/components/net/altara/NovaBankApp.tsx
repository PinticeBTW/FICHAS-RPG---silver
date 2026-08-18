import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Building,
  Check,
  ChevronRight,
  CircleDollarSign,
  Copy,
  CreditCard,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Send,
  ShieldCheck,
  UserRound,
  WalletCards,
} from 'lucide-react'
import { useState } from 'react'

import {
  NET_NOVA_BANK_MAX_TRANSFER_AMOUNT,
  NET_NOVA_BANK_NOTE_MAX_LENGTH,
  formatNetNovaBankAmount,
  isNetNovaBankError,
  type NetNovaBankActivity,
  type NetNovaCurrency,
} from '../../../lib/netNovaBankTypes'
import type { NetBankPayee } from '../../../lib/netBankPaymentTypes'
import type { NetEconomyRealtimeStatus } from '../../../lib/netEconomyRealtimeService'
import { BankPaySurface } from '../BankPaymentSurface'
import { useNetNovaBank } from './useNetNovaBank'

import '../../../styles/novaBank.css'

type NovaBankSection = 'overview' | 'pay' | 'activity' | 'account'

interface NovaBankAppProps {
  readonly enabled: boolean
  readonly identitySessionKey: string
  readonly expectedIdentityLinkId?: string
  readonly onNotice: (message: string) => void
}

function formatDate(value: string, includeTime = false) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Unavailable'
  return includeTime
    ? parsed.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : parsed.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })
}

function realtimeLabel(status: NetEconomyRealtimeStatus, refreshing: boolean) {
  if (refreshing) return 'Syncing'
  if (status === 'subscribed') return 'Live'
  if (status === 'connecting') return 'Connecting'
  if (status === 'disconnected') return 'Offline'
  return 'Secure'
}

function activityTitle(activity: NetNovaBankActivity) {
  if (activity.transactionKind === 'gm-credit') return 'Authorized bank credit'
  if (activity.transactionKind === 'gm-debit') return 'Authorized bank debit'
  if (activity.amount > 0) return `From ${activity.counterpartyDisplayName ?? 'NOVA customer'}`
  return `To ${activity.counterpartyDisplayName ?? 'NOVA customer'}`
}

function ActivityList({ items, currency }: {
  readonly items: readonly NetNovaBankActivity[]
  readonly currency: NetNovaCurrency
}) {
  if (!items.length) {
    return (
      <div className="nova-bank-empty">
        <Activity size={22} aria-hidden="true" />
        <strong>No activity yet</strong>
        <span>Your completed NOVA payments will appear here.</span>
      </div>
    )
  }

  return (
    <div className="nova-bank-activity-list">
      {items.map((activity) => {
        const incoming = activity.amount > 0
        return (
          <article key={activity.transactionId} className="nova-bank-activity">
            <span data-direction={incoming ? 'incoming' : 'outgoing'}>
              {incoming ? <ArrowDownLeft size={16} aria-hidden="true" /> : <ArrowUpRight size={16} aria-hidden="true" />}
            </span>
            <div>
              <strong>{activityTitle(activity)}</strong>
              {activity.note ? <small>{activity.note}</small> : null}
              <time>{formatDate(activity.createdAt, true)}</time>
            </div>
            <div className="nova-bank-activity__amount">
              <b data-direction={incoming ? 'incoming' : 'outgoing'}>
                {incoming ? '+' : '−'}{formatNetNovaBankAmount(Math.abs(activity.amount), currency)}
              </b>
              {activity.fx ? <small>FX · {activity.fx.sourceCurrencyCode} → {activity.fx.targetCurrencyCode}</small> : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}

function payeeContext(payee: NetBankPayee) {
  return payee.currency
    ? `@${payee.paymentIdentifier} · ${payee.currency.currencyCode}`
    : `@${payee.paymentIdentifier}`
}

export function NovaBankApp({
  enabled,
  identitySessionKey,
  expectedIdentityLinkId,
  onNotice,
}: NovaBankAppProps) {
  const controller = useNetNovaBank(
    enabled && Boolean(expectedIdentityLinkId),
    identitySessionKey,
    expectedIdentityLinkId ?? null,
  )
  const [section, setSection] = useState<NovaBankSection>('overview')
  const [copied, setCopied] = useState(false)

  if (!expectedIdentityLinkId) {
    return (
      <div className="nova-bank nova-bank-state" data-tone="error">
        <LockKeyhole size={26} aria-hidden="true" />
        <strong>No personal banking identity</strong>
        <span>GM System cannot own a NOVA account. Take control of an eligible ALTARA identity to continue.</span>
      </div>
    )
  }

  if (controller.status === 'idle' || controller.status === 'loading') {
    return (
      <div className="nova-bank nova-bank-state" role="status" aria-live="polite">
        <LoaderCircle className="nova-bank-spin" size={25} aria-hidden="true" />
        <strong>Opening your private NOVA session</strong>
        <span>Confirming the active ALTARA identity and institution access.</span>
      </div>
    )
  }

  if (controller.status === 'error' || !controller.payload) {
    return (
      <div className="nova-bank nova-bank-state" data-tone="error">
        <AlertTriangle size={26} aria-hidden="true" />
        <strong>NOVA BANK unavailable</strong>
        <span>{controller.error ?? 'The banking service could not be reached.'}</span>
        <button type="button" onClick={() => void controller.retry()}><RefreshCw size={14} /> Try again</button>
      </div>
    )
  }

  const payload = controller.payload
  const bank = payload.bank

  if (!bank) {
    if (payload.currencyRequired || !payload.homeCurrency) {
      return (
        <div className="nova-bank nova-bank-state" data-tone="error">
          <CircleDollarSign size={26} aria-hidden="true" />
          <strong>Home currency required</strong>
          <span>Silver must assign this identity FINIT or SECTUS before a NOVA account can be opened.</span>
        </div>
      )
    }
    return (
      <div className="nova-bank nova-bank-onboarding">
        <div className="nova-bank-onboarding__mark"><Building size={28} aria-hidden="true" /></div>
        <main>
          <div>
            <span>NOVA FINANCIAL</span>
            <h1>Banking, opened on your terms.</h1>
            <p>A separate {payload.homeCurrency.displayName} account for direct NOVA payments across the ALTARA network.</p>
          </div>
          <dl>
            <div><dt>Account holder</dt><dd>{payload.identity.displayName}</dd></div>
            <div><dt>Opening balance</dt><dd>{formatNetNovaBankAmount(0, payload.homeCurrency)}</dd></div>
            <div><dt>Home currency</dt><dd>{payload.homeCurrency.currencyCode}</dd></div>
          </dl>
          <p className="nova-bank-onboarding__disclosure"><ShieldCheck size={14} /> Opening creates no funds and never copies an ALTARA BANK balance.</p>
          {controller.error ? <p className="nova-bank-error" role="alert">{controller.error}</p> : null}
          <button type="button" className="nova-bank-primary" disabled={controller.mutation === 'open'} onClick={() => {
            void controller.openAccount()
              .then(() => onNotice('NOVA BANK // ACCOUNT OPEN'))
              .catch(() => undefined)
          }}>
            {controller.mutation === 'open' ? <LoaderCircle className="nova-bank-spin" size={15} /> : <CreditCard size={15} />}
            {controller.mutation === 'open' ? 'Opening account…' : 'Open NOVA account'}
          </button>
        </main>
      </div>
    )
  }

  const copyPaymentId = async () => {
    try {
      await navigator.clipboard.writeText(`@${bank.paymentIdentifier}`)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="nova-bank">
      <aside className="nova-bank-sidebar">
        <header>
          <span><Building size={20} strokeWidth={1.7} aria-hidden="true" /></span>
          <div><strong>NOVA</strong><small>BANK</small></div>
        </header>
        <nav aria-label="NOVA BANK sections">
          {([
            ['overview', WalletCards, 'Overview'],
            ['pay', Send, 'Pay'],
            ['activity', Activity, 'Activity'],
            ['account', UserRound, 'Account'],
          ] as const).map(([id, Icon, label]) => (
            <button key={id} type="button" aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>
              <Icon size={17} aria-hidden="true" /><span>{label}</span>
            </button>
          ))}
        </nav>
        <footer>
          <span data-status={controller.realtimeStatus} />
          <div><strong>{realtimeLabel(controller.realtimeStatus, controller.refreshing)}</strong><small>Encrypted session</small></div>
        </footer>
      </aside>

      <section className="nova-bank-workspace">
        <header className="nova-bank-topbar">
          <div><strong>{section}</strong><span>{payload.identity.displayName}</span></div>
          <small>{bank.currency.displayName}</small>
        </header>

        {controller.error ? (
          <div className="nova-bank-error" role="alert"><AlertTriangle size={14} /> {controller.error}<button type="button" onClick={() => void controller.retry()}>Retry</button></div>
        ) : null}

        {section === 'overview' ? (
          <main className="nova-bank-overview">
            <section className="nova-bank-balance-card">
              <div className="nova-bank-balance-card__brand"><span>N</span><small>NOVA BANK</small></div>
              <p>Available balance</p>
              <strong>{formatNetNovaBankAmount(bank.balanceAmount, bank.currency)}</strong>
              <div><span>{payload.identity.displayName}</span><span>{bank.currencyCode}</span></div>
              <button type="button" onClick={() => setSection('pay')}><Send size={16} /> Make a payment</button>
            </section>
            <section className="nova-bank-overview__account">
              <span>Personal account</span>
              <strong>@{bank.paymentIdentifier}</strong>
              <small>Active since {formatDate(bank.openedAt)}</small>
              <button type="button" onClick={() => void copyPaymentId()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy payment ID'}</button>
            </section>
            <section className="nova-bank-overview__recent">
              <header><div><h2>Recent activity</h2><p>Your latest NOVA account movements.</p></div><button type="button" onClick={() => setSection('activity')}>View all <ChevronRight size={14} /></button></header>
              <ActivityList items={payload.activity.items.slice(0, 5)} currency={bank.currency} />
            </section>
          </main>
        ) : null}

        {section === 'pay' ? (
          <BankPaySurface
            idPrefix="nova-bank"
            institutionName="NOVA BANK"
            balanceAmount={bank.balanceAmount}
            maximumAmount={NET_NOVA_BANK_MAX_TRANSFER_AMOUNT}
            currencyLabel={bank.currency.currencyCode}
            currencySingularLabel={bank.currency.singularLabel}
            currencyPluralLabel={bank.currency.pluralLabel}
            noteMaxLength={NET_NOVA_BANK_NOTE_MAX_LENGTH}
            showPayeeAvatars
            describePayee={payeeContext}
            formatQuoteError={(caught, payee) => {
              if (!isNetNovaBankError(caught) || caught.code !== 'fx-rate-unavailable' || !payee.currency) return undefined
              return `No active ${bank.currencyCode} ↔ ${payee.currency.currencyCode} rate is available. Try again after Silver updates the economy rate.`
            }}
            pending={controller.mutation === 'payment'}
            searchPayees={controller.searchPayees}
            quotePayment={async (input) => {
              const quote = await controller.quotePayment(input)
              return {
                sourceAmount: quote.sourceAmount,
                targetAmount: quote.targetAmount,
                sourceLabel: quote.sourceAmount === 1 ? quote.sourceCurrency.singularLabel : quote.sourceCurrency.pluralLabel,
                targetLabel: quote.targetAmount === 1 ? quote.targetCurrency.singularLabel : quote.targetCurrency.pluralLabel,
                sourceRateLabel: quote.sourceUnits === 1 ? quote.sourceCurrency.singularLabel : quote.sourceCurrency.pluralLabel,
                targetRateLabel: quote.targetUnits === 1 ? quote.targetCurrency.singularLabel : quote.targetCurrency.pluralLabel,
                sourceUnits: quote.sourceUnits,
                targetUnits: quote.targetUnits,
                ...(quote.rateRevision ? { rateRevision: quote.rateRevision } : {}),
                sameCurrency: quote.sameCurrency,
              }
            }}
            onPay={controller.pay}
            onSuccess={(payee, amount) => {
              onNotice(`NOVA BANK // ${formatNetNovaBankAmount(amount, bank.currency)} SENT TO ${payee.displayName.toUpperCase()}`)
              setSection('overview')
            }}
          />
        ) : null}

        {section === 'activity' ? (
          <main className="nova-bank-ledger">
            <header><div><h1>Account activity</h1><p>Completed NOVA payments, newest first.</p></div><span><ShieldCheck size={14} /> Authoritative ledger</span></header>
            <ActivityList items={payload.activity.items} currency={bank.currency} />
            {payload.activity.hasMore ? <button type="button" className="nova-bank-load-more" disabled={controller.loadingMore} onClick={() => void controller.loadMore()}>{controller.loadingMore ? <LoaderCircle className="nova-bank-spin" size={14} /> : null}{controller.loadingMore ? 'Loading…' : 'Load earlier activity'}</button> : null}
          </main>
        ) : null}

        {section === 'account' ? (
          <main className="nova-bank-account">
            <header><h1>Your NOVA account</h1><p>Details for receiving same-bank payments. Private account UUIDs never leave this session.</p></header>
            <dl>
              <div><dt>Account holder</dt><dd>{payload.identity.displayName}</dd></div>
              <div><dt>Payment identifier</dt><dd>@{bank.paymentIdentifier}<button type="button" onClick={() => void copyPaymentId()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy'}</button></dd></div>
              <div><dt>Currency</dt><dd>{bank.currency.displayName} · {bank.currencyCode}</dd></div>
              <div><dt>Status</dt><dd><i /> {bank.status.toUpperCase()}</dd></div>
              <div><dt>Opened</dt><dd>{formatDate(bank.openedAt)}</dd></div>
              <div><dt>Institution</dt><dd>NOVA FINANCIAL</dd></div>
            </dl>
          </main>
        ) : null}
      </section>
    </div>
  )
}
