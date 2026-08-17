import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000'
  const productionApiOrigin = (process.env.VITE_API_BASE_URL || env.VITE_API_BASE_URL || '').trim()

  if (command === 'build' && process.env.VERCEL === '1') {
    if (!productionApiOrigin) {
      throw new Error('VITE_API_BASE_URL must be set to the public Modal API origin before a Vercel build.')
    }
    const parsedApiOrigin = new URL(productionApiOrigin)
    if (
      parsedApiOrigin.protocol !== 'https:' ||
      parsedApiOrigin.username ||
      parsedApiOrigin.password ||
      !parsedApiOrigin.hostname ||
      !['', '/'].includes(parsedApiOrigin.pathname) ||
      parsedApiOrigin.search ||
      parsedApiOrigin.hash
    ) {
      throw new Error('VITE_API_BASE_URL must be an HTTPS origin without a path, query, or fragment.')
    }
  }

  return {
    // The FE is deployed as an independent site (Vercel/Netlify root).
    base: '/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': `${import.meta.dirname}/src`,
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  }
})
