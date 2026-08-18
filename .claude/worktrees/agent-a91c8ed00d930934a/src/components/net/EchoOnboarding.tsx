import { Check, ChevronLeft, Fingerprint, Radio } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { SharedMediaImage } from '../shared/SharedMediaImage'

import {
  getNetAppAccountOwnerForIdentity,
  getNetAppAccountOwnerKey,
  normalizeNetHandle,
} from './accounts/netAppAccountSelectors'
import type { NetAppAccount } from './accounts/netAppAccountTypes'
import type { NetResolvedIdentity } from './identity/netIdentityTypes'

type EchoOnboardingStep = 'identity' | 'presence' | 'activate'

interface EchoOnboardingProps {
  readonly identity: NetResolvedIdentity
  readonly accounts: readonly NetAppAccount[]
  readonly onActivate: (input: {
    readonly handle: string
  }) => Promise<string | null>
  readonly onCancel: () => void
}

const STEPS: readonly EchoOnboardingStep[] = [
  'identity',
  'presence',
  'activate',
]

const STEP_COPY: Record<EchoOnboardingStep, { readonly title: string; readonly detail: string }> = {
  identity: {
    title: 'ENTER ECHO',
    detail: 'A presence begins with the identity already recognised by the public grid.',
  },
  presence: {
    title: 'SHAPE THE SIGNAL',
    detail: 'Choose the account address that binds discoveries and saved signals to this character.',
  },
  activate: {
    title: 'ACTIVATE PRESENCE',
    detail: 'Confirm the server-backed ECHO account that will carry this investigation.',
  },
}

function initials(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'NV'
}

function getHandleError(
  value: string,
  identity: NetResolvedIdentity,
  accounts: readonly NetAppAccount[],
): string | undefined {
  const unprefixed = value.trim().replace(/^@+/, '').trim()
  if (unprefixed.length > 32) {
    return 'Keep the handle to 32 characters or fewer.'
  }

  const normalized = normalizeNetHandle(value)
  if (!normalized) {
    return 'Use letters, numbers, periods, underscores, or hyphens.'
  }

  const ownerKey = getNetAppAccountOwnerKey(getNetAppAccountOwnerForIdentity(identity))
  const collision = accounts.some((account) =>
    account.appId === 'echo'
      && normalizeNetHandle(account.handle) === normalized
      && getNetAppAccountOwnerKey(account.owner) !== ownerKey,
  )

  return collision ? 'That ECHO handle is already active in this session.' : undefined
}

