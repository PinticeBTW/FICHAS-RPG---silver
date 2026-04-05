import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { ProtectedRoute, PublicOnlyRoute } from '../components/common/RouteGuards'
import { LoadingScreen } from '../components/common/LoadingScreen'

const AppLayout = lazy(() =>
  import('../layouts/AppLayout').then((module) => ({ default: module.AppLayout })),
)
const SheetWorkspacePage = lazy(() =>
  import('../pages/SheetWorkspacePage').then((module) => ({
    default: module.SheetWorkspacePage,
  })),
)
const LandingPage = lazy(() =>
  import('../pages/LandingPage').then((module) => ({ default: module.LandingPage })),
)
const NotFoundPage = lazy(() =>
  import('../pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage })),
)

function routeElement(node: ReactNode) {
  return <Suspense fallback={<LoadingScreen label="A abrir pagina..." />}>{node}</Suspense>
}

export const router = createBrowserRouter([
  {
    element: <PublicOnlyRoute />,
    children: [
      {
        path: '/',
        element: routeElement(<LandingPage />),
      },
    ],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        path: '/app',
        element: routeElement(<AppLayout />),
        children: [
          {
            index: true,
            element: <Navigate to="/app/sheets" replace />,
          },
          {
            path: 'sheets',
            element: routeElement(<SheetWorkspacePage />),
          },
          {
            path: 'sheets/:profileId',
            element: routeElement(<SheetWorkspacePage />),
          },
          {
            path: 'archive',
            element: <Navigate to="/app/sheets" replace />,
          },
          {
            path: 'player',
            element: <Navigate to="/app/sheets" replace />,
          },
          {
            path: 'gm',
            element: <Navigate to="/app/sheets" replace />,
          },
          {
            path: 'cyberware',
            element: <Navigate to="/app/sheets" replace />,
          },
          {
            path: 'characters/:characterId',
            element: <Navigate to="/app/sheets" replace />,
          },
        ],
      },
    ],
  },
  {
    path: '*',
    element: routeElement(<NotFoundPage />),
  },
])
