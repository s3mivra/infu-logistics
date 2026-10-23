import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Unit tests only; e2e/ holds Playwright specs (npm run e2e).
  test: { exclude: ['e2e/**', 'node_modules/**', 'dist/**'] },
  server: {
    host: '0.0.0.0',
    port: 3000
  },
  build: {
    // jspdf/jspdf-autotable (~150KB+) are loaded via dynamic import() in
    // AdminDashboard (loadPdfLibs), so vite emits them as a lazy async chunk that's
    // only fetched when a PDF is generated — not on initial dashboard load.
    chunkSizeWarningLimit: 800
  }
})
