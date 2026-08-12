import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { OrgProvider } from './OrgProvider'
import { PageSpinner } from '../components/ui/Spinner'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()

  if (loading) return <PageSpinner />
  if (!session) return <Navigate to="/login" replace />

  return <OrgProvider>{children}</OrgProvider>
}
