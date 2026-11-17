// Usage: npm run build && npx vite preview --port 4173 & node scripts/screenshots.mjs [outDir]
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright') // globally installed in CI/sandbox
const out = process.argv[2] || 'screenshots'
const base = process.env.BASE || 'http://localhost:4173'
const routes = ['/', '/calendar', '/tasks', '/classes', '/meals', '/fitness', '/habits', '/budget', '/settings']
const browser = await chromium.launch()
const errors = []
for (const [label, vp, dark] of [['desktop', { width: 1440, height: 1000 }, false], ['dark', { width: 1440, height: 1000 }, true], ['mobile', { width: 390, height: 844 }, false]]) {
  const ctx = await browser.newContext({ viewport: vp, colorScheme: dark ? 'dark' : 'light', deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`${label} console: ${m.text()}`))
  for (const r of (label === 'dark' ? ['/', '/calendar', '/classes'] : routes)) {
    await page.goto(base + r, { waitUntil: 'networkidle' })
    await page.waitForTimeout(250)
    await page.screenshot({ path: `${out}/${label}${r === '/' ? '-today' : r.replace(/\//g, '-')}.png`, fullPage: true })
  }
  if (label === 'desktop') {
    await page.goto(base + '/classes', { waitUntil: 'networkidle' })
    await page.click('.course-card')
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${out}/desktop-class-notes.png`, fullPage: true })
    await page.click('text=Grades')
    await page.screenshot({ path: `${out}/desktop-class-grades.png`, fullPage: true })
    await page.goto(base + '/calendar', { waitUntil: 'networkidle' })
    await page.click('text=List')
    await page.screenshot({ path: `${out}/desktop-calendar-list.png`, fullPage: true })
    await page.click('text=Week')
    await page.screenshot({ path: `${out}/desktop-calendar-week.png`, fullPage: true })
    await page.click('text=Month')
    await page.keyboard.press('n')
    await page.waitForTimeout(200)
    await page.screenshot({ path: `${out}/desktop-editor.png` })
    await page.keyboard.press('Escape')
    await page.goto(base + '/', { waitUntil: 'networkidle' })
    await page.click('.page-icon')
    await page.waitForTimeout(200)
    await page.screenshot({ path: `${out}/desktop-style-picker.png` })
  }
  await ctx.close()
}
await browser.close()
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no runtime errors')
