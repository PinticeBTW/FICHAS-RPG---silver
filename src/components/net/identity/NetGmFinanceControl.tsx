import {
  ArrowDownLeft,
  ArrowUpRight,
  Landmark,
  RefreshCw,
  Search,
  ShieldCheck,
  WalletCards,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'

import {
  adjustNetGmFinanceAccount,
  fetchNetGmFinanceDirectory,
  fetchNetGmFinanceIdentity,
} from '../../../lib/netGmFinanceService'
import {
  formatNetGmFinanceAmount,
  NET_GM_FINANCE_MAX_ADJUSTMENT,
  NET_GM_FINANCE_NOTE_MAX_LENGTH,
  type NetGmFinanceAccount,
  type NetGmFinanceAdjustmentAction,
  type NetGmFinanceIdentityPayload,
  type NetGmFinanceIdentitySummary,
} from '../../../lib/netGmFinanceTypes'
import { subscribeToNetEconomyWallet } from '../../../lib/netEconomyRealtimeService'
import { notifySheetEconomyAuthorityChanged } from '../../../lib/sheetEconomyService'
import { SharedMediaImage } from '../../shared/SharedMediaImage'
import '../../../styles/netGmFinanceControl.css'

function initials(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '').join('') || 'ID'
}

function identityDescriptor(identity: NetGmFinanceIdentitySummary) {
  const kind = identity.identityKind === 'npc' ? 'NPC' : 'PLAYER'
  return `${identity.primaryOsId.toUpperCase()} // ${kind}`
}

function accountDescriptor(account: NetGmFinanceAccount) {
  return account.paymentIdentifier
    ? `@${account.paymentIdentifier}`
    : account.currency.currencyCode === 'KARMA'
      ? 'SYSTEM-BOUND KARMA'
      : 'NO PUBLIC IDENTIFIER'
}

