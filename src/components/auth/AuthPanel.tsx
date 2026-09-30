import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { SUPABASE_CONFIG_ERROR } from '../../lib/supabase'


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
  const { signIn, authConfigured } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const submitDisabled = submitting || !authConfigured

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      await signIn({ email, password })
      navigate('/app', { replace: true })
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
    <section className="gg-auth-panel" aria-labelledby="login-title">
      <p className="gg-login-meta">01 // IDENTIFICAÇÃO</p>
      <h2 id="login-title">INICIAR SESSÃO</h2>
      <p className="gg-auth-intro">Entra para continuar a tua história.</p>

      {!authConfigured ? (
        <div className="mt-4 border border-amber-400/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
          {SUPABASE_CONFIG_ERROR}
        </div>
      ) : null}

      <form className="mt-5 space-y-3.5" onSubmit={handleSubmit}>

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
            placeholder="A tua palavra-passe"
            autoComplete="current-password"
            required
          />
        </label>

        {error ? (
          <div role="alert" className="border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}


        <button
          type="submit"
          disabled={submitDisabled}
          className="signal-button w-full px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'A autenticar…' : 'Entrar no arquivo →'}
        </button>
      </form>
    </section>
  )
}
