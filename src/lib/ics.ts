import type { Item, Recurrence } from '../store/types'
import { toISO } from './dates'

/** Minimal RFC 5545 VEVENT parser for university timetables / calendar exports. Pure, no deps. */
export interface IcsEvent {
  uid?: string
  summary: string
  location?: string
  description?: string
  date: string
  start?: string
  end?: string
  recurrence?: Recurrence
}

const DAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }

function parseDT(value: string, params: string): { date: string; time?: string } {
  if (params.includes('VALUE=DATE') && !value.includes('T')) {
    return { date: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` }
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/)
  if (!m) {
    const d = value.match(/^(\d{4})(\d{2})(\d{2})$/)
    if (d) return { date: `${d[1]}-${d[2]}-${d[3]}` }
    throw new Error(`Bad date: ${value}`)
  }
  const [, y, mo, d, h, mi, , z] = m
  if (z) {
    // UTC → local wall time. TZID values are taken as already-local (good enough for single-zone students).
    const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi))
    return { date: toISO(dt), time: `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}` }
  }
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}` }
}

function unescape(s: string) {
  return s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')
}

function parseRRule(rule: string): Recurrence | undefined {
  const p = Object.fromEntries(rule.split(';').map((kv) => kv.split('=') as [string, string]))
  const interval = Number(p.INTERVAL ?? 1)
  const until = p.UNTIL ? parseDT(p.UNTIL, '').date : undefined
  const byDay = p.BYDAY?.split(',').map((d) => DAY[d.replace(/^[-+\d]+/, '')]).filter((n) => n !== undefined)
  switch (p.FREQ) {
    case 'DAILY': return interval === 1 ? { freq: 'daily', until } : undefined
    case 'WEEKLY':
      if (interval > 2) return undefined
      if (interval === 1 && byDay?.length === 5 && [1, 2, 3, 4, 5].every((d) => byDay.includes(d))) return { freq: 'weekdays', until }
      return { freq: interval === 2 ? 'biweekly' : 'weekly', byDay: byDay?.length ? byDay : undefined, until }
    case 'MONTHLY': return interval === 1 ? { freq: 'monthly', until } : undefined
    case 'YEARLY': return interval === 1 ? { freq: 'yearly', until } : undefined
  }
  return undefined
}

export function parseIcs(text: string): IcsEvent[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n')
  const events: IcsEvent[] = []
  let cur: Partial<IcsEvent> & { exdates?: string[] } | null = null
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue }
    if (line === 'END:VEVENT') {
      if (cur?.date) {
        if (cur.recurrence && cur.exdates?.length) cur.recurrence.exceptions = cur.exdates
        delete cur.exdates
        events.push({ summary: '(untitled)', ...cur } as IcsEvent)
      }
      cur = null
      continue
    }
    if (!cur) continue
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const head = line.slice(0, idx)
    const value = line.slice(idx + 1)
    const [name, ...rest] = head.split(';')
    const params = rest.join(';')
    try {
      switch (name) {
        case 'UID': cur.uid = value; break
        case 'SUMMARY': cur.summary = unescape(value); break
        case 'LOCATION': cur.location = unescape(value) || undefined; break
        case 'DESCRIPTION': cur.description = unescape(value) || undefined; break
        case 'DTSTART': { const r = parseDT(value, params); cur.date = r.date; cur.start = r.time; break }
        case 'DTEND': { const r = parseDT(value, params); if (r.time) cur.end = r.time; break }
        case 'RRULE': cur.recurrence = parseRRule(value); break
        case 'EXDATE': cur.exdates = [...(cur.exdates ?? []), ...value.split(',').map((v) => parseDT(v, params).date)]; break
      }
    } catch { /* skip malformed property */ }
  }
  return events
}

const EXAM_RE = /\b(exam|midterm|final|quiz|test)\b/i
const DUE_RE = /\b(due|assignment|essay|lab report|submission|project)\b/i
const CLASS_RE = /\b(lecture|lec|tutorial|tut|seminar|lab|workshop|class)\b/i

export function icsToItems(events: IcsEvent[], mkId: () => string): Item[] {
  return events.map((e) => ({
    id: mkId(),
    kind: EXAM_RE.test(e.summary) ? 'exam' : DUE_RE.test(e.summary) ? 'assignment' : e.recurrence || CLASS_RE.test(e.summary) ? 'class' : 'event',
    title: e.summary,
    date: e.date,
    start: e.start,
    end: e.end,
    location: e.location,
    notes: e.description,
    recurrence: e.recurrence,
    sourceUid: e.uid,
    createdAt: Date.now(),
  }))
}
