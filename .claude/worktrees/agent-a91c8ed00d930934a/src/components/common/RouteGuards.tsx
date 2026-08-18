import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { LoadingScreen } from './LoadingScreen'

export function ProtectedRoute() {
  const { profile, loading } = useAuth()

  if (loading) {
    return <LoadingScreen />
  }

  if (!profile) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}

export function PublicOnlyRoute() {
  const { profile, loading } = useAuth()

  if (loading) {
    return <LoadingScreen />
  }

  if (profile) {
    return <Navigate to="/app" replace />
  }

  return <Outlet />
}