export function EchoOnboarding({ identity, accounts, onActivate, onCancel }: EchoOnboardingProps) {
  const [step, setStep] = useState<EchoOnboardingStep>('identity')
  const [handle, setHandle] = useState(() => identity.defaultHandle ?? identity.displayName)
  const [activating, setActivating] = useState(false)
  const [activationError, setActivationError] = useState<string | null>(null)
  const titleId = useId()
  const stepHeadingRef = useRef<HTMLHeadingElement>(null)

  const currentStepIndex = STEPS.indexOf(step)
  const handleError = useMemo(
    () => getHandleError(handle, identity, accounts),
    [accounts, handle, identity],
  )
  const normalizedHandle = normalizeNetHandle(handle)

  useEffect(() => {
    stepHeadingRef.current?.focus()
  }, [step])

  const moveForward = () => {
    if (step === 'presence' && handleError) return
    const next = STEPS[currentStepIndex + 1]
    if (next) setStep(next)
  }

  const moveBack = () => {
    const previous = STEPS[currentStepIndex - 1]
    if (previous) setStep(previous)
  }

  const activate = async () => {
    if (!normalizedHandle || handleError) {
      setStep('presence')
      return
    }

    setActivating(true)
    setActivationError(null)
    try {
      const accountId = await onActivate({ handle: normalizedHandle })
      if (!accountId) setActivationError('ECHO could not confirm this presence. Try again.')
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      setActivationError(
        /context changed|character changed/i.test(message)
          ? 'The active character changed. Reopen this activation for the current identity.'
          : /handle|unique|duplicate|already/i.test(message)
            ? 'That ECHO handle is already active. Keep your entry and choose another.'
            : 'ECHO could not confirm this presence. Try again.',
      )
    } finally {
      setActivating(false)
    }
  }

  const title = STEP_COPY[step]

  return (
    <section className="net-echo-onboarding" aria-labelledby={titleId}>
      <div className="net-echo-onboarding__field" aria-hidden="true" data-step={step}>
        <span className="net-echo-onboarding__ring net-echo-onboarding__ring--outer" />
        <span className="net-echo-onboarding__ring net-echo-onboarding__ring--middle" />
        <span className="net-echo-onboarding__ring net-echo-onboarding__ring--inner" />
        <span className="net-echo-onboarding__signal">
          {identity.avatarUrl ? <SharedMediaImage source={identity.avatarUrl} variant="thumbnail" alt="" /> : initials(identity.displayName)}
        </span>
      </div>

      <div className="net-echo-onboarding__main">
        <nav className="net-echo-onboarding__steps" aria-label="ECHO presence activation progress">
          {STEPS.map((item, index) => (
            <span key={item} data-active={item === step ? 'true' : 'false'} data-complete={index < currentStepIndex ? 'true' : 'false'}>
              {item}
            </span>
          ))}
        </nav>

        <div className="net-echo-onboarding__copy">
          <h2 id={titleId} tabIndex={-1} ref={stepHeadingRef}>{title.title}</h2>
          <p>{title.detail}</p>
        </div>

        {step === 'identity' ? (
          <div className="net-echo-onboarding__identity">
            <div className="net-echo-onboarding__identity-name">
              <span className="net-echo-onboarding__mini-avatar">
                {identity.avatarUrl ? <SharedMediaImage source={identity.avatarUrl} variant="thumbnail" alt="" /> : initials(identity.displayName)}
              </span>
              <div>
                <strong>{identity.displayName}</strong>
                <span>Identity source // IDEN public-grid record</span>
              </div>
            </div>
            <div className="net-echo-onboarding__permission-list">
              <Fingerprint size={15} />
              <span>ECHO requests the active identity assertion and a unique app handle. The server derives account ownership.</span>
            </div>
          </div>
        ) : null}

        {step === 'presence' ? (
          <div className="net-echo-onboarding__form">
            <label htmlFor="echo-onboarding-handle">
              ECHO handle
              <div className="net-echo-onboarding__handle-field" data-invalid={handleError ? 'true' : 'false'}>
                <span>@</span>
                <input
                  id="echo-onboarding-handle"
                  value={handle}
                  onChange={(event) => setHandle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      moveForward()
                    }
                  }}
                  maxLength={33}
                  autoComplete="off"
                  aria-describedby={handleError ? 'echo-onboarding-handle-error' : undefined}
                  aria-invalid={Boolean(handleError)}
                />
              </div>
            </label>
            {handleError ? <p id="echo-onboarding-handle-error" className="net-echo-onboarding__error" role="alert">{handleError}</p> : <p className="net-echo-onboarding__hint">Final handle availability is confirmed by the NET identity service.</p>}
            <p className="net-echo-onboarding__preview-name">{identity.displayName} <span>{normalizedHandle ? `@${normalizedHandle}` : '@—'}</span></p>
          </div>
        ) : null}

        {step === 'activate' ? (
          <div className="net-echo-onboarding__review">
            <div className="net-echo-onboarding__review-identity">
              <Radio size={17} />
              <div>
                <strong>{identity.displayName}</strong>
                <span>{normalizedHandle ? `@${normalizedHandle}` : '@—'}</span>
              </div>
            </div>
            <ul>
              <li>Identity ownership derived from the active playable character</li>
              <li>Discoveries and saves remain private to this ECHO account</li>
              <li>Signal visibility remains server-authoritative</li>
            </ul>
            <span className="net-echo-onboarding__empty-frequency">Initial frequencies // waiting for resonance</span>
          </div>
        ) : null}

        {activationError ? <p className="net-echo-onboarding__error" role="alert">{activationError}</p> : null}
        <footer className="net-echo-onboarding__actions">
          <div className="net-echo-onboarding__secondary-actions">
            {currentStepIndex > 0 ? <button type="button" className="net-echo-onboarding__back" disabled={activating} onClick={moveBack}><ChevronLeft size={15} /> Back</button> : null}
            <button type="button" className="net-echo-onboarding__cancel" disabled={activating} onClick={onCancel}>Not now</button>
          </div>
          {step === 'activate' ? <button type="button" className="net-echo-onboarding__primary" disabled={activating} onClick={() => { void activate() }}><Check size={15} /> {activating ? 'Activating…' : 'Activate presence'}</button> : <button type="button" className="net-echo-onboarding__primary" disabled={activating} onClick={moveForward}>{step === 'identity' ? 'Continue with IDEN' : 'Continue'}</button>}
        </footer>
      </div>
    </section>
  )
}
