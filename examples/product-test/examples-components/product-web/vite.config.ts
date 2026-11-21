import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Ports come from the product-test project package.json > config, propagated
// by its scripts/dev.ts (CLIENT_PORT / API_PORT). Fallbacks keep standalone
// `bun run dev` here working with the documented defaults.
const clientPort = Number(process.env.CLIENT_PORT ?? 15174)
const apiPort = process.env.API_PORT ?? '18081'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: clientPort,
    strictPort: true,
    proxy: {
      '/api': `http://localhost:${apiPort}`
    }
  }
})
