import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { WorldProvider } from './lib/world'

// `?today=2026-10-07` pins the date, which keeps demos and tests reproducible
const pinned = new URLSearchParams(location.search).get('today')
const today = pinned && /^\d{4}-\d{2}-\d{2}$/.test(pinned) ? pinned : undefined

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorldProvider today={today}>
      <App />
    </WorldProvider>
  </StrictMode>,
)
