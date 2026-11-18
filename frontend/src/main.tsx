if (typeof window !== 'undefined') {
  const origWarn = console.warn
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('THREE.Clock: This module has been deprecated')) {
      return
    }
    origWarn.apply(console, args)
  }
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initBrowserEnv } from './utils/browserEnv'
import App from './App.tsx'

initBrowserEnv()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
