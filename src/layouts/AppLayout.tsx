import { Outlet, useLocation } from 'react-router-dom'

export function AppLayout() {
  const { pathname } = useLocation()

  const isNetRoute = pathname.startsWith('/app/net')

  return (
    <div
      className={
        isNetRoute
          ? 'min-h-screen bg-[#05070a]'
          : 'min-h-screen bg-[#080808] px-2 py-1.5 md:px-3 md:py-2'
      }
    >
      <Outlet />
    </div>
  )
}