import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Portas: definidas no package.json da raiz via `bun run dev` (env CLIENT_PORT / VITE_SERVER_PORT).
const serverPort = Number(process.env.VITE_SERVER_PORT ?? 18080)
const clientPort = Number(process.env.CLIENT_PORT ?? 15173)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: clientPort,
    strictPort: true,
    proxy: {
      '/api': `http://localhost:${serverPort}`
    }
  }
})