export function NetGmFinanceControl() {
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [directory, setDirectory] = useState<readonly NetGmFinanceIdentitySummary[]>([])
  const [directoryLoading, setDirectoryLoading] = useState(false)
  const [directoryError, setDirectoryError] = useState<string>()
  const [selectedIdentityId, setSelectedIdentityId] = useState('')
  const [detail, setDetail] = useState<NetGmFinanceIdentityPayload | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string>()
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [action, setAction] = useState<NetGmFinanceAdjustmentAction>('credit')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [reviewRequestKey, setReviewRequestKey] = useState('')
  const [mutating, setMutating] = useState(false)
  const [notice, setNotice] = useState<string>()
  const directoryGenerationRef = useRef(0)
  const detailGenerationRef = useRef(0)
  const realtimeTimerRef = useRef<number | null>(null)
  const selectedIdentityIdRef = useRef('')
  const mutationPendingRef = useRef(false)

  const selectedAccount = detail?.accounts.find((account) => account.accountId === selectedAccountId)
    ?? detail?.accounts.find((account) => account.status === 'active')
    ?? detail?.accounts[0]

  const loadDirectory = useCallback(async (search: string) => {
    const generation = ++directoryGenerationRef.current
    setDirectoryLoading(true)
    setDirectoryError(undefined)
    try {
      const next = await fetchNetGmFinanceDirectory(search)
      if (generation !== directoryGenerationRef.current) return
      setDirectory(next)
      setSelectedIdentityId((current) => (
        current && next.some((identity) => identity.identityLinkId === current)
          ? current
          : next[0]?.identityLinkId ?? ''
      ))
    } catch (caught) {
      if (generation !== directoryGenerationRef.current) return
      setDirectoryError(caught instanceof Error ? caught.message : 'Finance directory failed.')
      setDirectory([])
      setSelectedIdentityId('')
    } finally {
      if (generation === directoryGenerationRef.current) setDirectoryLoading(false)
    }
  }, [])

  const loadDetail = useCallback(async (identityLinkId: string, quiet = false) => {
    const generation = ++detailGenerationRef.current
    if (!quiet) setDetailLoading(true)
    setDetailError(undefined)
    try {
      const next = await fetchNetGmFinanceIdentity(identityLinkId)
      if (generation !== detailGenerationRef.current || next.identity.identityLinkId !== identityLinkId) return
      setDetail(next)
      setSelectedAccountId((current) => (
        current && next.accounts.some((account) => account.accountId === current)
          ? current
          : next.accounts.find((account) => account.status === 'active')?.accountId
            ?? next.accounts[0]?.accountId
            ?? ''
      ))
    } catch (caught) {
      if (generation !== detailGenerationRef.current) return
      setDetail(null)
      setSelectedAccountId('')
      setDetailError(caught instanceof Error ? caught.message : 'Financial identity failed to load.')
    } finally {
      if (generation === detailGenerationRef.current) setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!expanded) return
    const timer = window.setTimeout(() => {
      void loadDirectory(query.trim())
    }, query.trim() ? 260 : 0)
    return () => window.clearTimeout(timer)
  }, [expanded, loadDirectory, query])

  useEffect(() => {
    selectedIdentityIdRef.current = selectedIdentityId
    detailGenerationRef.current += 1
    setReviewing(false)
    setReviewRequestKey('')
    setNotice(undefined)
    setAmount('')
    setNote('')
    if (!expanded || !selectedIdentityId) {
      setDetail(null)
      setSelectedAccountId('')
      return
    }
    void loadDetail(selectedIdentityId)
  }, [expanded, loadDetail, selectedIdentityId])

  const accountKey = useMemo(() => (
    detail?.accounts.map((account) => account.accountId).sort().join(':') ?? ''
  ), [detail?.accounts])

  useEffect(() => {
    if (!expanded || !selectedIdentityId || !accountKey) return
    const accountIds = new Set(accountKey.split(':'))
    const scheduleRefresh = () => {
      if (realtimeTimerRef.current !== null) window.clearTimeout(realtimeTimerRef.current)
      realtimeTimerRef.current = window.setTimeout(() => {
        realtimeTimerRef.current = null
        void loadDetail(selectedIdentityId, true)
      }, 350)
    }
    const unsubscribe = subscribeToNetEconomyWallet((accountId) => {
      if (accountIds.has(accountId)) scheduleRefresh()
    }, () => undefined)
    return () => {
      if (realtimeTimerRef.current !== null) window.clearTimeout(realtimeTimerRef.current)
      realtimeTimerRef.current = null
      unsubscribe()
    }
  }, [accountKey, expanded, loadDetail, selectedIdentityId])

  useEffect(() => () => {
    directoryGenerationRef.current += 1
    detailGenerationRef.current += 1
  }, [])

  const requestReview = (event: FormEvent) => {
    event.preventDefault()
    const parsedAmount = Number(amount)
    if (!selectedAccount || selectedAccount.status !== 'active') {
      setDetailError('Choose an active customer account.')
      return
    }
    if (!Number.isSafeInteger(parsedAmount) || parsedAmount < 1 || parsedAmount > NET_GM_FINANCE_MAX_ADJUSTMENT) {
      setDetailError(`Enter a whole amount from 1 to ${NET_GM_FINANCE_MAX_ADJUSTMENT}.`)
      return
    }
    if (note.trim().length > NET_GM_FINANCE_NOTE_MAX_LENGTH) {
      setDetailError(`Note must be ${NET_GM_FINANCE_NOTE_MAX_LENGTH} characters or fewer.`)
      return
    }
    setDetailError(undefined)
    setReviewRequestKey(crypto.randomUUID())
    setReviewing(true)
  }

  const confirmAdjustment = async () => {
    if (!detail || !selectedAccount || !reviewing || !reviewRequestKey || mutationPendingRef.current) return
    const parsedAmount = Number(amount)
    mutationPendingRef.current = true
    setMutating(true)
    setDetailError(undefined)
    try {
      const next = await adjustNetGmFinanceAccount({
        identityLinkId: detail.identity.identityLinkId,
        accountId: selectedAccount.accountId,
        action,
        amount: parsedAmount,
        note,
        requestKey: reviewRequestKey,
      })
      if (next.identity.identityLinkId !== selectedIdentityIdRef.current) return
      setDetail(next)
      setAmount('')
      setNote('')
      setReviewing(false)
      setReviewRequestKey('')
      setNotice(`${action === 'credit' ? 'CREDIT' : 'DEBIT'} RECORDED // ${selectedAccount.institutionName}`)
      notifySheetEconomyAuthorityChanged()
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught.message : 'The adjustment was rejected.')
    } finally {
      mutationPendingRef.current = false
      setMutating(false)
    }
  }

  return (
    <section className="net-gm-finance" data-expanded={expanded ? 'true' : 'false'} aria-labelledby="net-gm-finance-title">
      <header>
        <span><Landmark size={17} aria-hidden="true" /></span>
        <div>
          <h3 id="net-gm-finance-title">Finance Control</h3>
          <p>Balanced administrative credit and debit for exact customer accounts.</p>
        </div>
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'CLOSE' : 'OPEN'}
        </button>
      </header>

      {expanded ? (
        <div className="net-gm-finance__workspace">
          <aside className="net-gm-finance__directory">
            <form role="search" onSubmit={(event) => event.preventDefault()}>
              <Search size={14} aria-hidden="true" />
              <input
                value={query}
                maxLength={80}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search identity or payment ID"
                aria-label="Search financial identities"
              />
              <button type="button" disabled={directoryLoading} onClick={() => { void loadDirectory(query.trim()) }} aria-label="Refresh financial identities">
                <RefreshCw size={13} className={directoryLoading ? 'net-gm-finance__spin' : ''} aria-hidden="true" />
              </button>
            </form>
            <div className="net-gm-finance__identity-list" aria-live="polite">
              {directoryError ? <p role="alert">{directoryError}</p> : null}
              {!directoryError && !directoryLoading && !directory.length ? <p>No current financial identities found.</p> : null}
              {directory.map((identity) => {
                const fallback = <span>{initials(identity.displayName)}</span>
                return (
                  <button
                    key={identity.identityLinkId}
                    type="button"
                    aria-current={identity.identityLinkId === selectedIdentityId ? 'true' : undefined}
                    onClick={() => setSelectedIdentityId(identity.identityLinkId)}
                  >
                    <span className="net-gm-finance__avatar">
                      {identity.avatarRef
                        ? <SharedMediaImage source={identity.avatarRef} variant="thumbnail" alt="" loading="lazy" decoding="async" fallback={fallback} errorFallback={fallback} />
                        : fallback}
                    </span>
                    <span>
                      <strong>{identity.displayName}</strong>
                      <small>{identityDescriptor(identity)}</small>
                    </span>
                    <b>{identity.homeCurrency?.currencyCode ?? '—'}</b>
                  </button>
                )
              })}
            </div>
          </aside>

          <main className="net-gm-finance__detail">
            {detailLoading && !detail ? <div className="net-gm-finance__empty"><RefreshCw className="net-gm-finance__spin" /><strong>Loading authoritative funds…</strong></div> : null}
            {!detailLoading && !detail && !detailError ? <div className="net-gm-finance__empty"><WalletCards /><strong>Select a financial identity</strong><span>No account is opened by viewing this directory.</span></div> : null}
            {!detail && detailError ? <div className="net-gm-finance__empty" data-tone="error"><ShieldCheck /><strong>Finance access rejected</strong><span>{detailError}</span></div> : null}
            {detail ? (
              <>
                <header className="net-gm-finance__identity-header">
                  <div>
                    <h4>{detail.identity.displayName}</h4>
                    <span>{detail.identity.primaryOsId.toUpperCase()} // {detail.identity.identityKind.toUpperCase()}</span>
                  </div>
                  <strong>{detail.altaraFundsTotal !== null && detail.identity.homeCurrency
                    ? `FUNDS // ${formatNetGmFinanceAmount(detail.altaraFundsTotal, detail.identity.homeCurrency)}`
                    : detail.identity.homeCurrency?.displayName ?? 'NO HOME CURRENCY'}</strong>
                </header>

                <div className="net-gm-finance__accounts">
                  {!detail.accounts.length ? (
                    <p>No current customer accounts. Open the institution account from the identity’s own app.</p>
                  ) : detail.accounts.map((account) => (
                    <button
                      key={account.accountId}
                      type="button"
                      data-selected={selectedAccount?.accountId === account.accountId ? 'true' : 'false'}
                      data-status={account.status}
                      onClick={() => {
                        setSelectedAccountId(account.accountId)
                        setReviewing(false)
                        setReviewRequestKey('')
                        setNotice(undefined)
                      }}
                    >
                      <span><strong>{account.institutionName}</strong><small>{accountDescriptor(account)}</small></span>
                      <span><b>{formatNetGmFinanceAmount(account.balanceAmount, account.currency)}</b><small>{account.status.toUpperCase()}</small></span>
                    </button>
                  ))}
                </div>

                {selectedAccount ? (
                  <form className="net-gm-finance__adjustment" onSubmit={requestReview}>
                    <div className="net-gm-finance__adjustment-head">
                      <span>ADJUST EXACT ACCOUNT</span>
                      <strong>{selectedAccount.institutionName} // {selectedAccount.currency.currencyCode}</strong>
                    </div>
                    <div className="net-gm-finance__segmented" aria-label="Adjustment direction">
                      <button type="button" aria-pressed={action === 'credit'} onClick={() => { setAction('credit'); setReviewing(false); setReviewRequestKey('') }}>
                        <ArrowDownLeft size={14} /> CREDIT
                      </button>
                      <button type="button" aria-pressed={action === 'debit'} onClick={() => { setAction('debit'); setReviewing(false); setReviewRequestKey('') }}>
                        <ArrowUpRight size={14} /> DEBIT
                      </button>
                    </div>
                    <label>
                      <span>AMOUNT</span>
                      <div><input inputMode="numeric" pattern="[0-9]*" value={amount} onChange={(event) => { setAmount(event.target.value); setReviewing(false); setReviewRequestKey('') }} placeholder="0" /><b>{selectedAccount.currency.currencyCode}</b></div>
                    </label>
                    <label>
                      <span>NOTE <small>OPTIONAL</small></span>
                      <textarea value={note} maxLength={NET_GM_FINANCE_NOTE_MAX_LENGTH} onChange={(event) => { setNote(event.target.value); setReviewing(false); setReviewRequestKey('') }} placeholder="Mission payment, salary, theft…" />
                    </label>
                    {detailError ? <p className="net-gm-finance__error" role="alert">{detailError}</p> : null}
                    {notice ? <p className="net-gm-finance__notice" role="status">{notice}</p> : null}
                    {reviewing ? (
                      <div className="net-gm-finance__review">
                        <p><strong>{action.toUpperCase()} {formatNetGmFinanceAmount(Number(amount), selectedAccount.currency)}</strong> {action === 'credit' ? 'to' : 'from'} {detail.identity.displayName}’s {selectedAccount.institutionName} account?</p>
                        <div><button type="button" onClick={() => { setReviewing(false); setReviewRequestKey('') }}>CANCEL</button><button type="button" disabled={mutating} onClick={() => { void confirmAdjustment() }}>{mutating ? 'RECORDING…' : 'CONFIRM LEDGER ENTRY'}</button></div>
                      </div>
                    ) : (
                      <button className="net-gm-finance__review-button" type="submit" disabled={selectedAccount.status !== 'active'}>REVIEW {action.toUpperCase()}</button>
                    )}
                  </form>
                ) : null}
              </>
            ) : null}
          </main>
        </div>
      ) : null}
    </section>
  )
}
