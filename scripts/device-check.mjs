// Responsive layout checker for iPhone/iPad sizes (Chromium emulation — not real Safari/WebKit).
// Usage: npm run build && npx vite preview --port 4173 & node scripts/device-check.mjs [outDir] [--only=iPhone]
// Writes <outDir>/<device>/<page>.png and <outDir>/report.json; prints a summary. Exit code 1 if any errors.
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
const pw = createRequire(import.meta.url)('playwright')
const { chromium, devices } = pw

const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--')) || 'screenshots/devices'
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7)
const BASE = process.env.BASE || 'http://localhost:4173'

const custom = (w, h) => ({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' })
const strip = ({ defaultBrowserType, ...d }) => d // eslint-disable-line no-unused-vars
export const DEVICES = {
  'iphone-se': strip(devices['iPhone SE (3rd gen)']),
  'iphone-15': strip(devices['iPhone 15']),
  'iphone-15-pro-max': strip(devices['iPhone 15 Pro Max']),
  'iphone-15-landscape': strip(devices['iPhone 15 landscape']),
  'ipad-mini': strip(devices['iPad Mini']),
  'ipad-mini-landscape': strip(devices['iPad Mini landscape']),
  'ipad-air': custom(820, 1180),
  'ipad-air-landscape': custom(1180, 820),
  'ipad-pro-13': custom(1024, 1366),
  'ipad-pro-13-landscape': custom(1366, 1024),
}

// "+" is a floating button on tablet/desktop and lives in the tab bar on phones.
const add = async (p) => { if (await p.locator('.side-add').isVisible()) await p.click('.side-add'); else await p.click('.bar-add') }
// Each scenario: navigate, optionally act, then audit.
const SCENARIOS = [
  { name: 'today', path: '/' },
  { name: 'calendar-month', path: '/calendar' },
  { name: 'calendar-week', path: '/calendar', act: (p) => p.click('button[role=radio]:has-text("Week")') },
  { name: 'calendar-list', path: '/calendar', act: (p) => p.click('button[role=radio]:has-text("List")') },
  { name: 'tasks', path: '/tasks' },
  { name: 'classes', path: '/classes' },
  { name: 'class-notes', path: '/classes', act: (p) => p.click('.course-card') },
  { name: 'class-grades', path: '/classes', act: async (p) => { await p.click('.course-card'); await p.click('button[role=radio]:has-text("Grades")') } },
  { name: 'recipes', path: '/meals' },
  { name: 'recipe-view', path: '/meals', act: (p) => p.click('.recipe-card') },
  { name: 'meal-plan', path: '/meals', act: (p) => p.click('button[role=radio]:has-text("Week plan")') },
  { name: 'fitness', path: '/fitness' },
  { name: 'habits', path: '/habits' },
  { name: 'budget', path: '/budget' },
  { name: 'settings', path: '/settings' },
  { name: 'more-sheet', path: '/', act: async (p) => { if (await p.locator('.more-btn').isVisible()) await p.click('.more-btn') } },
  { name: 'editor', path: '/calendar', act: add },
  { name: 'editor-assignment', path: '/tasks', act: async (p) => { await add(p); await p.click('.modal button[role=radio]:has-text("Assignment")'); await p.click('.modal summary') } },
  { name: 'style-picker', path: '/', act: (p) => p.click('.page-icon') },
]

/** Runs in the page. Returns a list of problems. */
function audit() {
  const vw = document.documentElement.clientWidth
  const vh = window.innerHeight
  const problems = []
  const desc = (el) => {
    const t = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 40)
    const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
    return `${el.tagName.toLowerCase()}${cls}${t ? ` "${t}"` : ''}`
  }
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    if (el.checkVisibility && !el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) return false
    if (el.closest('details:not([open])') && !el.closest('summary')) return false
    const s = getComputedStyle(el)
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05 && !el.closest('.sr-only, [aria-hidden=true], #__cap, #__tag, #__cur')
  }
  const inScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p)
      if (/(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth) return p
      if (/(hidden|clip)/.test(s.overflowX)) return p
    }
    return null
  }
  const modal = document.querySelector('.modal')
  const scope = modal ?? document

  // 1. Horizontal page overflow
  const sw = document.documentElement.scrollWidth
  if (sw > vw + 1) {
    const culprits = [...document.querySelectorAll('body *')].filter((el) => visible(el) && el.getBoundingClientRect().right > vw + 1 && !inScroller(el))
      .filter((el) => !culprits0(el)).slice(0, 4).map(desc)
    problems.push({ level: 'error', kind: 'h-overflow', msg: `page is ${sw}px wide in a ${vw}px viewport`, items: culprits })
  }
  function culprits0(el) { return el.parentElement && el.parentElement.getBoundingClientRect().right > vw + 1 && !inScroller(el.parentElement) }

  // 2. Overlapping interactive elements (siblings that collide)
  const inter = [...scope.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=gridcell]')]
    .filter((el) => visible(el) && !(modal && !modal.contains(el)))
  const rects = inter.map((el) => el.getBoundingClientRect())
  const overlaps = []
  for (let i = 0; i < inter.length; i++) for (let j = i + 1; j < inter.length; j++) {
    const a = inter[i], b = inter[j]
    if (a.contains(b) || b.contains(a)) continue
    if (a.closest('label') && a.closest('label') === b.closest('label')) continue
    const ra = rects[i], rb = rects[j]
    const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left)
    const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
    if (w > 3 && h > 3) {
      // Ignore if either is fixed chrome (FAB/mobile bar) — handled by check 4 at end of scroll
      // Fixed/sticky chrome legitimately floats over scrolling content; checked separately (auditBottom / modal end)
      const fixed = (el) => !!el.closest('.fab, .mobile-bar, .toast, .more-sheet, .sidebar') || (!!el.closest('.modal-foot') && getComputedStyle(el.closest('.modal-foot')).position === 'sticky')
      if (fixed(a) !== fixed(b)) continue
      overlaps.push(`${desc(a)} ↔ ${desc(b)} (${Math.round(w)}×${Math.round(h)})`)
    }
  }
  if (overlaps.length) problems.push({ level: 'error', kind: 'overlap', msg: `${overlaps.length} overlapping controls`, items: overlaps.slice(0, 6) })

  // 3. Small touch targets (Apple HIG: 44pt; we flag < 32 as error, < 40 as warning)
  const tiny = [], small = []
  inter.forEach((el, i) => {
    const r = rects[i]
    if (el.matches('.evt') || el.closest('.md')) return // calendar chips are tap-through to the day cell on phones; inline links in prose are exempt
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') return
    // .check draws a 26px box but its ::before extends the tap area by 9px per side (see global.css)
    const hit = el.matches('.check') && getComputedStyle(el, '::before').content !== 'none' ? 18 : 0
    const m = Math.min(r.width, r.height) + hit
    if (m < 32) tiny.push(`${desc(el)} ${Math.round(r.width)}×${Math.round(r.height)}`)
    else if (m < 40) small.push(desc(el))
  })
  if (tiny.length) problems.push({ level: 'error', kind: 'tap-target', msg: `${tiny.length} tap targets under 32px`, items: [...new Set(tiny)].slice(0, 6) })
  if (small.length > 8) problems.push({ level: 'warn', kind: 'tap-target', msg: `${small.length} tap targets 32–40px` })

  // 4. Text spilling out of its box (not ellipsized, not scrollable)
  const spill = []
  for (const el of scope.querySelectorAll('h1, h2, h3, button, .chip, .lrow-title, .stat .v, .cd .n, label, .cal-title, .page-sub, td, .mh')) {
    if (!visible(el)) continue
    const s = getComputedStyle(el)
    if (s.textOverflow === 'ellipsis' || /(auto|scroll|hidden|clip)/.test(s.overflowX)) continue
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) spill.push(`${desc(el)} (${el.scrollWidth}>${el.clientWidth})`)
  }
  if (spill.length) problems.push({ level: 'warn', kind: 'text-spill', msg: `${spill.length} elements with overflowing text`, items: spill.slice(0, 6) })

  // 5. Every control needs an accessible name (icon-only rail links, emoji buttons)
  const unnamed = inter.filter((el) => /^(A|BUTTON)$/.test(el.tagName) && !(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent.replace(/[\p{Extended_Pictographic}\uFE0F\u200D\s]/gu, '') || el.querySelector('img[alt]:not([alt=""])')))
  if (unnamed.length) problems.push({ level: 'error', kind: 'a11y-name', msg: `${unnamed.length} buttons/links without a text name`, items: unnamed.slice(0, 5).map(desc) })

  // 6. Segmented controls must stay on one line (a wrapped pill looks broken)
  const wrapped = [...scope.querySelectorAll('.seg')].filter((sg) => visible(sg) && getComputedStyle(sg).display !== 'grid' && new Set([...sg.children].map((c) => Math.round(c.getBoundingClientRect().top))).size > 1)
  if (wrapped.length) problems.push({ level: 'warn', kind: 'seg-wrap', msg: `${wrapped.length} segmented control(s) wrap onto two lines`, items: wrapped.map(desc) })

  // 7. The floating "+" must not cover controls on the first screen
  const fab = document.querySelector('.fab')
  if (!modal && fab && visible(fab)) {
    const fr = fab.getBoundingClientRect()
    const under = inter.filter((el) => !fab.contains(el)).filter((el) => { const r = el.getBoundingClientRect(); return Math.min(r.right, fr.right) - Math.max(r.left, fr.left) > 6 && Math.min(r.bottom, fr.bottom) - Math.max(r.top, fr.top) > 6 })
    if (under.length) problems.push({ level: 'error', kind: 'fab-cover', msg: `floating + covers ${under.length} control(s) on first screen`, items: under.slice(0, 4).map(desc) })
  }

  // 8. Modal must fit: header and footer reachable, not wider than viewport
  if (modal) {
    const r = modal.getBoundingClientRect()
    if (r.width > vw + 1) problems.push({ level: 'error', kind: 'modal', msg: `modal ${Math.round(r.width)}px wider than viewport` })
    if (r.top < -1 || r.bottom > vh + 1) problems.push({ level: 'error', kind: 'modal', msg: `modal extends outside viewport (top ${Math.round(r.top)}, bottom ${Math.round(r.bottom)}, vh ${vh})` })
    // Scrolled to the end, nothing may remain hidden under a sticky footer
    const foot = modal.querySelector('.modal-foot')
    if (foot && getComputedStyle(foot).position === 'sticky') {
      modal.scrollTop = modal.scrollHeight
      const fr = foot.getBoundingClientRect()
      const hidden = [...modal.querySelectorAll('button, input, select, textarea, a[href], h3, label')].filter((el) => !foot.contains(el) && visible(el)).filter((el) => {
        const er = el.getBoundingClientRect(); return er.bottom > fr.top + 4 && er.top < fr.bottom
      }).map(desc)
      if (hidden.length) problems.push({ level: 'error', kind: 'modal', msg: 'content stuck under sticky footer at end of scroll', items: hidden.slice(0, 4) })
      modal.scrollTop = 0
    }
  }
  return problems
}

