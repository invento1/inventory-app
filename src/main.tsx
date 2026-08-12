import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthProvider'
import { ToastProvider } from './components/ui/Toast'
import { supabase } from './lib/supabaseClient'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

// Supabase's default invite/recovery email links land back here with the
// session as #access_token=...&type=invite -- the same "#" HashRouter uses
// for routing. Consume it ourselves before HashRouter ever mounts, so there's
// no race and HashRouter only ever sees a clean "#/..." route.
async function consumeAuthCallback() {
  const hash = window.location.hash
  if (!hash.includes('access_token=')) return

  const params = new URLSearchParams(hash.slice(1))
  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  const type = params.get('type')
  if (!accessToken || !refreshToken) return

  await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })

  const nextRoute = type === 'recovery' || type === 'invite' ? '#/set-password' : '#/'
  window.history.replaceState(null, '', window.location.pathname + window.location.search + nextRoute)
}

consumeAuthCallback().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>
            <HashRouter>
              <App />
            </HashRouter>
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
})
