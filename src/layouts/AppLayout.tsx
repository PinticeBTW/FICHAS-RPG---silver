import { Outlet } from 'react-router-dom'

export function AppLayout() {
  return (
    <div className="min-h-screen bg-[#080808] px-2 py-1.5 md:px-3 md:py-2">
      <Outlet />
    </div>
  )
}
