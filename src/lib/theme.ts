import { useSyncExternalStore } from 'react'

// Light / dark theme (Settings -> Appearance). The theme is a
// data-theme="dark" attribute on <html>; index.css swaps every colour token
// under it. The choice is cached in localStorage so index.html can apply it
// before the first paint (no white flash), and synced to the user's account
// through user_preferences (see ThemeSync in AppLayout).

export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'hashirhub:theme'
export const THEME_PREFERENCE_KEY = 'appearance.theme'

// Browser/phone chrome colour (the <meta name="theme-color"> tag).
const CHROME_COLOR: Record<Theme, string> = { light: '#0f172a', dark: '#080c18' }

const listeners = new Set<() => void>()

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

function setAttribute(theme: Theme) {
  const root = document.documentElement
  if (theme === 'dark') root.dataset.theme = 'dark'
  else delete root.dataset.theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME_COLOR[theme])
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Private mode etc.: the theme still applies for this visit.
  }
  listeners.forEach((l) => l())
}

// Applies a theme. With `origin` (a click position) and a browser that
// supports View Transitions, the new theme is revealed as a circle growing
// from that point; otherwise it switches instantly.
export function applyTheme(theme: Theme, origin?: { x: number; y: number }) {
  if (theme === currentTheme()) return
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!origin || reduceMotion || typeof document.startViewTransition !== 'function') {
    setAttribute(theme)
    return
  }
  const transition = document.startViewTransition(() => setAttribute(theme))
  const radius = Math.hypot(
    Math.max(origin.x, window.innerWidth - origin.x),
    Math.max(origin.y, window.innerHeight - origin.y),
  )
  transition.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${origin.x}px ${origin.y}px)`, `circle(${radius}px at ${origin.x}px ${origin.y}px)`] },
        { duration: 520, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
      )
    })
    .catch(() => {})
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, currentTheme, () => 'light')
}

// For code that paints colours itself (the dashboard tile canvases): run the
// callback whenever the theme changes.
export function onThemeChange(listener: () => void) {
  return subscribe(listener)
}
