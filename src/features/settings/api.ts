import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import type { Database } from '../../types/supabase'
import type { Location } from '../../lib/useLocations'

export interface ResetDataCategory {
  key: string
  label: string
  description: string
}

export const RESET_DATA_CATEGORIES: { group: string; categories: ResetDataCategory[] }[] = [
  {
    group: 'Transactions',
    categories: [
      { key: 'sales_receipts', label: 'Sales Receipts', description: 'Every walk-in sale' },
      { key: 'invoices', label: 'Invoices', description: 'Credit sales, their payments, and any deposits built from them' },
      { key: 'supplier_bills', label: 'Supplier Bills', description: 'Goods received and their payments' },
      { key: 'purchase_orders', label: 'Purchase Orders', description: 'Every purchase order' },
      { key: 'quotations', label: 'Quotations', description: 'Every estimate' },
      { key: 'credit_memos', label: 'Credit Memos', description: 'Every customer credit note' },
      { key: 'refunds', label: 'Refunds', description: 'Every cash-back record' },
      { key: 'expenses', label: 'Expenses', description: 'Every recorded expense' },
      { key: 'inventory_activity', label: 'Inventory Transfers & Adjustments', description: 'Stock moved between locations or manually adjusted' },
      { key: 'ledger_entries', label: 'Manual Ledger Entries & Fund Transfers', description: 'Fiscal Daybook manual entries and Banking transfers' },
    ],
  },
  {
    group: 'Master data',
    categories: [
      { key: 'items', label: 'Items', description: 'Your entire product catalog' },
      { key: 'customers', label: 'Customers', description: 'Every customer contact' },
      { key: 'suppliers', label: 'Suppliers', description: 'Every supplier contact' },
      { key: 'locations', label: 'Locations', description: 'Every store/warehouse' },
      { key: 'reference_data', label: 'Categories, Brands, Units & Areas', description: 'Item classification reference lists' },
      { key: 'chart_of_accounts', label: 'Chart of Accounts', description: 'Every ledger account (Capital Matrix)' },
    ],
  },
]

export function useResetOrgData(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (categories: string[]) => {
      const { error } = await supabase.rpc('reset_org_data', {
        p_org_id: orgId,
        p_categories: categories,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries()
    },
  })
}

export type OrgDetails = Database['public']['Tables']['orgs']['Row']
export type OrgDetailsInput = Pick<
  Database['public']['Tables']['orgs']['Update'],
  'name' | 'address' | 'phone' | 'email' | 'currency_symbol' | 'currency_code'
>

export function useOrgDetails(orgId: string) {
  return useQuery({
    queryKey: ['org_details', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('orgs').select('*').eq('id', orgId).single()
      if (error) throw error
      return data as OrgDetails
    },
  })
}

export function useUpdateOrgDetails(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: OrgDetailsInput) => {
      const { data, error } = await supabase
        .from('orgs')
        .update(input)
        .eq('id', orgId)
        .select()
        .single()
      if (error) throw error
      return data as OrgDetails
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org_details', orgId] })
      // Refreshes OrgProvider's cached currency symbol/org name app-wide.
      queryClient.invalidateQueries({ queryKey: ['org_members'] })
    },
  })
}

export type LocationType = 'store' | 'warehouse'
export type LocationInput = Pick<
  Database['public']['Tables']['locations']['Insert'],
  'name' | 'address' | 'is_active'
>

export function useAllLocations(orgId: string, type: LocationType) {
  return useQuery({
    queryKey: ['locations_all', orgId, type],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .eq('org_id', orgId)
        .eq('type', type)
        .order('name')
      if (error) throw error
      return data as Location[]
    },
  })
}

export function useCreateLocation(orgId: string, type: LocationType) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: LocationInput) => {
      const { data, error } = await supabase
        .from('locations')
        .insert({ ...input, org_id: orgId, type })
        .select()
        .single()
      if (error) throw error
      return data as Location
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations_all', orgId, type] })
      queryClient.invalidateQueries({ queryKey: ['locations', orgId] })
    },
  })
}

export function useUpdateLocation(orgId: string, type: LocationType) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<LocationInput> }) => {
      const { data, error } = await supabase
        .from('locations')
        .update(input)
        .eq('id', id)
        .eq('org_id', orgId)
        .select()
        .single()
      if (error) throw error
      return data as Location
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations_all', orgId, type] })
      queryClient.invalidateQueries({ queryKey: ['locations', orgId] })
    },
  })
}

export type PriceList = Database['public']['Tables']['price_lists']['Row']
export type PriceListInput = Pick<
  Database['public']['Tables']['price_lists']['Insert'],
  'list_date' | 'list_type' | 'image_url'
>

