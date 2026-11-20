import { addDaysISO, toISO, todayISO } from './dates'

/**
 * Apple Health → Petal bridge. Websites cannot read HealthKit, so an iOS Shortcut reads steps/sleep and hands them
 * over either as a link (`https://<site>/#health=<payload>`; the hash never reaches the server) or via the clipboard.
 * Payload: JSON `{ "days": [{ "date": "2026-11-19", "steps": 8432, "sleep": 7.4 }] }`, a single day object, an array,
 * or query-style `date=2026-11-19&steps=8432&sleep=7.4`. Tolerates Shortcuts' locale output ("8,432", "7,5", minutes).
 */
export interface HealthDay { date: string; steps?: number; sleep?: number }
export class HealthPayloadError extends Error {}

const MAX_DAYS = 62

function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v !== 'string') return undefined
  let s = v.trim().replace(/[^\d.,-]/g, '')
  if (!s) return undefined
  // "8,432" / "8.432" (thousands) vs "7,5" (decimal comma)
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '')
  else s = s.replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

function date(v: unknown, today: string): string | undefined {
  if (v === undefined || v === null || v === '') return today
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ]/)
  if (m) return m[1]
  const t = Date.parse(s)
  return Number.isNaN(t) ? undefined : toISO(new Date(t))
}

function cleanDay(raw: Record<string, unknown>, today: string): HealthDay | undefined {
  const d = date(raw.date ?? raw.day, today)
  if (!d || d > addDaysISO(today, 1) || d < addDaysISO(today, -400)) return undefined
  let steps = num(raw.steps)
  let sleep = num(raw.sleep ?? raw.sleepHours)
  const sleepMin = num(raw.sleepMinutes)
  if (sleep === undefined && sleepMin !== undefined) sleep = sleepMin / 60
  if (sleep !== undefined && sleep > 24 && sleep <= 1440) sleep = sleep / 60 // minutes sent as "sleep"
  steps = steps !== undefined && steps >= 0 && steps <= 200_000 ? Math.round(steps) : undefined
  sleep = sleep !== undefined && sleep >= 0 && sleep <= 24 ? Math.round(sleep * 10) / 10 : undefined
  if (steps === undefined && sleep === undefined) return undefined
  return { date: d, ...(steps !== undefined && { steps }), ...(sleep !== undefined && { sleep }) }
}

export function parseHealthPayload(input: string, today: string = todayISO()): HealthDay[] {
  const text = input.trim()
  if (!text) throw new HealthPayloadError('Nothing to import')
  let rows: Record<string, unknown>[]
  if (text.startsWith('{') || text.startsWith('[')) {
    let data: unknown
    try { data = JSON.parse(text) } catch { throw new HealthPayloadError('That doesn’t look like Petal health data') }
    const list = Array.isArray(data) ? data : Array.isArray((data as any)?.days) ? (data as any).days : [data]
    rows = list.filter((x: unknown) => x && typeof x === 'object') as Record<string, unknown>[]
  } else if (/(^|&)(steps|sleep)=/.test(text)) {
    rows = [Object.fromEntries(new URLSearchParams(text))]
  } else {
    throw new HealthPayloadError('That doesn’t look like Petal health data')
  }
  const byDate = new Map<string, HealthDay>()
  for (const r of rows.slice(0, MAX_DAYS)) {
    const d = cleanDay(r, today)
    if (d) byDate.set(d.date, { ...byDate.get(d.date), ...d })
  }
  if (!byDate.size) throw new HealthPayloadError('No valid steps or sleep values found')
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

/** Pull a payload out of a URL hash (`#health=...`), if present. */
export function healthFromHash(hash: string): string | undefined {
  const m = hash.match(/^#health=(.*)$/s)
  if (!m) return undefined
  try { return decodeURIComponent(m[1]) } catch { return m[1] }
}
