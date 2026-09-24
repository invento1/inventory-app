import { useLocations } from '../../lib/useLocations'
import { useCategories, type Category } from '../settings/api'
import { useSuppliers } from '../suppliers/api'

export interface FilterOption {
  value: string
  label: string
}

// Categories are hierarchical; label each option with its full path
// ("Electronics › Fans") so same-named sub-categories stay distinguishable.
// Report RPCs include a category's sub-categories when filtering by it.
function categoryPaths(categories: Category[]): FilterOption[] {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const path = (c: Category): string => {
    const names = [c.name]
    let parent = c.parent_id ? byId.get(c.parent_id) : undefined
    // Guard against a malformed cycle.
    for (let depth = 0; parent && depth < 10; depth++) {
      names.unshift(parent.name)
      parent = parent.parent_id ? byId.get(parent.parent_id) : undefined
    }
    return names.join(' › ')
  }
  return categories.map((c) => ({ value: c.id, label: path(c) })).sort((a, b) => a.label.localeCompare(b.label))
}

export function useCategoryOptions(orgId: string): FilterOption[] {
  const { data } = useCategories(orgId)
  return categoryPaths(data ?? [])
}

export function useLocationOptions(orgId: string): FilterOption[] {
  const { data } = useLocations(orgId)
  return (data ?? []).map((l) => ({ value: l.id, label: l.name }))
}

export function useSupplierOptions(orgId: string): FilterOption[] {
  const { data } = useSuppliers(orgId)
  return (data ?? []).map((s) => ({ value: s.id, label: s.name }))
}
