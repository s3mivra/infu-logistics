import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
