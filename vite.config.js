import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  
  // Detect available providers based on environment variables
  // Pollinations is always available (works even without API key)
  const availableProviders = ['pollinations']
  if (env.GEMINI_API_KEY) {
    availableProviders.push('gemini')
  }
  if (env.OPENAI_API_KEY) {
    availableProviders.push('openai')
  }

  const proxyConfig = {}

  // Pollinations proxy (main provider, always available)
  proxyConfig['/api/pollinations'] = {
    target: 'https://gen.pollinations.ai',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/pollinations/, '/image'),
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq) => {
        const apiKey = env.POLLINATIONS_API_KEY || ''
        if (apiKey) {
          proxyReq.setHeader('Authorization', `Bearer ${apiKey}`)
        }
      })
    },
  }

  // Gemini proxy (if API key provided)
  if (availableProviders.includes('gemini')) {
    proxyConfig['/api/gemini'] = {
      target: 'https://generativelanguage.googleapis.com',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api\/gemini/, '/v1beta'),
      configure: (proxy) => {
        proxy.on('proxyReq', (proxyReq, req) => {
          // Add API key as query parameter for Gemini
          const url = new URL(req.url, 'http://localhost')
          url.searchParams.set('key', env.GEMINI_API_KEY)
          proxyReq.path = url.pathname + url.search
        })
      },
    }
  }

  // OpenAI proxy (if API key provided)
  if (availableProviders.includes('openai')) {
    proxyConfig['/api/openai'] = {
      target: 'https://api.openai.com',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api\/openai/, '/v1'),
      configure: (proxy) => {
        proxy.on('proxyReq', (proxyReq) => {
          proxyReq.setHeader('Authorization', `Bearer ${env.OPENAI_API_KEY}`)
        })
      },
    }
  }

  // Backward compatibility: /api/generate → pollinations
  proxyConfig['/api/generate'] = proxyConfig['/api/pollinations']

  return {
    server: {
      port: 5173,
      strictPort: false,
      proxy: proxyConfig,
    },
    define: {
      // Inject available providers into client code
      '__AVAILABLE_PROVIDERS__': JSON.stringify(availableProviders),
    },
  }
})
