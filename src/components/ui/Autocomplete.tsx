import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Search, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { fieldBase } from './fieldStyles'

// Searchable dropdown (ARIA combobox): type to filter by a case-insensitive
// substring anywhere in each option's search text, arrow keys to move, Enter
// to pick, Esc to close. Two modes:
//
//   * select (default): a form field bound to `value` (the chosen key). The
//     input shows the chosen option's label; editing the text clears the
//     choice; blurring without picking restores the last valid label.
//   * action (`clearOnPick`): a command input -- picking calls onPick and
//     empties the box (e.g. "scan or search to add an item").
//
// `resolveExact` lets Enter pick an exact code match (barcode/SKU) straight
// away, even while other options also contain the typed text -- which is how
// a USB barcode scanner (fast typing + Enter) lands on the right item.
//
// The option list is portalled to <body> with fixed positioning, so it isn't
// clipped by overflow containers such as scrollable line-item tables.

export interface AutocompleteHandle {
  focus: () => void
  clear: () => void
}

interface AutocompleteProps<T> {
  label?: string
  items: T[]
  getKey: (item: T) => string
  getLabel: (item: T) => string
  getDescription?: (item: T) => ReactNode
  getSearchText: (item: T) => string
  value?: string
  onChange?: (key: string, item: T | undefined) => void
  onPick?: (item: T) => void
  clearOnPick?: boolean
  resolveExact?: (query: string) => T | undefined
  onNoMatch?: (query: string) => void
  placeholder?: string
  required?: boolean
  disabled?: boolean
  maxResults?: number
  emptyText?: string
  showSearchIcon?: boolean
  className?: string
}

function AutocompleteInner<T>(
  {
    label,
    items,
    getKey,
    getLabel,
    getDescription,
    getSearchText,
    value = '',
    onChange,
    onPick,
    clearOnPick = false,
    resolveExact,
    onNoMatch,
    placeholder,
    required,
    disabled,
    maxResults = 50,
    emptyText = 'No matches',
    showSearchIcon = false,
    className,
  }: AutocompleteProps<T>,
  ref: React.ForwardedRef<AutocompleteHandle>,
) {
  const inputId = useId()
  const listboxId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const selected = useMemo(() => items.find((i) => getKey(i) === value), [items, value, getKey])
  const selectedLabel = selected ? getLabel(selected) : ''

  const [text, setText] = useState(selectedLabel)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)

  // Keep the box in sync with the bound value (select mode), e.g. when the
  // parent picks a customer via quick-add or the item list loads -- except
  // right after typing un-chose the option, which must not wipe the text
  // being typed.
  const skipSync = useRef(false)
  useEffect(() => {
    if (clearOnPick) return
    if (skipSync.current) {
      skipSync.current = false
      return
    }
    setText(selectedLabel)
  }, [selectedLabel, clearOnPick])

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    clear: () => setText(''),
  }))

  const query = text.trim().toLowerCase()
  const showingSelection = !clearOnPick && !!selected && text === selectedLabel
  const results = useMemo(() => {
    if (!query || showingSelection) return items.slice(0, maxResults)
    return items.filter((i) => getSearchText(i).toLowerCase().includes(query)).slice(0, maxResults)
  }, [items, query, showingSelection, getSearchText, maxResults])

  useEffect(() => setActive(0), [query])

  // Position the portalled list under the input; follow scrolls/resizes.
  const reposition = useCallback(() => {
    if (inputRef.current) setRect(inputRef.current.getBoundingClientRect())
  }, [])
  useLayoutEffect(() => {
    if (!open) return
    reposition()
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open, reposition])

  // Keep the highlighted option scrolled into view.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  function pick(item: T) {
    if (clearOnPick) {
      setText('')
      onPick?.(item)
      setOpen(false)
      requestAnimationFrame(() => inputRef.current?.focus())
      return
    }
    setText(getLabel(item))
    onChange?.(getKey(item), item)
    onPick?.(item)
    setOpen(false)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) setOpen(true)
      else if (results.length) setActive((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (results.length) setActive((i) => (i - 1 + results.length) % results.length)
    } else if (e.key === 'Enter') {
      // A command box never submits its surrounding form.
      if (clearOnPick) e.preventDefault()
      const raw = text.trim()
      const exact = raw ? resolveExact?.(raw) : undefined
      if (exact) {
        e.preventDefault()
        pick(exact)
      } else if (open && results[active] && (query || !clearOnPick)) {
        e.preventDefault()
        pick(results[active])
      } else if (raw) {
        e.preventDefault()
        onNoMatch?.(raw)
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
      } else if (clearOnPick && text) {
        e.preventDefault()
        setText('')
      }
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  function onBlur() {
    setOpen(false)
    // Select mode: never leave half-typed text that doesn't match the value.
    if (!clearOnPick && text !== selectedLabel) setText(selectedLabel)
  }

  const expanded = open && !disabled

  return (
    <div className={cn('flex flex-col gap-1.5 text-sm', className)}>
      {label && (
        <label htmlFor={inputId} className="font-medium text-text">
          {label}
          {required && <span className="text-danger-600"> *</span>}
        </label>
      )}
      <div className="relative">
        {showSearchIcon && (
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle"
          />
        )}
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={expanded && results[active] ? `${listboxId}-${active}` : undefined}
          aria-required={required}
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setOpen(true)
            // Editing the text of a chosen option un-chooses it.
            if (!clearOnPick && value) {
              skipSync.current = true
              onChange?.('', undefined)
            }
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          className={cn(fieldBase, 'h-10 w-full pr-8', showSearchIcon ? 'pl-9' : 'pl-3')}
        />
        {text && !disabled && (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Clear"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setText('')
              if (!clearOnPick && value) onChange?.('', undefined)
              setOpen(true)
              inputRef.current?.focus()
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-subtle hover:text-text"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {expanded &&
        rect &&
        createPortal(
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            style={{ position: 'fixed', top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 240) }}
            className="z-[60] max-h-72 overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-card-hover motion-safe:animate-fade-in"
          >
            {results.length === 0 ? (
              <li className="px-3 py-2 text-sm text-text-muted">{emptyText}</li>
            ) : (
              results.map((item, i) => (
                <li
                  key={getKey(item)}
                  id={`${listboxId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  // Keep focus in the input so blur doesn't close before the click lands.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(item)}
                  className={cn(
                    'cursor-pointer px-3 py-2 text-sm',
                    i === active ? 'bg-accent-50 text-accent-700' : 'text-text',
                    !clearOnPick && getKey(item) === value && 'font-semibold',
                  )}
                >
                  <span className="block truncate">{getLabel(item)}</span>
                  {getDescription && (
                    <span className="block truncate text-xs text-text-muted">{getDescription(item)}</span>
                  )}
                </li>
              ))
            )}
          </ul>,
          document.body,
        )}
    </div>
  )
}

// forwardRef with generics.
export const Autocomplete = forwardRef(AutocompleteInner) as <T>(
  props: AutocompleteProps<T> & { ref?: React.Ref<AutocompleteHandle> },
) => ReturnType<typeof AutocompleteInner>
