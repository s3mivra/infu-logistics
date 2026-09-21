import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { registerServiceWorker, initInstallPrompt } from './shared/pwa'
import { startAutoUpdate } from './shared/autoUpdate'
import { installEnterKeyNav } from './shared/enterKeyNav'

// PWA: capture the install prompt early, then register the service worker.
initInstallPrompt()
registerServiceWorker()
// A till left open all day moves to a new version by itself, when it is idle.
startAutoUpdate()

// Enter key moves focus to the next field, app-wide (both business types).
installEnterKeyNav()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
