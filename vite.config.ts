import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  server: { port: 5173, strictPort: false },
  // 라이브러리를 페이지 코드와 분리해 재방문 시 캐시된 번들만 다시 받아옵니다.
  // 워커 번들은 deploy.json 이 단일 파일을 가리키므로 쪼개지 않습니다.
  environments: {
    client: {
      build: {
        rollupOptions: {
          output: {
            manualChunks(id: string) {
              if (!id.includes('node_modules')) return undefined
              if (id.includes('lucide-react')) return 'icons'
              if (id.includes('motion') || id.includes('framer-motion')) return 'motion'
              if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/'))
                return 'react'
              return 'vendor'
            },
          },
        },
      },
    },
  },
})