export function usePriceLists(orgId: string) {
  return useQuery({
    queryKey: ['price_lists', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('price_lists')
        .select('*')
        .eq('org_id', orgId)
        .order('list_date', { ascending: false })
      if (error) throw error
      return data as PriceList[]
    },
  })
}

export function useCreatePriceList(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: PriceListInput) => {
      const { data, error } = await supabase
        .from('price_lists')
        .insert({ ...input, org_id: orgId })
        .select()
        .single()
      if (error) throw error
      return data as PriceList
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['price_lists', orgId] }),
  })
}

export function useUpdatePriceList(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<PriceListInput> }) => {
      const { data, error } = await supabase
        .from('price_lists')
        .update(input)
        .eq('id', id)
        .eq('org_id', orgId)
        .select()
        .single()
      if (error) throw error
      return data as PriceList
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['price_lists', orgId] }),
  })
}

export type Category = Database['public']['Tables']['categories']['Row']
export type CategoryInput = Pick<Database['public']['Tables']['categories']['Insert'], 'name' | 'parent_id'>

export function useCategories(orgId: string) {
  return useQuery({
    queryKey: ['categories', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('org_id', orgId)
        .order('name')
      if (error) throw error
      return data as Category[]
    },
  })
}

export function useCreateCategory(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CategoryInput) => {
      const { data, error } = await supabase
        .from('categories')
        .insert({ ...input, org_id: orgId })
        .select()
        .single()
      if (error) throw error
      return data as Category
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['categories', orgId] }),
  })
}

export function useUpdateCategory(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<CategoryInput> }) => {
      const { data, error } = await supabase
        .from('categories')
        .update(input)
        .eq('id', id)
        .eq('org_id', orgId)
        .select()
        .single()
      if (error) throw error
      return data as Category
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['categories', orgId] }),
  })
}

export type Brand = Database['public']['Tables']['brands']['Row']
export type BrandInput = Pick<Database['public']['Tables']['brands']['Insert'], 'name'>

export function useBrands(orgId: string) {
  return useQuery({
    queryKey: ['brands', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('brands').select('*').eq('org_id', orgId).order('name')
      if (error) throw error
      return data as Brand[]
    },
  })
}

export function useCreateBrand(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: BrandInput) => {
      const { data, error } = await supabase
        .from('brands')
        .insert({ ...input, org_id: orgId })
        .select()
        .single()
      if (error) throw error
      return data as Brand
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['brands', orgId] }),
  })
}

export function useUpdateBrand(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<BrandInput> }) => {
      const { data, error } = await supabase
        .from('brands')
        .update(input)
        .eq('id', id)
        .eq('org_id', orgId)
        .select()
        .single()
      if (error) throw error
      return data as Brand
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['brands', orgId] }),
  })
}

export type UnitOfMeasure = Database['public']['Tables']['units_of_measure']['Row']
export type UnitOfMeasureInput = Pick<
  Database['public']['Tables']['units_of_measure']['Insert'],
  'name' | 'abbreviation'
>

export function useUnitsOfMeasure(orgId: string) {
  return useQuery({
    queryKey: ['units_of_measure', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('units_of_measure')
        .select('*')
        .eq('org_id', orgId)
        .order('name')
      if (error) throw error
      return data as UnitOfMeasure[]
    },
  })
}

export function useCreateUnitOfMeasure(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: UnitOfMeasureInput) => {
      const { data, error } = await supabase
        .from('units_of_measure')
        .insert({ ...input, org_id: orgId })
        .select()
        .single()
      if (error) throw error
      return data as UnitOfMeasure
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['units_of_measure', orgId] }),
  })
}

export function useUpdateUnitOfMeasure(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<UnitOfMeasureInput> }) => {
      const { data, error } = await supabase
        .from('units_of_measure')
        .update(input)
        .eq('id', id)
        .eq('org_id', orgId)
        .select()
        .single()
      if (error) throw error
      return data as UnitOfMeasure
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['units_of_measure', orgId] }),
  })
}

export type Area = Database['public']['Tables']['areas']['Row']
export type AreaInput = Pick<Database['public']['Tables']['areas']['Insert'], 'name' | 'region'>

export function useAreas(orgId: string) {
  return useQuery({
    queryKey: ['areas', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('areas').select('*').eq('org_id', orgId).order('name')
      if (error) throw error
      return data as Area[]
    },
  })
}

export function useCreateArea(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: AreaInput) => {
      const { data, error } = await supabase
        .from('areas')
        .insert({ ...input, org_id: orgId })
        .select()
        .single()
      if (error) throw error
      return data as Area
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['areas', orgId] }),
  })
}

export function useUpdateArea(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<AreaInput> }) => {
      const { data, error } = await supabase
        .from('areas')
        .update(input)
        .eq('id', id)
        .eq('org_id', orgId)
        .select()
        .single()
      if (error) throw error
      return data as Area
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['areas', orgId] }),
  })
}
