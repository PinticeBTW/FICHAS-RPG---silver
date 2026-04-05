import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { APP_NAME } from '../../lib/constants'
import { SUPABASE_CONFIG_ERROR } from '../../lib/supabase'

type AuthMode = 'sign-in' | 'sign-up'

function formatAuthError(message: string) {
  const normalized = message.toLowerCase()

  if (normalized.includes('invalid login credentials')) {
    return 'Email ou palavra-passe inválidos.'
  }

  if (normalized.includes('email not confirmed')) {
    return 'Confirma o teu email antes de entrares.'
  }

  if (normalized.includes('user already registered')) {
    return 'Este email já está registado.'
  }

  if (normalized.includes('password should be at least')) {
    return 'A palavra-passe tem de ter pelo menos 6 caracteres.'
  }

  if (normalized.includes('signup is disabled')) {
    return 'O registo está desativado no projeto Supabase.'
  }

  return message
}

export function AuthPanel() {
  const navigate = useNavigate()
  const { signIn, signUp, authConfigured } = useAuth()
  const [mode, setMode] = useState<AuthMode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [handle, setHandle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const submitDisabled = submitting || !authConfigured

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setSuccess(null)

    try {
      if (mode === 'sign-in') {
        await signIn({ email, password })
        navigate('/app', { replace: true })
        return
      }

      const result = await signUp({ email, password, displayName, handle })

      if (result.needsEmailConfirmation) {
        setSuccess('Conta criada. Confirma o email para concluir o acesso.')
      } else {
        navigate('/app', { replace: true })
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? formatAuthError(caughtError.message)
          : 'Falha no acesso.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="hud-panel w-full rounded-[28px] p-5 md:p-6">
      <div>
        <p className="panel-title">Acesso restrito</p>
        <h2 className="mt-2 text-[2.2rem] text-white md:text-[2.6rem]">{APP_NAME}</h2>
        <p className="mt-2 max-w-[28rem] text-sm leading-6 text-stone-300">
          Entra no arquivo da campanha para veres a tua ficha e os teus estados.
        </p>
      </div>

      {!authConfigured ? (
        <div className="mt-4 border border-amber-400/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
          {SUPABASE_CONFIG_ERROR}
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-2 border border-white/10 bg-black/25 p-1">
        {(['sign-in', 'sign-up'] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            className={`px-4 py-2.5 text-sm uppercase tracking-[0.18em] transition ${
              mode === entry ? 'bg-[#f3e600] text-black' : 'text-stone-300'
            }`}
            onClick={() => {
              setMode(entry)
              setError(null)
              setSuccess(null)
            }}
          >
            {entry === 'sign-in' ? 'Entrar' : 'Registar'}
          </button>
        ))}
      </div>

      <form className="mt-5 space-y-3.5" onSubmit={handleSubmit}>
        {mode === 'sign-up' ? (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="panel-title">Nome</span>
              <input
                className="input-shell px-4 py-2.5"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Silver"
                autoComplete="name"
                required
              />
            </label>
            <label className="space-y-2">
              <span className="panel-title">Handle</span>
              <input
                className="input-shell px-4 py-2.5"
                value={handle}
                onChange={(event) => setHandle(event.target.value)}
                placeholder="@silver"
                autoComplete="nickname"
              />
            </label>
          </div>
        ) : null}

        <label className="block space-y-2">
          <span className="panel-title">Email</span>
          <input
            className="input-shell px-4 py-2.5"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="operativo@ghostgrid.app"
            autoComplete="email"
            required
          />
        </label>

        <label className="block space-y-2">
          <span className="panel-title">Palavra-passe</span>
          <input
            className="input-shell px-4 py-2.5"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Pelo menos 6 caracteres"
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            required
          />
        </label>

        {error ? (
          <div className="border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="border border-sky-400/30 bg-sky-400/10 px-4 py-3 text-sm text-sky-100">
            {success}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={submitDisabled}
          className="signal-button w-full px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'A processar...' : mode === 'sign-in' ? 'Entrar no arquivo' : 'Criar conta'}
        </button>
      </form>
    </section>
  )
}
