import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Send API and image requests to the local Worker (`pnpm dev` in backend/) so `pnpm dev` here shows real admin data
    proxy: {
      '/api': 'http://localhost:8787',
      '/assets': 'http://localhost:8787',
    },
  },
  build: {
    sourcemap: false,
    modulePreload: {
      resolveDependencies: (_filename, deps) => deps.filter(dep => !dep.includes('vendor-three')),
    },
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[hash].js',
        chunkFileNames: 'assets/[hash].js',
        assetFileNames: 'assets/[hash][extname]',
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/scheduler/')
          ) {
            return 'vendor-react'
          }
          if (
            id.includes('node_modules/three/') ||
            id.includes('node_modules/three-stdlib/') ||
            id.includes('node_modules/@react-three/fiber/') ||
            id.includes('node_modules/@react-three/drei/')
          ) {
            return 'vendor-three'
          }
        },
      },
    },
  },
})
