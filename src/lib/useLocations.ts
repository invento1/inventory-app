import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabaseClient'
import type { Database } from '../types/supabase'

export type Location = Database['public']['Tables']['locations']['Row']

export function useLocations(orgId: string) {
  return useQuery({
    queryKey: ['locations', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return data as Location[]
    },
  })
}
