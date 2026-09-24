import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabaseClient'
import { useAuth } from '../auth/AuthProvider'
import { useOrg } from '../auth/OrgProvider'
import type { Json } from '../types/supabase'

// Per-user, per-org UI settings (table: user_preferences). Supabase is the
// source of truth, so a preference follows the user to any device; a
// localStorage copy seeds the first render so a saved layout appears
// instantly on reload instead of flashing the default. localStorage can be
// unavailable (private mode, blocked storage) -- every access is guarded and
// the hook still works without it.

function cacheKey(userId: string, orgId: string, key: string) {
  return `hashirhub:pref:${userId}:${orgId}:${key}`
}

function readCache<T>(storageKey: string): T | undefined {
  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw ? (JSON.parse(raw) as T) : undefined
  } catch {
    return undefined
  }
}

function writeCache(storageKey: string, value: unknown) {
  try {
    if (value === undefined) window.localStorage.removeItem(storageKey)
    else window.localStorage.setItem(storageKey, JSON.stringify(value))
  } catch {
    // Storage full or blocked -- the server copy still persists it.
  }
}

// Wrapped so the query data is always a plain object (TanStack Query's
// placeholderData typing can't accept a bare generic T).
interface Envelope<T> {
  value: T | null
}

// `value` is the saved preference, or undefined when nothing is saved (the
// caller supplies its own default). `save(undefined)` clears it.
export function useUserPreference<T>(key: string) {
  const { user } = useAuth()
  const { orgId } = useOrg()
  const queryClient = useQueryClient()
  const userId = user?.id ?? ''
  const storageKey = cacheKey(userId, orgId, key)
  const queryKey = ['user_preference', userId, orgId, key]

  const query = useQuery<Envelope<T>>({
    queryKey,
    enabled: !!userId,
    placeholderData: () => {
      const cached = readCache<T>(storageKey)
      return cached === undefined ? undefined : { value: cached }
    },
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_preferences')
        .select('value')
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .eq('key', key)
        .maybeSingle()
      if (error) throw error
      const value = (data?.value ?? undefined) as T | undefined
      writeCache(storageKey, value)
      return { value: value ?? null }
    },
  })

  const mutation = useMutation({
    mutationFn: async (value: T | undefined) => {
      if (value === undefined) {
        const { error } = await supabase
          .from('user_preferences')
          .delete()
          .eq('org_id', orgId)
          .eq('user_id', userId)
          .eq('key', key)
        if (error) throw error
        return
      }
      const { error } = await supabase
        .from('user_preferences')
        .upsert(
          { org_id: orgId, user_id: userId, key, value: value as Json, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,org_id,key' },
        )
      if (error) throw error
    },
    // Optimistic: show the new layout immediately; roll back if saving fails.
    onMutate: async (value) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<Envelope<T>>(queryKey)
      queryClient.setQueryData<Envelope<T>>(queryKey, { value: value ?? null })
      writeCache(storageKey, value)
      return { previous }
    },
    onError: (_err, _value, context) => {
      queryClient.setQueryData(queryKey, context?.previous)
      writeCache(storageKey, context?.previous?.value ?? undefined)
    },
  })

  return {
    value: query.data?.value ?? undefined,
    isLoading: query.isLoading,
    save: mutation.mutateAsync,
    isSaving: mutation.isPending,
  }
}
