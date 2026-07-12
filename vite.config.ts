import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        timeout: 600000,
        proxyTimeout: 600000,
      },
    },
  },
})
