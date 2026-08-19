import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  Landmark,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  UserCog,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react'
import {
  useEffect,
  useState,
  type FormEvent,
} from 'react'

import {
  NET_ALTARA_BANK_MAX_TRANSFER_AMOUNT,
  NET_ALTARA_BANK_REASON_MAX_LENGTH,
  formatNetAltaraBankAmount,
  isNetAltaraBankError,
  type NetAltaraBankActivity,
  type NetAltaraBankGmMutation,
  type NetAltaraCurrency,
  type NetAltaraCurrencyCode,
  type NetAltaraEconomyConfiguration,
} from '../../../lib/netAltaraBankTypes'
import type { NetBankPayee } from '../../../lib/netBankPaymentTypes'
import {
  fetchNetAltaraEconomyConfiguration,
  setNetAltaraFxRate,
} from '../../../lib/netAltaraBankService'
import type { NetEconomyRealtimeStatus } from '../../../lib/netEconomyRealtimeService'
import { BankPaySurface, BankReceiveSurface } from '../BankPaymentSurface'
import { useNetDialog } from '../netDialogStack'
import { NetAppProfileEditor } from '../profile/NetAppProfileEditor'
import { useNetAppPresentation } from '../profile/useNetAppIdentityPresentation'
import { useNetAltaraBank, useNetAltaraBankGm } from './useNetAltaraBank'

import '../../../styles/altaraBank.css'

export type AltaraBankMode = 'personal' | 'gm-admin'
type AltaraBankSection = 'overview' | 'pay' | 'receive' | 'activity'

interface AltaraBankAppProps {
  readonly mode: AltaraBankMode
  readonly enabled: boolean
  readonly identitySessionKey: string
  readonly expectedIdentityLinkId?: string
  readonly onNotice: (message: string) => void
}

function formatDate(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? 'Unavailable'
    : parsed.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })
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

function AltaraBankProfileAvatar({
  displayName,
  avatarUrl,
}: {
  readonly displayName: string
  readonly avatarUrl?: string
}) {
  const [failedUrl, setFailedUrl] = useState<string>()
  const visibleAvatarUrl = avatarUrl && avatarUrl !== failedUrl
    ? avatarUrl
    : undefined

  return (
    <div className="altara-bank-profile-avatar" aria-hidden="true">
      {visibleAvatarUrl
        ? <img src={visibleAvatarUrl} alt="" onError={() => setFailedUrl(visibleAvatarUrl)} />
        : initials(displayName)}
    </div>
  )
}

function currencyAmountLabel(amount: number, currency: NetAltaraCurrency): string {
  return amount === 1 ? currency.singularLabel : currency.pluralLabel
}

function formatFxEquation(
  currencyA: NetAltaraCurrency,
  unitsA: number,
  currencyB: NetAltaraCurrency,
  unitsB: number,
): string {
  return `${unitsA} ${currencyAmountLabel(unitsA, currencyA)} = ${unitsB} ${currencyAmountLabel(unitsB, currencyB)}`
}

function formatApproximateFxEquation(
  currencyA: NetAltaraCurrency,
  unitsA: number,
  currencyB: NetAltaraCurrency,
  unitsB: number,
): string {
  const ratio = unitsB / unitsA
  const formatted = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 }).format(ratio)
  return `1 ${currencyA.singularLabel} ≈ ${formatted} ${ratio === 1 ? currencyB.singularLabel : currencyB.pluralLabel}`
}

function altaraPayeeContext(payee: NetBankPayee): string | undefined {
  if (!payee.currency) return undefined
  const suffixes = [payee.currency.pluralLabel, payee.currency.singularLabel]
  const city = suffixes.reduce((label, suffix) => (
    label.endsWith(` ${suffix}`) ? label.slice(0, -(suffix.length + 1)) : label
  ), payee.currency.displayName).trim()
  return city
    ? `${city} · ${payee.currency.singularLabel}`
    : payee.currency.singularLabel
}

function realtimeLabel(status: NetEconomyRealtimeStatus, refreshing = false) {
  if (refreshing) return 'Synchronizing'
  if (status === 'subscribed') return 'Account live'
  if (status === 'connecting') return 'Connecting'
  if (status === 'disconnected') return 'Link offline'
  return 'Secure session'
}

function activityLabel(activity: NetAltaraBankActivity) {
  if (activity.transactionKind === 'gm-credit') return 'Authorized bank credit'
  if (activity.transactionKind === 'gm-debit') return 'Authorized bank debit'
  return activity.amount > 0
    ? `Transfer from ${activity.counterpartyDisplayName ?? 'ALTARA customer'}`
    : `Transfer to ${activity.counterpartyDisplayName ?? 'ALTARA customer'}`
}

