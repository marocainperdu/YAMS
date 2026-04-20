import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // REST API — strip /api prefix so backend routes still work bare (e.g. /servers)
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // WebSocket console — proxied to the same backend port on /ws
      '/ws': {
        target: process.env.VITE_API_URL || 'http://localhost:3000',
        ws: true,
      },
    },
  },
})
