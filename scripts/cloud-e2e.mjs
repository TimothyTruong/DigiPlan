// End-to-end auth + sync check with the real supabase-js against a mocked Supabase server (no account needed).
// Usage: VITE_SUPABASE_URL=https://demo.supabase.co VITE_SUPABASE_ANON_KEY=test npx vite build --outDir /tmp/cloud-dist && npx vite preview --port 4175 --outDir /tmp/cloud-dist & node scripts/cloud-e2e.mjs
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
const B = process.env.BASE || 'http://localhost:4175', SB = 'https://demo.supabase.co'
const log = (...a) => console.log(...a)
const b = await chromium.launch()
const errs = []
const watch = (p) => { p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/demo\.supabase\.co\/auth\/v1\/authorize/.test(m.text()) && errs.push(m.text())) }

// 1+2: signed out → Google redirect URL, magic link
{
  const ctx = await b.newContext(); const p = await ctx.newPage(); watch(p)
  let otpBody
  await ctx.route(`${SB}/**`, async (r) => {
    const u = new URL(r.request().url())
    if (u.pathname === '/auth/v1/otp') { otpBody = JSON.parse(r.request().postData()); return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }) }
    if (u.pathname === '/auth/v1/authorize') return r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>google</h1>' })
    return r.fulfill({ status: 404, body: '{}' })
  })
  await p.goto(B + '/settings', { waitUntil: 'networkidle' })
  log('signed-out sidebar:', await p.textContent('.side-account'))
  await p.fill('input[aria-label="Email"]', 'tim@school.edu'); await p.click('button:has-text("Email me a link")')
  await p.waitForSelector('text=Check your inbox')
  log("otp request:", JSON.stringify({ email: otpBody.email, create: otpBody.create_user, pkce: !!otpBody.code_challenge, method: otpBody.code_challenge_method }))
  await p.click('button:has-text("Use a different email")')
  const [req] = await Promise.all([p.waitForRequest((r) => r.url().includes('/auth/v1/authorize')), p.click('button:has-text("Continue with Google")')])
  const au = new URL(req.url())
  log('google authorize:', JSON.stringify({ provider: au.searchParams.get('provider'), redirect_to: au.searchParams.get('redirect_to'), pkce: !!au.searchParams.get('code_challenge'), method: au.searchParams.get('code_challenge_method'), prompt: au.searchParams.get('prompt') }))
  await ctx.close()
}

// 3: signed in (stored session) → first-sign-in choice → upload → live edit pushes
{
  const ctx = await b.newContext(); const p = await ctx.newPage(); watch(p)
  const exp = Math.floor(Date.now() / 1000) + 3600
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const jwt = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: 'u-1', exp, role: 'authenticated', aud: 'authenticated' })}.sig`
  const session = { access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp, user: { id: 'u-1', aud: 'authenticated', email: 'tim@school.edu', user_metadata: { full_name: 'Tim Truong' }, app_metadata: { provider: 'google' } } }
  await ctx.addInitScript((s) => localStorage.setItem('petal-auth', s), JSON.stringify(session))
  const server = new Map(); let rev = 0; const pushes = []; let authHeader
  await ctx.route(`${SB}/**`, async (r) => {
    const u = new URL(r.request().url())
    authHeader = r.request().headers()['authorization']
    if (u.pathname === '/rest/v1/records') {
      const since = Number((u.searchParams.get('rev') ?? 'gt.0').slice(3))
      const rows = [...server.values()].filter((x) => x.rev > since).sort((a, b) => a.rev - b.rev)
      return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': `0-${rows.length}/*` }, body: JSON.stringify(rows) })
    }
    if (u.pathname === '/rest/v1/rpc/push_records') {
      const { rows } = JSON.parse(r.request().postData()); pushes.push(rows)
      const out = rows.map((x) => { const k = x.kind + ':' + x.id; const cur = server.get(k); if (cur && cur.updated_at > x.updated_at) return null; const row = { ...x, rev: ++rev }; server.set(k, row); return { kind: x.kind, id: x.id, rev: row.rev } }).filter(Boolean)
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) })
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await p.goto(B + '/', { waitUntil: 'networkidle' })
  await p.waitForSelector('text=Bring this planner into your account?', { timeout: 8000 })
  log('choice dialog shown (demo data + empty account)')
  await p.click('button:has-text("Upload what’s here")')
  await p.waitForFunction(() => document.querySelector('.side-account')?.getAttribute('title')?.startsWith('Synced'), null, { timeout: 8000 })
  log('first upload:', pushes.flat().length, 'records; kinds:', [...new Set(pushes.flat().map((x) => x.kind))].sort().join(','), '| bearer token sent:', authHeader?.startsWith('Bearer ey'))
  const before = pushes.length
  await p.click('a.nav-link:has-text("Tasks")'); await p.waitForTimeout(400)
  log('status before edit:', await p.getAttribute('.side-account', 'title'))
  await p.fill('input[placeholder^="＋ Quick add"]', 'Synced task tmrw'); await p.press('input[placeholder^="＋ Quick add"]', 'Enter')
  for (let i = 0; i < 10 && pushes.length === before; i++) await p.waitForTimeout(500)
  log('status after edit:', await p.getAttribute('.side-account', 'title'))
  const later = pushes.slice(before).flat()
  log('after edit push:', later.map((x) => `${x.kind}:${x.data?.title ?? ''}`).join(' | '))
  // Remote change from "another device" arrives on focus
  const r2 = { kind: 'item', id: 'remote-1', data: { id: 'remote-1', kind: 'task', title: 'Added on iPad', date: new Date().toISOString().slice(0, 10), createdAt: 0 }, deleted: false, updated_at: Date.now() + 1000, rev: ++rev }
  server.set('item:remote-1', r2)
  await p.evaluate(() => window.dispatchEvent(new Event('focus'))); await p.waitForTimeout(1500)
  log('remote item visible:', await p.isVisible('text=Added on iPad'))
  // Full reload: session + sync metadata must survive, and edits after reload must sync
  const n0 = pushes.length
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(800)
  log('after reload status:', await p.getAttribute('.side-account', 'title'), '| choice dialog?', await p.isVisible('text=Bring this planner'))
  await p.click('a.nav-link:has-text("Tasks")'); await p.waitForTimeout(300)
  await p.fill('input[placeholder^="＋ Quick add"]', 'After reload'); await p.press('input[placeholder^="＋ Quick add"]', 'Enter')
  for (let i = 0; i < 12 && !pushes.slice(n0).flat().some((x) => x.data?.title === 'After reload'); i++) await p.waitForTimeout(500)
  log('pushed after reload:', pushes.slice(n0).flat().map((x) => `${x.kind}:${x.data?.title ?? ''}`).join(' | '))
  await p.click('a.nav-link:has-text("Settings")'); await p.waitForTimeout(500)
  log('account card:', (await p.textContent('#account'))?.replace(/\s+/g, ' ').slice(100, 300))
  await p.click('#account button:has-text("Sign out")'); await p.click('.modal button.btn.primary:has-text("Sign out")'); await p.waitForTimeout(800)
  await p.click('a.nav-link:has-text("Tasks")'); await p.waitForTimeout(300)
  log('after sign-out: sidebar =', await p.textContent('.side-account'), '| tasks on device =', await p.locator('.lrow').count(), '| stored session =', await p.evaluate(() => !!localStorage.getItem('petal-auth')))
  await ctx.close()
}
await b.close()
log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no runtime/CSP errors')
