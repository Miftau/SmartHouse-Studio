import path from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '')
  const neonAuthUrl = env.VITE_NEON_AUTH_URL || env.NEON_AUTH_BASE_URL || ''
  const apiBase = env.VITE_API_BASE || env.API_BASE_URL || ''

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_NEON_AUTH_URL': JSON.stringify(neonAuthUrl),
      'import.meta.env.VITE_API_BASE': JSON.stringify(apiBase),
    },
  }
})
