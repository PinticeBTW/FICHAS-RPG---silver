import { AuthPanel } from '../components/auth/AuthPanel'
import { APP_NAME, APP_TAGLINE } from '../lib/constants'

export function LandingPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-4 lg:px-6">
      <div className="w-full max-w-[460px]">
        <div className="mb-3 text-center">
          <p className="panel-title">{APP_TAGLINE}</p>
          <h1 className="mt-2 text-[3rem] text-white md:text-[3.8rem]">{APP_NAME}</h1>
        </div>

        <AuthPanel />
      </div>
    </main>
  )
}
