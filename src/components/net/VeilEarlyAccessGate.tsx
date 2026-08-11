import { LockKeyhole, ShieldCheck } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'

import '../../styles/veilEarlyAccess.css'

export const VEIL_EARLY_ACCESS_ENABLED = true
export const VEIL_EARLY_ACCESS_STORAGE_KEY = 'veilEarlyAccess'

const VEIL_EARLY_ACCESS_CODE = '1118'

function hasEarlyAccessUnlock() {
  if (!VEIL_EARLY_ACCESS_ENABLED) return true

  try {
    return window.localStorage.getItem(VEIL_EARLY_ACCESS_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function rememberEarlyAccessUnlock() {
  try {
    window.localStorage.setItem(VEIL_EARLY_ACCESS_STORAGE_KEY, 'true')
  } catch {
    // The current session may still unlock when browser storage is unavailable.
  }
}

interface VeilEarlyAccessGateProps {
  children: ReactNode
}

export function VeilEarlyAccessGate({ children }: VeilEarlyAccessGateProps) {
  const [isUnlocked, setIsUnlocked] = useState(hasEarlyAccessUnlock)
  const [accessCode, setAccessCode] = useState('')
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    if (isUnlocked) return

    const previousTitle = document.title
    document.title = 'VEIL OS // RESTRICTED ACCESS'

    return () => {
      document.title = previousTitle
    }
  }, [isUnlocked])

  if (isUnlocked) return children

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (accessCode.trim() !== VEIL_EARLY_ACCESS_CODE) {
      setHasError(true)
      setAccessCode('')
      return
    }

    rememberEarlyAccessUnlock()
    setHasError(false)
    setIsUnlocked(true)
  }

  return (
    <main className="veil-access" aria-labelledby="veil-access-title">
      <div className="veil-access__field" aria-hidden="true" />

      <section className="veil-access__panel">
        <header className="veil-access__brand">
          <div className="veil-access__brand-mark" aria-hidden="true">
            <ShieldCheck size={24} strokeWidth={1.6} />
          </div>
          <div>
            <h1 id="veil-access-title">VEIL OS</h1>
            <p>NEW VEGA CIVIC SYSTEM</p>
          </div>
        </header>

        <div className="veil-access__rule" aria-hidden="true">
          <span />
        </div>

        <div className="veil-access__copy">
          <LockKeyhole size={18} strokeWidth={1.7} aria-hidden="true" />
          <div>
            <strong>EARLY ACCESS BUILD</strong>
            <p>Restricted civic-system preview. Authorization is required.</p>
          </div>
        </div>

        <form className="veil-access__form" onSubmit={handleSubmit}>
          <label htmlFor="veil-access-code">ACCESS CODE</label>
          <input
            id="veil-access-code"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            maxLength={4}
            value={accessCode}
            aria-invalid={hasError}
            aria-describedby={hasError ? 'veil-access-error' : undefined}
            onChange={(event) => {
              setAccessCode(event.target.value.replace(/\D/g, '').slice(0, 4))
              if (hasError) setHasError(false)
            }}
          />

          <div className="veil-access__feedback" aria-live="polite">
            {hasError ? (
              <p id="veil-access-error" role="alert">
                INVALID ACCESS CODE
              </p>
            ) : (
              <span aria-hidden="true">ENTER FOUR-DIGIT CLEARANCE</span>
            )}
          </div>

          <button type="submit">AUTHENTICATE</button>
        </form>

        <footer>
          <span className="veil-access__status-dot" aria-hidden="true" />
          VEGA MESH // RESTRICTED
        </footer>
      </section>
    </main>
  )
}
