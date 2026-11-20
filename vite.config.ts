import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // globalThis lookup avoids pulling in @types/node just for this line
  base: (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.BASE_PATH || '/',
  plugins: [react()],
  build: { target: 'es2022', cssMinify: true },
  test: { environment: 'node' },
} as any)
