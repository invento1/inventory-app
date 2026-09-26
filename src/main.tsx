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

// Supabase's invite/recovery email links land back here with the session as
// #access_token=...&type=invite -- the same "#" HashRouter uses for routing.
// Consume it ourselves before HashRouter ever mounts, so there's no race and
// HashRouter only ever sees a clean "#/..." route. Three shapes arrive:
//   #access_token=...&refresh_token=...&type=invite|recovery   (implicit flow)
//   #error=access_denied&error_code=otp_expired&...            (link expired or already used)
//   ?code=...                                                   (PKCE flow, if ever enabled)
// Anything that fails goes to #/auth-link, which explains what happened,
// instead of a blank page or a silent bounce to the login screen.
function goTo(route: string) {
  window.history.replaceState(null, '', window.location.pathname + route)
}

function linkProblem(code: string | null, description: string | null) {
  const params = new URLSearchParams()
  if (code) params.set('code', code)
  if (description) params.set('description', description)
  goTo(`#/auth-link?${params}`)
}

async function consumeAuthCallback() {
  const hash = window.location.hash
  const search = new URLSearchParams(window.location.search)

  if (search.get('code')) {
    const { error } = await supabase.auth.exchangeCodeForSession(search.get('code')!)
    if (error) linkProblem(error.code ?? 'exchange_failed', error.message)
    else goTo('#/set-password')
    return
  }

  if (!hash.includes('access_token=') && !hash.includes('error=')) return
  const params = new URLSearchParams(hash.slice(1))

  if (params.get('error') || params.get('error_code')) {
    linkProblem(params.get('error_code') ?? params.get('error'), params.get('error_description'))
    return
  }

  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  const type = params.get('type')
  if (!accessToken || !refreshToken) {
    linkProblem('incomplete_link', 'The link is missing part of its sign-in details.')
    return
  }

  // Replaces whoever was signed in in this browser (one session per browser);
  // the set-password page shows which account it's for.
  const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
  if (error) {
    linkProblem(error.code ?? 'session_failed', error.message)
    return
  }

  goTo(type === 'recovery' || type === 'invite' ? '#/set-password' : '#/')
}

// A link opened in a tab where the app is already running only changes the
// hash (no page load), so main.tsx wouldn't see it. Reload so it's consumed
// like any other arrival.
window.addEventListener('hashchange', () => {
  const hash = window.location.hash
  if (hash.includes('access_token=') || /(^#|&)error(_code)?=/.test(hash)) window.location.reload()
})

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
