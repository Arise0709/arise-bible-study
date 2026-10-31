import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted fonts (open-source, OFL). Browsers download only the character sets a page uses.
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/literata/wght.css'
import '@fontsource-variable/literata/wght-italic.css'
import '@fontsource/noto-serif-hebrew/hebrew-400.css'
import '@fontsource/noto-serif-hebrew/hebrew-600.css'
import './index.css'
import App from './App.tsx'
import { recoverPendingEdits } from './lib/autosave'
import { installErrorReporting } from './lib/errorReport'
import { registerServiceWorker } from './lib/offline'

installErrorReporting()
registerServiceWorker()

// Restore any edit that was typed but not saved before the page last closed, then start the app.
recoverPendingEdits()
  .catch(() => 0)
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
