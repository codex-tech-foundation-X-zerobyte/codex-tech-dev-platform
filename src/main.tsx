import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './styles.css'
import { initTheme } from './lib/theme'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { initSelfMonitor } from './lib/selfMonitor'

initTheme()
initSelfMonitor()
createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>)
