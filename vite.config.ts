import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// globalThis lookup avoids pulling in @types/node just for env access
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}

/**
 * Content-Security-Policy for production builds (GitHub Pages can't send headers, so it's a <meta>).
 * Main point: no inline or third-party scripts except Google's sign-in library, which limits what an XSS bug
 * could do with the session stored in the browser. Not applied in dev (Vite's HMR needs inline scripts/websockets).
 */
const supabaseOrigin = (() => { try { return env.VITE_SUPABASE_URL ? new URL(env.VITE_SUPABASE_URL).origin : '' } catch { return '' } })()
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  `connect-src 'self' https://www.googleapis.com https://accounts.google.com https://oauth2.googleapis.com https://www.themealdb.com${supabaseOrigin ? ` ${supabaseOrigin} ${supabaseOrigin.replace('https://', 'wss://')}` : ''}`,
  'frame-src https://accounts.google.com',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

const csp = (): Plugin => ({
  name: 'petal-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
})

export default defineConfig({
  base: env.BASE_PATH || '/',
  plugins: [react(), csp()],
  build: { target: 'es2022', cssMinify: true },
  test: { environment: 'node' },
} as any)
