import { KeyRound, ShieldCheck, Unlock } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  attemptNetSystemCredentialAccess,
  clearNetSystemCredential,
  fetchNetSystemCredentialStatus,
  fetchNetSystemHackingRollAttempt,
  fetchNetSystemHackingTargets,
  requestNetSystemHackingRollAttempt,
  setNetSystemCredential,
  type NetSystemCredentialStatus,
  type NetSystemHackingRollAttemptState,
  type NetSystemHackingTarget,
} from '../../../lib/netSystemHackingService'
import { getNetOsLabel, type NetOsId } from '../../../lib/netOsTypes'
import { useNetSystemHackingRuntime } from '../system/useNetSystemHackingRuntime'

type CredentialLoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly credential: NetSystemCredentialStatus }
  | { readonly status: 'error'; readonly reason: string }

type TargetsLoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly targets: readonly NetSystemHackingTarget[] }
  | { readonly status: 'error'; readonly reason: string }

type RollAttemptLoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly attempt: NetSystemHackingRollAttemptState }
  | { readonly status: 'error'; readonly reason: string }

function osLabel(osId: NetOsId | null | undefined): string {
  return osId ? getNetOsLabel(osId) : 'NO OS'
}

function CredentialCard({ identityLinkId }: { readonly identityLinkId: string }) {
  const [state, setState] = useState<CredentialLoadState>({ status: 'loading' })
  const [formKind, setFormKind] = useState<'pin' | 'password' | null>(null)
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    setFormKind(null)
    setInput('')
    setError(null)
    void fetchNetSystemCredentialStatus(identityLinkId)
      .then((credential) => {
        if (cancelled) return
        setState({ status: 'ready', credential })
      })
      .catch((caught) => {
        if (cancelled) return
        setState({
          status: 'error',
          reason: caught instanceof Error ? caught.message : 'System security status could not be loaded.',
        })
      })
    return () => { cancelled = true }
  }, [identityLinkId])

  const save = async () => {
    if (!formKind || saving) return
    setSaving(true)
    setError(null)
    try {
      const credential = await setNetSystemCredential(identityLinkId, formKind, input)
      setState({ status: 'ready', credential })
      setFormKind(null)
      setInput('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'System security could not be changed.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const credential = await clearNetSystemCredential(identityLinkId)
      setState({ status: 'ready', credential })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'System security could not be removed.')
    } finally {
      setSaving(false)
    }
  }

  const configured = state.status === 'ready' ? state.credential.configured : false
  const kind = state.status === 'ready' ? state.credential.credentialKind : null

  return (
    <section className="net-persona-control__os" aria-label="System security">
      <header>
        <ShieldCheck size={15} aria-hidden="true" />
        <div>
          <span>PROTECTION</span>
          <strong>
            {state.status === 'loading' ? 'RESOLVING…' : state.status === 'error' ? 'UNAVAILABLE'
              : configured ? (kind === 'pin' ? 'PIN' : 'PASSWORD') : 'NONE'}
          </strong>
        </div>
      </header>

      {state.status === 'error' ? <p role="alert">{state.reason}</p> : null}

      {state.status === 'ready' ? (
        formKind ? (
          <>
            <label>
              <span className="sr-only">{formKind === 'pin' ? 'New PIN' : 'New password'}</span>
              <input
                type="password"
                value={input}
                maxLength={formKind === 'pin' ? 8 : 72}
                placeholder={formKind === 'pin' ? '4-8 digit PIN' : 'Password (4-72 characters)'}
                onChange={(event) => setInput(event.target.value)}
              />
            </label>
            <div className="net-persona-control__os-action">
              <button
                type="button"
                disabled={saving || !input.trim()}
                onClick={() => { void save() }}
              >
                {saving ? 'SAVING…' : configured ? 'CHANGE CREDENTIAL' : `SET ${formKind === 'pin' ? 'PIN' : 'PASSWORD'}`}
              </button>
              <button type="button" disabled={saving} onClick={() => { setFormKind(null); setInput('') }}>
                CANCEL
              </button>
            </div>
          </>
        ) : (
          <div className="net-persona-control__os-action">
            <button type="button" disabled={saving} onClick={() => { setFormKind('pin'); setInput('') }}>
              <KeyRound size={13} aria-hidden="true" /> {configured ? 'CHANGE PIN' : 'SET PIN'}
            </button>
            <button type="button" disabled={saving} onClick={() => { setFormKind('password'); setInput('') }}>
              <KeyRound size={13} aria-hidden="true" /> {configured ? 'CHANGE PASSWORD' : 'SET PASSWORD'}
            </button>
          </div>
        )
      ) : null}

      {state.status === 'ready' && configured && !formKind ? (
        <div className="net-persona-control__os-action">
          <span />
          <button type="button" disabled={saving} onClick={() => { void remove() }}>
            REMOVE CREDENTIAL
          </button>
        </div>
      ) : null}

      {error ? <p role="alert">{error}</p> : null}
      <small>
        Fictional in-world OS security only -- never your account login. The configured credential is never
        shown again once saved.
      </small>
    </section>
  )
}

