import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'

interface ToastItem {
  id: number
  message: string
  tone: 'success' | 'error'
}

interface ToastContextValue {
  success: (message: string) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const push = useCallback((message: string, tone: ToastItem['tone']) => {
    const id = nextId++
    setToasts((current) => [...current, { id, message, tone }])
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id))
    }, 4000)
  }, [])

  const value: ToastContextValue = {
    success: (message) => push(message, 'success'),
    error: (message) => push(message, 'error'),
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg ${
              t.tone === 'success'
                ? 'border-success-600/20 bg-white text-success-600'
                : 'border-danger-600/20 bg-white text-danger-600'
            }`}
          >
            {t.tone === 'success' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            <span className="text-text">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}