function AltaraBankActivityList({
  items,
  currency,
}: {
  readonly items: readonly NetAltaraBankActivity[]
  readonly currency: NetAltaraCurrency
}) {
  if (items.length === 0) {
    return (
      <div className="altara-bank-empty">
        <CircleDollarSign size={24} aria-hidden="true" />
        <strong>No account activity yet</strong>
        <span>Authorized transfers and adjustments will appear here.</span>
      </div>
    )
  }

  return (
    <div className="altara-bank-activity-list">
      {items.map((activity) => {
        const incoming = activity.amount > 0
        return (
          <article key={activity.transactionId} className="altara-bank-activity">
            <span data-direction={incoming ? 'incoming' : 'outgoing'}>
              {incoming ? <ArrowDownLeft size={15} aria-hidden="true" /> : <ArrowUpRight size={15} aria-hidden="true" />}
            </span>
            <div>
              <strong>{activityLabel(activity)}</strong>
              {activity.counterpartyPaymentIdentifier ? <small>@{activity.counterpartyPaymentIdentifier}</small> : null}
              {activity.note ? <small>{activity.note}</small> : null}
              {activity.fx ? (
                <small>
                  FX · {activity.fx.sourceAmount} {activity.fx.sourceCurrencyCode}
                  {' → '}{activity.fx.targetAmount} {activity.fx.targetCurrencyCode}
                </small>
              ) : null}
              <time>{new Date(activity.createdAt).toLocaleString()}</time>
            </div>
            <b data-direction={incoming ? 'incoming' : 'outgoing'}>
              {incoming ? '+' : '−'}{formatNetAltaraBankAmount(Math.abs(activity.amount), currency)}
            </b>
          </article>
        )
      })}
    </div>
  )
}