function AccessDialog({
  target,
  onClose,
  onSuccess,
}: {
  readonly target: NetSystemHackingTarget
  readonly onClose: () => void
  readonly onSuccess: () => void
}) {
  const [input, setInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (submitting || !input) return
    setSubmitting(true)
    setError(null)
    try {
      await attemptNetSystemCredentialAccess(target.targetIdentityLinkId, input)
      onSuccess()
    } catch {
      setError('ACCESS DENIED')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section
      className="net-persona-control__compromise-confirm"
      role="alertdialog"
      aria-labelledby="net-system-security-access-title"
    >
      <div>
        <strong id="net-system-security-access-title">{target.displayName.toUpperCase()}</strong>
        <span>{osLabel(target.osId)}</span>
      </div>
      <p>CREDENTIAL REQUIRED. The exact credential type configured for this system is not disclosed.</p>
      <label>
        <span className="sr-only">System credential</span>
        <input
          type="password"
          value={input}
          maxLength={72}
          placeholder="PIN or password"
          autoFocus
          onChange={(event) => setInput(event.target.value)}
        />
      </label>
      {error ? <span role="alert">{error}</span> : null}
      <div>
        <button
          type="button"
          className="net-persona-control__take-control-confirm"
          disabled={submitting || !input}
          onClick={() => { void submit() }}
        >
          <Unlock size={14} aria-hidden="true" /> {submitting ? 'CONNECTING…' : 'ACCESS SYSTEM'}
        </button>
        <button type="button" className="net-persona-control__take-control-cancel" disabled={submitting} onClick={onClose}>
          CANCEL
        </button>
      </div>
    </section>
  )
}

/**
 * SYSTEM SECURITY: own effective runtime identity only. Never rendered with
 * no identityLinkId (GM System with no persona) -- the caller is expected to
 * gate that. Same shared logic for VEIL and ALTARA; only the surrounding
 * wrapper differs (native net-persona-control classes for VEIL, wrapped in
 * .altara-persona-control for ALTARA -- no second implementation).
 *
 * identityLinkId is whichever identity is currently effectively mounted --
 * the caller's own, or the hacking target's once a hack is entered (full
 * runtime parity: this makes CredentialCard transparently show/edit the
 * target's own credential while "inside" their system, with no special
 * casing here). The AUTHORISED SYSTEMS / hacking-initiation section below
 * is deliberately hidden while hacking.mounted is true: it is the source
 * identity's own capability list, which has no business appearing inside
 * the target's own Settings. The always-visible COMPROMISED SYSTEM /
 * DISCONNECT indicator lives in NetSystemHackingBanner, mounted at the OS
 * chrome level (outside Settings) so it stays visible everywhere, not just
 * here.
 */
export function NetSystemSecurityControl({
  identityLinkId,
  profileId,
}: {
  readonly identityLinkId?: string
  readonly profileId?: string
}) {
  const hacking = useNetSystemHackingRuntime(profileId)
  const [targetsState, setTargetsState] = useState<TargetsLoadState>({ status: 'loading' })
  const [accessTarget, setAccessTarget] = useState<NetSystemHackingTarget | null>(null)
  const [rollAttemptState, setRollAttemptState] = useState<RollAttemptLoadState>({ status: 'loading' })
  const [requestingRoll, setRequestingRoll] = useState(false)
  const [checkingRoll, setCheckingRoll] = useState(false)

  // A -> B identity switch (or logout, identityLinkId becomes undefined)
  // resets transient UI state and reloads the authorised-targets list and
  // the actor's own pending roll attempt fresh from the server, so nothing
  // from the previous identity can leak forward and a reload/remount always
  // recovers real server state rather than defaulting to "ROLL ACCESS".
  useEffect(() => {
    setAccessTarget(null)

    if (!identityLinkId) {
      setTargetsState({ status: 'ready', targets: [] })
      setRollAttemptState({ status: 'ready', attempt: { pending: false } })
      return
    }

    setTargetsState({ status: 'loading' })
    void fetchNetSystemHackingTargets()
      .then((targets) => setTargetsState({ status: 'ready', targets }))
      .catch((caught) => setTargetsState({
        status: 'error',
        reason: caught instanceof Error ? caught.message : 'Authorised systems could not be loaded.',
      }))

    setRollAttemptState({ status: 'loading' })
    void fetchNetSystemHackingRollAttempt()
      .then((attempt) => setRollAttemptState({ status: 'ready', attempt }))
      .catch((caught) => setRollAttemptState({
        status: 'error',
        reason: caught instanceof Error ? caught.message : 'Roll attempt status could not be loaded.',
      }))
  }, [identityLinkId])

  const session = hacking.session
  const targets = targetsState.status === 'ready' ? targetsState.targets : []
  const activeTarget = session?.active
    ? targets.find((target) => target.targetIdentityLinkId === session.targetIdentityLinkId)
    : undefined

  const requestRoll = async (target: NetSystemHackingTarget) => {
    if (requestingRoll) return
    setRequestingRoll(true)
    try {
      const attempt = await requestNetSystemHackingRollAttempt(target.targetIdentityLinkId)
      setRollAttemptState({ status: 'ready', attempt })
    } catch (caught) {
      setRollAttemptState({
        status: 'error',
        reason: caught instanceof Error ? caught.message : 'The roll request could not be sent.',
      })
    } finally {
      setRequestingRoll(false)
    }
  }

  // Manual only, no interval/polling: success routes into the existing
  // session flow via hacking.refresh(); otherwise re-checking the pending
  // attempt itself picks up either a still-pending state or Silver having
  // marked it failed (which returns this row to plain ROLL ACCESS).
  const checkRoll = async () => {
    if (checkingRoll) return
    setCheckingRoll(true)
    try {
      const refreshedSession = await hacking.refresh()
      if (refreshedSession?.active) {
        setRollAttemptState({ status: 'ready', attempt: { pending: false } })
        return
      }
      const attempt = await fetchNetSystemHackingRollAttempt()
      setRollAttemptState({ status: 'ready', attempt })
    } catch (caught) {
      setRollAttemptState({
        status: 'error',
        reason: caught instanceof Error ? caught.message : 'Roll status could not be checked.',
      })
    } finally {
      setCheckingRoll(false)
    }
  }

  if (!identityLinkId) {
    return (
      <div className="net-persona-control__empty" role="status">
        <strong>NO ACTIVE IDENTITY</strong>
        <span>GM SYSTEM has no fictional identity to secure. Take control or act as a character first.</span>
      </div>
    )
  }

  return (
    <div className="net-persona-control">
      <CredentialCard identityLinkId={identityLinkId} />

      {hacking.sessionStatus === 'error' ? (
        <p className="net-persona-control__error" role="alert">{hacking.sessionError}</p>
      ) : null}

      {hacking.mounted ? null : session?.active ? (
        <section className="net-persona-control__os" aria-label="Compromised connection">
          <header>
            <Unlock size={15} aria-hidden="true" />
            <div>
              <span>COMPROMISED CONNECTION</span>
              <strong>{activeTarget?.displayName ?? 'TARGET SYSTEM'}</strong>
            </div>
          </header>
          <small>{osLabel(session.targetOsId)}</small>
          <div className="net-persona-control__os-action">
            <button type="button" onClick={hacking.enter}>
              <Unlock size={13} aria-hidden="true" /> ENTER SYSTEM
            </button>
            <button type="button" disabled={hacking.disconnecting} onClick={() => { void hacking.disconnect() }}>
              {hacking.disconnecting ? 'DISCONNECTING…' : 'DISCONNECT'}
            </button>
          </div>
          {hacking.disconnectError ? <p role="alert">{hacking.disconnectError}</p> : null}
          <small>Disconnecting keeps the persistent grant enabled. Credential access requires the credential again.</small>
        </section>
      ) : (
        <section className="net-persona-control__os net-persona-control__hacking" aria-label="Authorised systems">
          <header>
            <ShieldCheck size={15} aria-hidden="true" />
            <div>
              <span>AUTHORISED SYSTEMS</span>
              <strong>
                {targetsState.status === 'ready' ? `${targets.length}` : targetsState.status === 'loading' ? 'RESOLVING…' : 'UNAVAILABLE'}
              </strong>
            </div>
          </header>

          {targetsState.status === 'error' ? <p role="alert">{targetsState.reason}</p> : null}
          {rollAttemptState.status === 'error' ? <p role="alert">{rollAttemptState.reason}</p> : null}

          <div className="net-persona-control__hacking-list">
            {targetsState.status === 'ready' && !targets.length ? (
              <p className="net-persona-control__hacking-empty">
                No systems have been authorised for this identity yet.
              </p>
            ) : null}
            {targets.map((target) => {
              const rollPendingForTarget = rollAttemptState.status === 'ready'
                && rollAttemptState.attempt.pending
                && rollAttemptState.attempt.targetIdentityLinkId === target.targetIdentityLinkId
              return (
              <div key={target.targetIdentityLinkId} className="net-persona-control__hacking-row" data-enabled="true">
                <span className="net-persona-control__portrait" aria-hidden="true">
                  {target.avatarUrl ? <img src={target.avatarUrl} alt="" /> : target.displayName.slice(0, 2).toUpperCase()}
                </span>
                <span className="net-persona-control__hacking-row-copy">
                  <strong>{target.displayName.toUpperCase()}</strong>
                  <span>{osLabel(target.osId)}</span>
                </span>
                <span className="net-persona-control__hacking-row-status">
                  <b data-enabled="true">
                    {target.method === 'credential' ? 'CREDENTIAL REQUIRED' : 'ROLL AUTHORISATION'}
                  </b>
                </span>
                <span className="net-persona-control__hacking-row-actions">
                  {target.method === 'credential' ? (
                    <button type="button" onClick={() => setAccessTarget(target)}>
                      <Unlock size={13} aria-hidden="true" /> ACCESS SYSTEM
                    </button>
                  ) : rollPendingForTarget ? (
                    <>
                      <span>AWAITING GM ROLL CONFIRMATION</span>
                      <button type="button" disabled={checkingRoll} onClick={() => { void checkRoll() }}>
                        {checkingRoll ? 'CHECKING…' : 'CHECK STATUS'}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={requestingRoll || rollAttemptState.status === 'loading'}
                      onClick={() => { void requestRoll(target) }}
                    >
                      {requestingRoll ? 'SENDING…' : 'ROLL ACCESS'}
                    </button>
                  )}
                </span>
              </div>
              )
            })}
          </div>
        </section>
      )}

      {accessTarget ? (
        <AccessDialog
          target={accessTarget}
          onClose={() => setAccessTarget(null)}
          onSuccess={() => {
            setAccessTarget(null)
            void hacking.refresh()
          }}
        />
      ) : null}
    </div>
  )
}
