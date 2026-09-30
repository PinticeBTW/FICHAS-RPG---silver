import { GhostShell } from '../components/common/GhostShell'
import { Outlet, useLocation } from 'react-router-dom'

export function AppLayout() {
  const { pathname } = useLocation()
  // The Net is its original, independent full-screen experience.
  if (pathname.startsWith('/app/net')) {
    return <div className="min-h-screen bg-[#05070a]"><Outlet /></div>
  }
  return <GhostShell />
}
