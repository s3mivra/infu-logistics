import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { registerServiceWorker, initInstallPrompt } from './shared/pwa'
import { installEnterKeyNav } from './shared/enterKeyNav'

// PWA: capture the install prompt early, then register the service worker.
initInstallPrompt()
registerServiceWorker()

// Enter key moves focus to the next field, app-wide (both business types).
installEnterKeyNav()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
