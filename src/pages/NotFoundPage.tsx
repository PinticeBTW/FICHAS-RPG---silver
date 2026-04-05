import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="hud-panel max-w-xl rounded-[32px] p-8 text-center">
        <p className="panel-title">404</p>
        <h1 className="mt-4 text-[3rem] text-white">Pagina nao encontrada</h1>
        <p className="mt-4 text-base leading-7 text-stone-300">
          A rota pedida nao existe neste arquivo.
        </p>
        <Link className="signal-button mt-6 inline-flex px-5 py-3 text-sm" to="/">
          Voltar ao inicio
        </Link>
      </div>
    </main>
  )
}
