import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiKey = env.POLLINATIONS_API_KEY || ''

  return {
    server: {
      port: 5173,
      strictPort: false,
      proxy: {
        '/api/generate': {
          target: 'https://gen.pollinations.ai',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/generate/, '/image'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (apiKey) {
                proxyReq.setHeader('Authorization', `Bearer ${apiKey}`)
              }
            })
          },
        },
      },
    },
  }
})
