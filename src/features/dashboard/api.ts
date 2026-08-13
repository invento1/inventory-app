import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'

export interface DashboardSummary {
  item_count: number
  low_stock_count: number
  today_sales_count: number
  today_sales_total: number
  outstanding_ar_total: number
  overdue_invoice_count: number
  customer_count: number
  revenue_this_week: number
  revenue_last_week: number
  outstanding_ap_total: number
  overdue_bill_count: number
}

export function useDashboardSummary(orgId: string) {
  return useQuery({
    queryKey: ['dashboard', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('dashboard_summary', { p_org_id: orgId })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      return row as DashboardSummary
    },
  })
}

export interface LowStockRow {
  item_id: string
  location_id: string
  quantity: number
  reorder_threshold: number
  item_name: string
  item_sku: string
  location_name: string
}

export function useLowStock(orgId: string) {
  return useQuery({
    queryKey: ['low_stock', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('low_stock_report')
        .select('item_id, location_id, quantity, reorder_threshold, items(name, sku), locations(name)')
        .eq('org_id', orgId)
      if (error) throw error
      return (data ?? []).map((row) => ({
        item_id: row.item_id ?? '',
        location_id: row.location_id ?? '',
        quantity: row.quantity ?? 0,
        reorder_threshold: row.reorder_threshold ?? 0,
        item_name: row.items?.name ?? '',
        item_sku: row.items?.sku ?? '',
        location_name: row.locations?.name ?? '',
      })) satisfies LowStockRow[]
    },
  })
}
