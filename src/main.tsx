import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { recoverPendingEdits } from './lib/autosave'

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
