export type Theme = 'light' | 'dark'
const KEY = 'codex-theme'

export function getTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* storage unavailable */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
export function applyTheme(t: Theme) { document.documentElement.dataset.theme = t }
export function setTheme(t: Theme) {
  try { localStorage.setItem(KEY, t) } catch { /* storage unavailable */ }
  applyTheme(t)
}
export function initTheme() { applyTheme(getTheme()) }
