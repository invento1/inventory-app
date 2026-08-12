import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

interface UseBarcodeInputOptions<T> {
  lookup: (code: string) => T | undefined
  onMatch: (item: T) => void
  onNoMatch?: (code: string) => void
}

/**
 * Drives the "scan or type a code, press Enter" input used at the top of
 * the sale screen. A USB/Bluetooth barcode scanner behaves exactly like a
 * fast typist followed by an Enter keypress, so there's no need to detect
 * "scanner vs human" -- both cases just need an exact match on Enter.
 */
export function useBarcodeInput<T>({ lookup, onMatch, onNoMatch }: UseBarcodeInputOptions<T>) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function focus() {
    inputRef.current?.focus()
  }

  useEffect(() => {
    focus()
  }, [])

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const code = value.trim()
    if (!code) return

    const match = lookup(code)
    if (match) {
      onMatch(match)
      setValue('')
    } else {
      onNoMatch?.(code)
    }
  }

  return { value, setValue, inputRef, handleKeyDown, focus }
}
