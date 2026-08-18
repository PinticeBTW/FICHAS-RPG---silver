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
import type { PulseProfileDraft } from './pulseCurrentIdentity'

type PulseOnboardingStep = 'identity' | 'handle' | 'settings' | 'join'

interface PulseOnboardingProps {
  readonly identity: NetResolvedIdentity
  readonly accounts: readonly NetAppAccount[]
  readonly onActivate: (input: {
    readonly handle: string
    readonly profile: PulseProfileDraft
  }) => Promise<string>
  readonly onCancel: () => void
}

const STEPS: readonly PulseOnboardingStep[] = [
  'identity',
  'handle',
  'settings',
  'join',
]

const STEP_COPY: Record<PulseOnboardingStep, { readonly title: string; readonly detail: string }> = {
  identity: {
    title: 'ENTER THE PUBLIC GRID',
    detail: 'PULSE starts from the identity recognised by THE NET. Your public address remains yours to choose.',
  },
  handle: {
    title: 'SET A PUBLIC HANDLE',
    detail: 'This address appears on the city feed. PULSE checks final availability when you join.',
  },
  settings: {
    title: 'SET YOUR PUBLIC EDGE',
    detail: 'Choose the minimum signal the network can use to place your account.',
  },
  join: {
    title: 'JOIN PULSE',
    detail: 'This is the public profile the city will receive. Ranking remains a VOX NET system.',
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
  const withoutAt = value.trim().replace(/^@+/, '').trim()
  if (withoutAt.length > 32) return 'Keep the handle to 32 characters or fewer.'

  const normalized = normalizeNetHandle(value)
  if (!normalized) return 'Use letters, numbers, periods, underscores, or hyphens.'

  const ownerKey = getNetAppAccountOwnerKey(getNetAppAccountOwnerForIdentity(identity))
  const collision = accounts.some((account) =>
    account.appId === 'pulse'
      && normalizeNetHandle(account.handle) === normalized
      && getNetAppAccountOwnerKey(account.owner) !== ownerKey,
  )

  return collision ? 'That PULSE handle is already active in this session.' : undefined
}

function isHandleConflict(error: unknown): boolean {
  return error instanceof Error && /handle|duplicate|unique|already/i.test(error.message)
}

export function PulseOnboarding({ identity, accounts, onActivate, onCancel }: PulseOnboardingProps) {
  const [step, setStep] = useState<PulseOnboardingStep>('identity')
  const [handle, setHandle] = useState(() => (
    normalizeNetHandle(identity.defaultHandle ?? identity.displayName) ?? ''
  ))
  const [bio, setBio] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'limited'>('public')
  const [showDistrict, setShowDistrict] = useState(false)
  const [discoverable, setDiscoverable] = useState(true)
  const [feedPreference, setFeedPreference] = useState<'city' | 'following' | 'raw'>('city')
  const [activating, setActivating] = useState(false)
  const [activationError, setActivationError] = useState<string | null>(null)
  const titleId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)

  const stepIndex = STEPS.indexOf(step)
  const handleError = useMemo(
    () => getHandleError(handle, identity, accounts),
    [accounts, handle, identity],
  )
  const normalizedHandle = normalizeNetHandle(handle)

  useEffect(() => {
    headingRef.current?.focus()
  }, [step])

  const moveForward = () => {
    if (step === 'handle' && handleError) return
    const next = STEPS[stepIndex + 1]
    if (next) setStep(next)
  }

  const moveBack = () => {
    const previous = STEPS[stepIndex - 1]
    if (previous) setStep(previous)
  }

  const activate = async () => {
    if (!normalizedHandle || handleError) {
      setStep('handle')
      return
    }

    setActivating(true)
    setActivationError(null)
    try {
      await onActivate({
        handle: normalizedHandle,
        profile: {
          bio: bio.trim(),
          visibility,
          showDistrict,
          discoverable,
          feedPreference,
        },
      })
    } catch (error) {
      if (isHandleConflict(error)) setStep('handle')
      setActivationError(error instanceof Error
        ? error.message
        : 'PULSE could not confirm this public identity. Try again.')
    } finally {
      setActivating(false)
    }
  }

  const title = STEP_COPY[step]

  return (
    <section className="pulse-onboarding" aria-labelledby={titleId}>
      <aside className="pulse-onboarding__signal" aria-hidden="true" data-step={step}>
        <strong>PULSE</strong>
        <span>PUBLIC GRID</span>
        <div className="pulse-onboarding__signal-bars">
          {STEPS.map((item, index) => (
            <i key={item} data-active={index <= stepIndex ? 'true' : 'false'} />
          ))}
        </div>
        <small>VOX NET<br />RANKING LAYER</small>
      </aside>

      <div className="pulse-onboarding__main">
        <nav className="pulse-onboarding__steps" aria-label="PULSE public identity setup progress">
          {STEPS.map((item, index) => (
            <span key={item} data-active={item === step ? 'true' : 'false'} data-complete={index < stepIndex ? 'true' : 'false'}>
              {item}
            </span>
          ))}
        </nav>

        <header className="pulse-onboarding__head">
          <h2 id={titleId} ref={headingRef} tabIndex={-1}>{title.title}</h2>
          <p>{title.detail}</p>
        </header>

        {step === 'identity' ? (
          <div className="pulse-onboarding__identity">
            <span className="pulse-onboarding__avatar">
              {identity.avatarUrl ? <SharedMediaImage source={identity.avatarUrl} variant="thumbnail" alt="" /> : initials(identity.displayName)}
            </span>
            <div>
              <strong>{identity.displayName}</strong>
              <span>Source // THE NET identity profile</span>
            </div>
            <p><Fingerprint size={15} /> This character source establishes account ownership. Public PULSE presentation uses only the handle you choose.</p>
          </div>
        ) : null}

        {step === 'handle' ? (
          <div className="pulse-onboarding__form">
            <label htmlFor="pulse-onboarding-handle">
              PULSE handle
              <span className="pulse-onboarding__handle" data-invalid={handleError ? 'true' : 'false'}>
                <b>@</b>
                <input
                  id="pulse-onboarding-handle"
                  value={handle}
                  onChange={(event) => setHandle(event.target.value.replace(/^@+/, ''))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      moveForward()
                    }
                  }}
                  maxLength={32}
                  autoComplete="off"
                  aria-invalid={Boolean(handleError)}
                  aria-describedby={handleError ? 'pulse-onboarding-handle-error' : undefined}
                />
              </span>
            </label>
            {handleError
              ? <p id="pulse-onboarding-handle-error" className="pulse-onboarding__error" role="alert">{handleError}</p>
              : <p className="pulse-onboarding__hint">Availability is confirmed by PULSE when you join the public grid.</p>}
            <label htmlFor="pulse-onboarding-bio">
              Public line <em>optional</em>
              <textarea id="pulse-onboarding-bio" value={bio} onChange={(event) => setBio(event.target.value)} maxLength={240} rows={3} />
            </label>
            <p className="pulse-onboarding__handle-preview"><span>{normalizedHandle ? `@${normalizedHandle}` : '@—'}</span></p>
          </div>
        ) : null}

        {step === 'settings' ? (
          <div className="pulse-onboarding__settings">
            <fieldset>
              <legend>Profile visibility</legend>
              <label><input type="radio" name="pulse-visibility" checked={visibility === 'public'} onChange={() => setVisibility('public')} /><span><strong>Public</strong><small>Visible in the city directory and feed.</small></span></label>
              <label><input type="radio" name="pulse-visibility" checked={visibility === 'limited'} onChange={() => setVisibility('limited')} /><span><strong>Limited</strong><small>Shown only where a public PULSE is directly referenced.</small></span></label>
            </fieldset>
            <fieldset>
              <legend>Public signals</legend>
              <label><input type="checkbox" checked={showDistrict} onChange={(event) => setShowDistrict(event.target.checked)} /><span><strong>Show district</strong><small>Off by default.</small></span></label>
              <label><input type="checkbox" checked={discoverable} onChange={(event) => setDiscoverable(event.target.checked)} /><span><strong>Allow account discovery</strong><small>Let city search surface this profile.</small></span></label>
            </fieldset>
            <fieldset>
              <legend>Initial feed</legend>
              <div className="pulse-onboarding__feed-options">
                {(['city', 'following', 'raw'] as const).map((option) => (
                  <label key={option}><input type="radio" name="pulse-feed" checked={feedPreference === option} onChange={() => setFeedPreference(option)} /><span>{option}</span></label>
                ))}
              </div>
            </fieldset>
          </div>
        ) : null}

        {step === 'join' ? (
          <div className="pulse-onboarding__review">
            <div className="pulse-onboarding__review-identity">
              <span className="pulse-onboarding__avatar">
                {identity.avatarUrl ? <SharedMediaImage source={identity.avatarUrl} variant="thumbnail" alt="" /> : normalizedHandle?.slice(0, 1).toUpperCase() ?? 'P'}
              </span>
              <div><strong>{normalizedHandle ? `@${normalizedHandle}` : '@—'}</strong><span>PULSE PUBLIC HANDLE</span></div>
            </div>
            <p>{bio ? `“${bio.trim()}”` : 'No public line yet. The grid will learn the signal from what you choose to publish.'}</p>
            <dl>
              <div><dt>Visibility</dt><dd>{visibility}</dd></div>
              <div><dt>District</dt><dd>{showDistrict ? 'shown' : 'withheld'}</dd></div>
              <div><dt>Discovery</dt><dd>{discoverable ? 'enabled' : 'limited'}</dd></div>
              <div><dt>Feed</dt><dd>{feedPreference}</dd></div>
            </dl>
            <span><Radio size={14} /> RANKED BY VOX NET</span>
          </div>
        ) : null}

        {activationError ? <p className="pulse-onboarding__error" role="alert">{activationError}</p> : null}
        <footer className="pulse-onboarding__actions">
          <div>
            {stepIndex > 0 ? <button type="button" className="pulse-onboarding__back" disabled={activating} onClick={moveBack}><ChevronLeft size={15} /> Back</button> : null}
            <button type="button" className="pulse-onboarding__cancel" disabled={activating} onClick={onCancel}>Not now</button>
          </div>
          {step === 'join'
            ? <button type="button" className="pulse-onboarding__primary" disabled={activating} onClick={() => { void activate() }}><Check size={15} /> {activating ? 'Joining…' : 'Join PULSE'}</button>
            : <button type="button" className="pulse-onboarding__primary" disabled={activating} onClick={moveForward}>{step === 'identity' ? 'Set up public profile' : 'Continue'}</button>}
        </footer>
      </div>
    </section>
  )
}
