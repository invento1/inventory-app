import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { EmailOtpType, Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'

interface AuthContextValue {
  session: Session | null
  user: User | null
  loading: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

// Invite/recovery emails link back with ?token_hash=&type= in the query string
// (not the #hash) specifically so they don't collide with HashRouter's own
// use of "#" for routing. This exchanges that token for a session on load.
async function consumeEmailLinkIfPresent() {
  const params = new URLSearchParams(window.location.search)
  const tokenHash = params.get('token_hash')
  const type = params.get('type') as EmailOtpType | null
  if (!tokenHash || !type) return

  await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
  window.history.replaceState(null, '', window.location.pathname + window.location.hash)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    consumeEmailLinkIfPresent().finally(() => {
      supabase.auth.getSession().then(({ data }) => {
        setSession(data.session)
        setLoading(false)
      })
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      setLoading(false)
    })

    return () => subscription.subscription.unsubscribe()
  }, [])

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
