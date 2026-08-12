import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/supabase'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in your project values.',
  )
}

// detectSessionInUrl is disabled because it reads window.location.hash, which
// HashRouter also owns for routing -- the two race on load. main.tsx handles
// the auth callback itself, before HashRouter ever mounts, and hands off a
// clean "#/..." route.
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: { detectSessionInUrl: false },
})