/** At the bottom of the page, nothing should hide under fixed chrome (FAB, bottom bar). */
function auditBottom() {
  const problems = []
  const chrome = [...document.querySelectorAll('.fab, .mobile-bar')].filter((el) => el.getBoundingClientRect().height > 0)
  const covered = []
  for (const el of document.querySelectorAll('main button, main a[href], main input, main select, main textarea, main .lrow-title, main h3')) {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight) continue
    for (const c of chrome) {
      const cr = c.getBoundingClientRect()
      const w = Math.min(r.right, cr.right) - Math.max(r.left, cr.left)
      const h = Math.min(r.bottom, cr.bottom) - Math.max(r.top, cr.top)
      if (w > 6 && h > 6) covered.push(`${(el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30)} under ${c.className.split(' ')[0]}`)
    }
  }
  if (covered.length) problems.push({ level: 'error', kind: 'covered', msg: `${covered.length} items hidden under fixed chrome at end of page`, items: [...new Set(covered)].slice(0, 5) })
  return problems
}

const browser = await chromium.launch()
const report = {}
let errors = 0
for (const [dname, desc] of Object.entries(DEVICES)) {
  if (ONLY && !dname.includes(ONLY)) continue
  mkdirSync(`${OUT}/${dname}`, { recursive: true })
  const ctx = await browser.newContext({ ...desc, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  const jsErrors = []
  page.on('pageerror', (e) => jsErrors.push(e.message))
  report[dname] = {}
  for (const sc of SCENARIOS) {
    try {
      await page.goto(BASE + sc.path, { waitUntil: 'networkidle' })
      if (sc.act) { await sc.act(page); await page.waitForTimeout(250) }
      await page.waitForTimeout(150)
      const probs = await page.evaluate(audit)
      await page.screenshot({ path: `${OUT}/${dname}/${sc.name}.png` })
      if (!(await page.$('.modal'))) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await page.waitForTimeout(150)
        probs.push(...(await page.evaluate(auditBottom)))
        await page.evaluate(() => window.scrollTo(0, 0))
      }
      if (jsErrors.length) probs.push({ level: 'error', kind: 'js', msg: jsErrors.splice(0).join(' | ') })
      report[dname][sc.name] = probs
      errors += probs.filter((p) => p.level === 'error').length
    } catch (e) {
      report[dname][sc.name] = [{ level: 'error', kind: 'scenario', msg: e.message.split('\n')[0] }]
      errors++
    }
  }
  await ctx.close()
}
await browser.close()
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2))

for (const [d, pages] of Object.entries(report)) {
  const lines = Object.entries(pages).flatMap(([pg, probs]) => probs.map((p) => `  ${p.level === 'error' ? '✖' : '⚠'} ${pg}: ${p.kind} — ${p.msg}${p.items?.length ? `\n      ${p.items.join('\n      ')}` : ''}`))
  console.log(`${lines.length ? '✖' : '✓'} ${d}${lines.length ? '' : ' — clean'}`)
  if (lines.length) console.log(lines.join('\n'))
}
console.log(`\n${errors} error(s). Screenshots + report.json in ${OUT}/`)
process.exit(errors ? 1 : 0)