function AltaraBankHeader({
  context,
  holder,
  holderAvatarUrl,
  realtimeStatus,
  refreshing,
  showAppProfile,
  onToggleAppProfile,
}: {
  readonly context: string
  readonly holder: string
  readonly holderAvatarUrl?: string
  readonly realtimeStatus?: NetEconomyRealtimeStatus
  readonly refreshing?: boolean
  readonly showAppProfile?: boolean
  readonly onToggleAppProfile?: () => void
}) {
  return (
    <header className="altara-bank-header">
      <div className="altara-bank-header__brand">
        <span><Landmark size={21} strokeWidth={1.55} aria-hidden="true" /></span>
        <div><p>ALTARA // GLOBAL FINANCIAL NETWORK</p><h1>ALTARA BANK</h1></div>
      </div>
      <div className="altara-bank-header__context" data-profile={onToggleAppProfile ? 'true' : undefined}>
        {onToggleAppProfile ? <AltaraBankProfileAvatar displayName={holder} avatarUrl={holderAvatarUrl} /> : null}
        <div>
          <small>{context}</small>
          <strong>{holder}</strong>
          <span data-status={realtimeStatus}>{realtimeStatus ? realtimeLabel(realtimeStatus, refreshing) : 'Authoritative access'}</span>
        </div>
        {onToggleAppProfile ? (
          <button
            type="button"
            className="altara-bank-profile-toggle"
            aria-label={showAppProfile ? 'Close ALTARA BANK app profile' : 'Edit ALTARA BANK app profile'}
            aria-expanded={showAppProfile}
            onClick={onToggleAppProfile}
          >
            <UserCog size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </header>
  )
}

function AltaraBankPersonal({
  enabled,
  identitySessionKey,
  expectedIdentityLinkId,
  onNotice,
}: {
  readonly enabled: boolean
  readonly identitySessionKey: string
  readonly expectedIdentityLinkId: string
  readonly onNotice: (message: string) => void
}) {
  const controller = useNetAltaraBank(enabled, identitySessionKey, expectedIdentityLinkId)
  const [section, setSection] = useState<AltaraBankSection>('overview')
  const [showAppProfile, setShowAppProfile] = useState(false)
  const payload = controller.payload
  const bank = payload?.bank ?? null
  const presentation = useNetAppPresentation({
    appId: 'altara-bank',
    identityLinkId: expectedIdentityLinkId,
    enabled,
    fallbackDisplayName: payload?.identity.displayName,
  })

  if (controller.status === 'idle' || controller.status === 'loading') {
    return (
      <div className="altara-bank altara-bank-state" role="status" aria-live="polite">
        <LoaderCircle className="altara-bank-spin" size={25} aria-hidden="true" />
        <strong>Establishing private banking session</strong>
        <span>Resolving the authoritative ALTARA identity and account.</span>
      </div>
    )
  }

  if (controller.status === 'error' || !payload) {
    return (
      <div className="altara-bank altara-bank-state" data-tone="error">
        <LockKeyhole size={26} aria-hidden="true" />
        <strong>ALTARA BANK unavailable</strong>
        <span>{controller.error ?? 'The banking service could not be reached.'}</span>
        <button type="button" onClick={() => void controller.retry()}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
      </div>
    )
  }

  if (!bank) {
    if (payload.currencyRequired || !payload.homeCurrency) {
      return (
        <div className="altara-bank altara-bank-state" data-tone="error">
          <LockKeyhole size={26} aria-hidden="true" />
          <strong>Currency assignment required</strong>
          <span>Silver must assign this identity a home currency before ALTARA BANK can open an account.</span>
        </div>
      )
    }
    const holderDisplayName = presentation.displayName
    return (
      <div className="altara-bank altara-bank-onboarding">
        <AltaraBankHeader
          context="PRIVATE CLIENT ENROLMENT"
          holder={holderDisplayName}
          holderAvatarUrl={presentation.avatarUrl}
          showAppProfile={showAppProfile}
          onToggleAppProfile={() => setShowAppProfile((current) => !current)}
        />
        {showAppProfile ? (
          <div className="altara-bank-app-profile">
            <NetAppProfileEditor
              appId="altara-bank"
              appLabel="ALTARA BANK"
              identityLinkId={expectedIdentityLinkId}
              onClose={() => setShowAppProfile(false)}
              onSaved={() => { void presentation.reload() }}
            />
          </div>
        ) : null}
        <main>
          <div className="altara-bank-onboarding__seal"><Landmark size={38} strokeWidth={1.3} aria-hidden="true" /><span>{payload.homeCurrency.currencyCode}</span></div>
          <div>
            <p>ALTARA GLOBAL BANKING</p>
            <h2>Open your personal account</h2>
            <span>One private {payload.homeCurrency.displayName} account for payments across the ALTARA financial network.</span>
            <dl>
              <div><dt>Opening balance</dt><dd>{formatNetAltaraBankAmount(0, payload.homeCurrency)}</dd></div>
              <div><dt>Home currency</dt><dd>{payload.homeCurrency.currencyCode} · {payload.homeCurrency.pluralLabel}</dd></div>
              <div><dt>Network</dt><dd>ALTARA only</dd></div>
            </dl>
            <small>Opening creates no funds and never moves or converts money from another city. Silver manages ledgered credits separately.</small>
            {controller.error ? <p className="altara-bank-inline-error" role="alert">{controller.error}</p> : null}
            <button
              type="button"
              className="altara-bank-primary"
              disabled={controller.mutation === 'open'}
              onClick={() => {
                void controller.openAccount()
                  .then(() => onNotice('ALTARA BANK // ACCOUNT OPENED'))
                  .catch(() => undefined)
              }}
            >
              {controller.mutation === 'open'
                ? <LoaderCircle className="altara-bank-spin" size={15} aria-hidden="true" />
                : <ShieldCheck size={15} aria-hidden="true" />}
              {controller.mutation === 'open' ? 'Opening account…' : 'Open account'}
            </button>
          </div>
        </main>
      </div>
    )
  }

  if (bank.status !== 'active') {
    return (
      <div className="altara-bank altara-bank-state" data-tone="error">
        <LockKeyhole size={26} aria-hidden="true" />
        <strong>Account unavailable</strong>
        <span>This ALTARA BANK account is closed. Payments and account changes are disabled.</span>
      </div>
    )
  }

  const holderDisplayName = presentation.displayName

  return (
    <div className="altara-bank">
      <AltaraBankHeader
        context="PRIVATE ACCOUNT"
        holder={holderDisplayName}
        holderAvatarUrl={presentation.avatarUrl}
        realtimeStatus={controller.realtimeStatus}
        refreshing={controller.refreshing}
        showAppProfile={showAppProfile}
        onToggleAppProfile={() => setShowAppProfile((current) => !current)}
      />
      {showAppProfile ? (
        <div className="altara-bank-app-profile">
          <NetAppProfileEditor
            appId="altara-bank"
            appLabel="ALTARA BANK"
            identityLinkId={expectedIdentityLinkId}
            onClose={() => setShowAppProfile(false)}
            onSaved={() => { void presentation.reload() }}
          />
        </div>
      ) : null}
      <nav className="altara-bank-nav" aria-label="ALTARA BANK sections">
        {(['overview', 'pay', 'receive', 'activity'] as const).map((item) => (
          <button key={item} type="button" aria-current={section === item ? 'page' : undefined} onClick={() => setSection(item)}>
            {item}
          </button>
        ))}
        <span data-status={controller.realtimeStatus}>{realtimeLabel(controller.realtimeStatus, controller.refreshing)}</span>
      </nav>

      {controller.error ? (
        <div className="altara-bank-banner" role="alert">
          <AlertTriangle size={14} aria-hidden="true" /> {controller.error}
          <button type="button" onClick={() => void controller.retry()}>Retry</button>
        </div>
      ) : null}

      {section === 'overview' ? (
        <main className="altara-bank-overview">
          <section className="altara-bank-balance">
            <p>AVAILABLE BALANCE</p>
            <strong>{formatNetAltaraBankAmount(bank.balanceAmount, bank.currency)}</strong>
            <span>{bank.currency.displayName} · No overdraft</span>
            <div>
              <button type="button" className="altara-bank-primary" onClick={() => setSection('pay')}><Send size={15} aria-hidden="true" /> Pay</button>
              <button type="button" onClick={() => setSection('receive')}><WalletCards size={15} aria-hidden="true" /> Receive</button>
            </div>
          </section>
          <aside className="altara-bank-account-register">
            <p>ACCOUNT REGISTER</p>
            <dl>
              <div><dt>Holder</dt><dd>{holderDisplayName}</dd></div>
              <div><dt>Payment ID</dt><dd>@{bank.paymentIdentifier}</dd></div>
              <div><dt>Status</dt><dd><i /> {bank.status.toUpperCase()}</dd></div>
              <div><dt>Opened</dt><dd>{formatDate(bank.openedAt)}</dd></div>
            </dl>
          </aside>
          <section className="altara-bank-recent">
            <header><div><p>RECENT ACTIVITY</p><strong>Authoritative ledger</strong></div><button type="button" onClick={() => setSection('activity')}>View all <ChevronRight size={14} aria-hidden="true" /></button></header>
            <AltaraBankActivityList items={payload.activity.items.slice(0, 4)} currency={bank.currency} />
          </section>
        </main>
      ) : null}

      {section === 'pay' ? (
        <BankPaySurface
          idPrefix="altara-bank"
          institutionName="ALTARA BANK"
          balanceAmount={bank.balanceAmount}
          maximumAmount={NET_ALTARA_BANK_MAX_TRANSFER_AMOUNT}
          currencyLabel={bank.currency.currencyCode}
          currencySingularLabel={bank.currency.singularLabel}
          currencyPluralLabel={bank.currency.pluralLabel}
          showPayeeAvatars
          describePayee={altaraPayeeContext}
          formatQuoteError={(caught, payee) => {
            if (!isNetAltaraBankError(caught) || caught.code !== 'fx-rate-unavailable' || !payee.currency) return undefined
            return `EXCHANGE RATE UNAVAILABLE. Silver must configure a ${bank.currency.currencyCode} ↔ ${payee.currency.currencyCode} rate before this payment can be reviewed.`
          }}
          pending={controller.mutation === 'payment'}
          searchPayees={controller.searchPayees}
          quotePayment={async (input) => {
            const quote = await controller.quotePayment(input)
            return {
              sourceAmount: quote.sourceAmount,
              targetAmount: quote.targetAmount,
              sourceLabel: quote.sourceAmount === 1
                ? quote.sourceCurrency.singularLabel
                : quote.sourceCurrency.pluralLabel,
              targetLabel: quote.targetAmount === 1
                ? quote.targetCurrency.singularLabel
                : quote.targetCurrency.pluralLabel,
              sourceRateLabel: quote.sourceUnits === 1
                ? quote.sourceCurrency.singularLabel
                : quote.sourceCurrency.pluralLabel,
              targetRateLabel: quote.targetUnits === 1
                ? quote.targetCurrency.singularLabel
                : quote.targetCurrency.pluralLabel,
              sourceUnits: quote.sourceUnits,
              targetUnits: quote.targetUnits,
              ...(quote.rateRevision ? { rateRevision: quote.rateRevision } : {}),
              sameCurrency: quote.sameCurrency,
            }
          }}
          onPay={controller.pay}
          onSuccess={(payee, amount) => {
            onNotice(`ALTARA BANK // ${formatNetAltaraBankAmount(amount, bank.currency)} SENT TO ${payee.displayName.toUpperCase()}`)
            setSection('overview')
          }}
        />
      ) : null}

      {section === 'receive' ? <BankReceiveSurface institutionName="ALTARA BANK" paymentIdentifier={bank.paymentIdentifier} currencyLabel={bank.currency.pluralLabel} /> : null}

      {section === 'activity' ? (
        <main className="altara-bank-ledger">
          <header><div><p>ACCOUNT ACTIVITY</p><h2>Private ledger statement</h2></div><small><CalendarDays size={13} aria-hidden="true" /> Newest first</small></header>
          <AltaraBankActivityList items={payload.activity.items} currency={bank.currency} />
          {payload.activity.hasMore ? (
            <button type="button" className="altara-bank-load-more" disabled={controller.loadingMore} onClick={() => void controller.loadMore()}>
              {controller.loadingMore ? <LoaderCircle className="altara-bank-spin" size={14} aria-hidden="true" /> : null}
              {controller.loadingMore ? 'Loading…' : 'Load earlier activity'}
            </button>
          ) : null}
        </main>
      ) : null}
    </div>
  )
}

interface GmAdjustmentReview {
  readonly action: NetAltaraBankGmMutation
  readonly amount: number
  readonly reason: string
  readonly requestKey: string
  readonly currency: NetAltaraCurrency
}

function AltaraBankGmConfirmation({
  customer,
  review,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  readonly customer: string
  readonly review: GmAdjustmentReview
  readonly pending: boolean
  readonly error?: string
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  const { dialogRef, onFocusCapture } = useNetDialog<HTMLDivElement>(onCancel)
  return (
    <div className="altara-bank-dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !pending) onCancel()
    }}>
      <div ref={dialogRef} className="altara-bank-dialog" role="alertdialog" aria-modal="true" aria-labelledby="altara-bank-gm-confirm-title" tabIndex={-1} onFocusCapture={onFocusCapture}>
        <header><ShieldCheck size={17} aria-hidden="true" /><strong id="altara-bank-gm-confirm-title">Authorize bank adjustment</strong><button type="button" aria-label="Close confirmation" disabled={pending} onClick={onCancel}><X size={15} /></button></header>
        <p>{review.action === 'credit' ? 'Credit' : 'Debit'} {formatNetAltaraBankAmount(review.amount, review.currency)} {review.action === 'credit' ? 'to' : 'from'} {customer}?</p>
        <small>{review.reason}</small>
        {error ? <div className="altara-bank-inline-error" role="alert">{error}</div> : null}
        <footer><button type="button" data-net-dialog-initial-focus disabled={pending} onClick={onCancel}>Cancel</button><button type="button" className="altara-bank-primary" disabled={pending} onClick={onConfirm}>{pending ? <LoaderCircle className="altara-bank-spin" size={14} /> : <Check size={14} />}{pending ? 'Authorizing…' : `Authorize ${review.action}`}</button></footer>
      </div>
    </div>
  )
}

/**
 * GM currency/exchange-rate editor. Rendered from GM SYSTEM Settings
 * (src/components/net/altara/AltaraAppSurfaces.tsx), not from ALTARA BANK --
 * exported so that surface can reuse this exact implementation instead of a
 * second one. ALTARA BANK's own admin view no longer renders it.
 */
export function AltaraFxAdmin({ enabled }: { readonly enabled: boolean }) {
  const [configuration, setConfiguration] = useState<NetAltaraEconomyConfiguration>()
  const [currencyA, setCurrencyA] = useState<NetAltaraCurrencyCode>('FINIT')
  const [currencyB, setCurrencyB] = useState<NetAltaraCurrencyCode>('SECTUS')
  const [unitsA, setUnitsA] = useState('')
  const [unitsB, setUnitsB] = useState('')
  const [rateActive, setRateActive] = useState(true)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const [loadVersion, setLoadVersion] = useState(0)
  const [review, setReview] = useState<{
    readonly currencyA: NetAltaraCurrencyCode
    readonly currencyB: NetAltaraCurrencyCode
    readonly unitsA: number
    readonly unitsB: number
    readonly active: boolean
    readonly reason: string
  }>()
  const { dialogRef, onFocusCapture } = useNetDialog<HTMLDivElement>(() => {
    if (!pending) setReview(undefined)
  })

  useEffect(() => {
    if (!enabled) return
    let active = true
    setError(undefined)
    void fetchNetAltaraEconomyConfiguration()
      .then((next) => { if (active) setConfiguration(next) })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Unable to load exchange rates.') })
    return () => { active = false }
  }, [enabled, loadVersion])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const parsedA = Number(unitsA)
    const parsedB = Number(unitsB)
    if (currencyA === currencyB || !Number.isSafeInteger(parsedA) || parsedA < 1 || !Number.isSafeInteger(parsedB) || parsedB < 1 || !reason.trim()) {
      setError('Choose two currencies, positive whole-unit ratios, and an audit reason.')
      return
    }
    setError(undefined)
    setReview({
      currencyA,
      currencyB,
      unitsA: parsedA,
      unitsB: parsedB,
      active: rateActive,
      reason: reason.trim(),
    })
  }

  const confirm = async () => {
    if (!review || pending) return
    setPending(true)
    setError(undefined)
    try {
      const next = await setNetAltaraFxRate(review)
      setConfiguration(next)
      setUnitsA('')
      setUnitsB('')
      setReason('')
      setReview(undefined)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save the exchange rate.')
    } finally {
      setPending(false)
    }
  }

  const activeCurrencies = configuration?.currencies.filter((currency) => currency.status === 'active') ?? []
  const selectedCurrencyA = activeCurrencies.find((currency) => currency.currencyCode === currencyA)
  const selectedCurrencyB = activeCurrencies.find((currency) => currency.currencyCode === currencyB)
  const previewUnitsA = Number(unitsA)
  const previewUnitsB = Number(unitsB)
  const hasPreview = Boolean(
    selectedCurrencyA
    && selectedCurrencyB
    && currencyA !== currencyB
    && Number.isSafeInteger(previewUnitsA)
    && previewUnitsA > 0
    && Number.isSafeInteger(previewUnitsB)
    && previewUnitsB > 0,
  )
  const reviewCurrencyA = review
    ? configuration?.currencies.find((currency) => currency.currencyCode === review.currencyA)
    : undefined
  const reviewCurrencyB = review
    ? configuration?.currencies.find((currency) => currency.currencyCode === review.currencyB)
    : undefined

  return (
    <section className="altara-bank-fx-admin" aria-labelledby="altara-bank-fx-title">
      <header><strong id="altara-bank-fx-title">Exchange rate</strong><small>Exact manual ratio</small></header>
      <div className="altara-bank-fx-admin__rates">
        {configuration?.fxRates.length
          ? configuration.fxRates.map((rate) => {
              const rateCurrencyA = configuration.currencies.find((currency) => currency.currencyCode === rate.currencyA)
              const rateCurrencyB = configuration.currencies.find((currency) => currency.currencyCode === rate.currencyB)
              if (!rateCurrencyA || !rateCurrencyB) return null
              return (
                <article key={`${rate.currencyA}:${rate.currencyB}`} data-active={rate.active}>
                  <span>{rate.active ? 'ACTIVE' : 'DISABLED'}</span>
                  <strong>{formatFxEquation(rateCurrencyA, rate.unitsA, rateCurrencyB, rate.unitsB)}</strong>
                  <small>{formatApproximateFxEquation(rateCurrencyA, rate.unitsA, rateCurrencyB, rate.unitsB)}</small>
                </article>
              )
            })
          : <p>No exchange rate configured. Cross-currency payments remain unavailable.</p>}
      </div>
      <form onSubmit={(event) => { void submit(event) }}>
        <div className="altara-bank-fx-admin__equation">
          <label>
            <span>{currencyA} AMOUNT</span>
            <select aria-label="Source currency" value={currencyA} disabled={!configuration || pending} onChange={(event) => setCurrencyA(event.target.value as NetAltaraCurrencyCode)}>{activeCurrencies.map((currency) => <option key={currency.currencyCode} value={currency.currencyCode}>{currency.currencyCode} — {currency.pluralLabel}</option>)}</select>
            <input aria-label={`${currencyA} amount`} inputMode="numeric" disabled={!configuration || pending} value={unitsA} onChange={(event) => setUnitsA(event.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="5" />
          </label>
          <b aria-hidden="true">=</b>
          <label>
            <span>{currencyB} AMOUNT</span>
            <select aria-label="Target currency" value={currencyB} disabled={!configuration || pending} onChange={(event) => setCurrencyB(event.target.value as NetAltaraCurrencyCode)}>{activeCurrencies.map((currency) => <option key={currency.currencyCode} value={currency.currencyCode}>{currency.currencyCode} — {currency.pluralLabel}</option>)}</select>
            <input aria-label={`${currencyB} amount`} inputMode="numeric" disabled={!configuration || pending} value={unitsB} onChange={(event) => setUnitsB(event.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="12" />
          </label>
        </div>
        {hasPreview && selectedCurrencyA && selectedCurrencyB ? (
          <div className="altara-bank-fx-admin__preview" role="status">
            <strong>{formatFxEquation(selectedCurrencyA, previewUnitsA, selectedCurrencyB, previewUnitsB)}</strong>
            <span>Equivalent: {formatApproximateFxEquation(selectedCurrencyA, previewUnitsA, selectedCurrencyB, previewUnitsB)}</span>
          </div>
        ) : null}
        <label className="altara-bank-fx-admin__field"><span>RATE STATUS</span><select value={rateActive ? 'active' : 'inactive'} disabled={!configuration || pending} onChange={(event) => setRateActive(event.target.value === 'active')}><option value="active">ACTIVE — available for new quotes</option><option value="inactive">DISABLED — no new quotes</option></select></label>
        <label className="altara-bank-fx-admin__field"><span>AUDIT REASON</span><textarea aria-label="Exchange-rate audit reason" maxLength={NET_ALTARA_BANK_REASON_MAX_LENGTH} disabled={!configuration || pending} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this exact ratio changing?" /></label>
        {error ? <p className="altara-bank-inline-error" role="alert">{error} {!configuration ? <button type="button" onClick={() => setLoadVersion((version) => version + 1)}>Retry</button> : null}</p> : null}
        <button type="submit" disabled={!configuration || pending || !unitsA || !unitsB || !reason.trim()}><ShieldCheck size={14} /> Review rate</button>
      </form>
      {review ? (
        <div className="bank-payment-dialog-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !pending) setReview(undefined)
        }}>
          <div ref={dialogRef} className="bank-payment-dialog" role="alertdialog" aria-modal="true" aria-labelledby="altara-bank-fx-confirm-title" tabIndex={-1} onFocusCapture={onFocusCapture}>
            <header><span><ShieldCheck size={16} /></span><strong id="altara-bank-fx-confirm-title">Set exchange rate?</strong><button type="button" aria-label="Close confirmation" disabled={pending} onClick={() => setReview(undefined)}><X size={15} /></button></header>
            <p>{reviewCurrencyA && reviewCurrencyB ? formatFxEquation(reviewCurrencyA, review.unitsA, reviewCurrencyB, review.unitsB) : `${review.unitsA} ${review.currencyA} = ${review.unitsB} ${review.currencyB}`}</p>
            {reviewCurrencyA && reviewCurrencyB ? <small>Equivalent: {formatApproximateFxEquation(reviewCurrencyA, review.unitsA, reviewCurrencyB, review.unitsB)}</small> : null}
            <small>{review.active ? 'This rate will apply to new ALTARA BANK FX quotes.' : 'This rate will be disabled for new ALTARA BANK FX quotes.'} Existing FX operations retain their original exact ratio.</small>
            <small>{review.reason}</small>
            {error ? <div className="bank-payment-error" role="alert">{error}</div> : null}
            <footer><button type="button" data-net-dialog-initial-focus disabled={pending} onClick={() => setReview(undefined)}>Cancel</button><button type="button" className="bank-payment-primary" disabled={pending} onClick={() => { void confirm() }}>{pending ? <LoaderCircle className="altara-bank-spin" size={14} /> : <Check size={14} />}{pending ? 'Authorizing…' : 'Confirm rate'}</button></footer>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function AltaraBankGmAdmin({ enabled, onNotice }: { readonly enabled: boolean; readonly onNotice: (message: string) => void }) {
  const controller = useNetAltaraBankGm(enabled, 'gm-system')
  const [query, setQuery] = useState('')
  const [action, setAction] = useState<NetAltaraBankGmMutation>('credit')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [review, setReview] = useState<GmAdjustmentReview | null>(null)
  const [reviewError, setReviewError] = useState<string>()
  const detail = controller.selected
  const selectedId = controller.selectedPaymentIdentifier
  const mutationPending = controller.mutation !== null

  const searchDirectory = (event: FormEvent) => {
    event.preventDefault()
    void controller.search(query.trim())
  }

  const prepareAdjustment = (event: FormEvent) => {
    event.preventDefault()
    const parsed = Number(amount)
    if (!detail?.bank || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > NET_ALTARA_BANK_MAX_TRANSFER_AMOUNT) {
      setReviewError('Enter a valid whole-unit amount.')
      return
    }
    if (action === 'debit' && parsed > detail.bank.balanceAmount) {
      setReviewError(`This account does not have enough ${detail.bank.currency.pluralLabel} for that debit.`)
      return
    }
    const normalizedReason = reason.trim()
    if (!normalizedReason || normalizedReason.length > NET_ALTARA_BANK_REASON_MAX_LENGTH) {
      setReviewError(`A reason of 1–${NET_ALTARA_BANK_REASON_MAX_LENGTH} characters is required.`)
      return
    }
    setReview({ action, amount: parsed, reason: normalizedReason, requestKey: crypto.randomUUID(), currency: detail.bank.currency })
    setReviewError(undefined)
  }

  const confirmAdjustment = async () => {
    if (!review || !selectedId || !detail) return
    setReviewError(undefined)
    try {
      await controller.adjust(review)
      onNotice(`ALTARA BANK ADMIN // ${review.action.toUpperCase()} COMPLETE`)
      setReview(null)
      setAmount('')
      setReason('')
    } catch (caught) {
      setReviewError(caught instanceof Error ? caught.message : 'ALTARA BANK adjustment failed.')
    }
  }

  return (
    <div className="altara-bank altara-bank-gm">
      <AltaraBankHeader context="ADMINISTRATION MODE" holder="GM SYSTEM" realtimeStatus={controller.realtimeStatus} refreshing={controller.refreshing} />
      <main className="altara-bank-gm__grid">
        <aside className="altara-bank-directory">
          <header><p>CUSTOMERS</p><strong>{controller.directory.length} bounded results</strong></header>
          <form onSubmit={searchDirectory}><Search size={14} aria-hidden="true" /><input type="search" value={query} maxLength={80} placeholder="Name or ALTARA BANK ID" aria-label="Search ALTARA BANK customers" onChange={(event) => setQuery(event.target.value)} /><button type="submit" disabled={controller.status === 'loading'}>{controller.status === 'loading' ? <LoaderCircle className="altara-bank-spin" size={14} /> : 'Search'}</button></form>
          {controller.error ? <p className="altara-bank-inline-error" role="alert">{controller.error}<button type="button" onClick={() => void controller.retryDirectory()}>Retry</button></p> : null}
          <div className="altara-bank-directory__list">
            {controller.status === 'loading' && controller.directory.length === 0 ? <p><LoaderCircle className="altara-bank-spin" size={14} /> Loading customers…</p> : null}
            {controller.status === 'ready' && controller.directory.length === 0 ? <p>No matching ALTARA BANK customer.</p> : null}
            {controller.directory.map((customer) => (
              <button key={customer.paymentIdentifier} type="button" disabled={mutationPending} aria-current={selectedId === customer.paymentIdentifier ? 'true' : undefined} onClick={() => { controller.select(customer.paymentIdentifier); setReviewError(undefined) }}>
                <UserRound size={15} aria-hidden="true" /><span><strong>{customer.displayName}</strong><small>@{customer.paymentIdentifier} · {customer.currency.currencyCode}</small></span><b>{formatNetAltaraBankAmount(customer.balanceAmount, customer.currency)}</b>
              </button>
            ))}
          </div>
        </aside>

        {!selectedId ? (
          <section className="altara-bank-gm__empty"><Building2 size={28} aria-hidden="true" /><strong>Select an ALTARA BANK customer</strong><span>Review a bounded statement or authorize a ledgered credit or debit.</span></section>
        ) : controller.detailStatus === 'loading' && !detail ? (
          <section className="altara-bank-gm__empty"><LoaderCircle className="altara-bank-spin" size={25} aria-hidden="true" /><strong>Loading authoritative account</strong></section>
        ) : detail?.bank ? (
          <section className="altara-bank-gm__detail">
            <header><div><p>SELECTED CUSTOMER</p><h2>{detail.identity.displayName}</h2><small>@{detail.bank.paymentIdentifier} · {detail.bank.currency.currencyCode}</small></div><strong>{formatNetAltaraBankAmount(detail.bank.balanceAmount, detail.bank.currency)}</strong></header>
            {controller.detailError ? <p className="altara-bank-inline-error" role="alert">{controller.detailError}</p> : null}
            <div className="altara-bank-gm__body">
              {detail.bank.status === 'active' ? (
                <form onSubmit={prepareAdjustment}>
                  <p>LEDGER ADJUSTMENT</p>
                  <div className="altara-bank-segmented"><button type="button" aria-pressed={action === 'credit'} onClick={() => setAction('credit')}>Credit</button><button type="button" aria-pressed={action === 'debit'} onClick={() => setAction('debit')}>Debit</button></div>
                  <label><span>AMOUNT</span><div><input inputMode="numeric" pattern="[0-9]*" value={amount} placeholder="0" onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, '').slice(0, 10))} /><b>{detail.bank.currency.currencyCode}</b></div></label>
                  <label><span>REASON</span><textarea value={reason} maxLength={NET_ALTARA_BANK_REASON_MAX_LENGTH} placeholder="Mandatory audit reason" onChange={(event) => setReason(event.target.value)} /><small>{reason.length}/{NET_ALTARA_BANK_REASON_MAX_LENGTH}</small></label>
                  <button type="submit" className="altara-bank-primary" disabled={!amount || !reason.trim() || mutationPending}><ShieldCheck size={14} aria-hidden="true" /> Review {action}</button>
                </form>
              ) : (
                <div className="altara-bank-gm__closed" role="status">
                  <LockKeyhole size={24} aria-hidden="true" />
                  <strong>Account closed</strong>
                  <span>History remains available, but ledger adjustments are disabled.</span>
                </div>
              )}
              <div className="altara-bank-gm__ledger"><header><p>ACCOUNT HISTORY</p><span>Newest first</span></header><AltaraBankActivityList items={detail.activity.items} currency={detail.bank.currency} />{detail.activity.hasMore ? <button type="button" className="altara-bank-load-more" disabled={controller.loadingMore} onClick={() => void controller.loadMore()}>{controller.loadingMore ? 'Loading…' : 'Load earlier activity'}</button> : null}</div>
            </div>
          </section>
        ) : (
          <section className="altara-bank-gm__empty" data-tone="error"><AlertTriangle size={26} aria-hidden="true" /><strong>Account unavailable</strong><span>{controller.detailError ?? 'The selected ALTARA BANK account could not be loaded.'}</span><button type="button" onClick={() => void controller.retrySelected()}>Retry</button></section>
        )}
      </main>
      {review && detail ? <AltaraBankGmConfirmation customer={detail.identity.displayName} review={review} pending={mutationPending} error={reviewError} onCancel={() => { if (!mutationPending) setReview(null) }} onConfirm={() => void confirmAdjustment()} /> : null}
    </div>
  )
}

export function AltaraBankApp({
  mode,
  enabled,
  identitySessionKey,
  expectedIdentityLinkId,
  onNotice,
}: AltaraBankAppProps) {
  if (mode === 'gm-admin') return <AltaraBankGmAdmin enabled={enabled} onNotice={onNotice} />
  if (!expectedIdentityLinkId) {
    return (
      <div className="altara-bank altara-bank-state" data-tone="error">
        <AlertTriangle size={26} aria-hidden="true" />
        <strong>Financial identity unavailable</strong>
        <span>Reopen ALTARA BANK after the authoritative identity finishes resolving.</span>
      </div>
    )
  }
  return <AltaraBankPersonal enabled={enabled} identitySessionKey={identitySessionKey} expectedIdentityLinkId={expectedIdentityLinkId} onNotice={onNotice} />
}
