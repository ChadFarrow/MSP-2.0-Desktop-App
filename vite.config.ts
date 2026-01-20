import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy API calls to production server during development
      '/api': {
        target: 'https://msp.podtards.com',
        changeOrigin: true,
        secure: true
      }
    }
  }
})
