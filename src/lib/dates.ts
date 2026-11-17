import {
  addDays, differenceInCalendarDays, differenceInCalendarWeeks, format, parseISO, startOfWeek,
} from 'date-fns'
import type { ISODate, Item, Recurrence } from '../store/types'

export const toISO = (d: Date): ISODate => format(d, 'yyyy-MM-dd')
export const fromISO = (s: ISODate): Date => parseISO(s)
export const todayISO = (): ISODate => toISO(new Date())
export const addDaysISO = (s: ISODate, n: number): ISODate => toISO(addDays(fromISO(s), n))
export const daysUntil = (s: ISODate, from: ISODate = todayISO()): number =>
  differenceInCalendarDays(fromISO(s), fromISO(from))

/** True if a recurring rule (anchored at `start`) produces an occurrence on `day`. */
export function occursOn(start: ISODate, rule: Recurrence, day: ISODate): boolean {
  if (day < start) return false
  if (rule.until && day > rule.until) return false
  if (rule.exceptions?.includes(day)) return false
  const d = fromISO(day)
  const s = fromISO(start)
  switch (rule.freq) {
    case 'daily': return true
    case 'weekdays': { const w = d.getDay(); return w !== 0 && w !== 6 }
    case 'weekly':
    case 'biweekly': {
      const days = rule.byDay?.length ? rule.byDay : [s.getDay()]
      if (!days.includes(d.getDay())) return false
      if (rule.freq === 'weekly') return true
      return differenceInCalendarWeeks(d, s, { weekStartsOn: 0 }) % 2 === 0
    }
    case 'monthly': return d.getDate() === s.getDate()
    case 'yearly': return d.getDate() === s.getDate() && d.getMonth() === s.getMonth()
  }
}

export interface Occurrence<T = Item> { item: T; date: ISODate }

/** Expand items into dated occurrences within [from, to] inclusive. Cost: O(items × days) only for recurring items. */
export function expand(items: Item[], from: ISODate, to: ISODate): Occurrence[] {
  const out: Occurrence[] = []
  for (const item of items) {
    if (!item.recurrence) {
      if (item.date >= from && item.date <= to) out.push({ item, date: item.date })
      continue
    }
    let day = item.date > from ? item.date : from
    const end = item.recurrence.until && item.recurrence.until < to ? item.recurrence.until : to
    while (day <= end) {
      if (occursOn(item.date, item.recurrence, day)) out.push({ item, date: day })
      day = addDaysISO(day, 1)
    }
  }
  return out.sort(compareOcc)
}

export function compareOcc(a: Occurrence, b: Occurrence): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  const at = a.item.start ?? '', bt = b.item.start ?? ''
  if (at !== bt) return at === '' ? -1 : bt === '' ? 1 : at < bt ? -1 : 1
  return a.item.title.localeCompare(b.item.title)
}

export const isDone = (item: Item, date: ISODate) =>
  item.recurrence ? !!item.doneDates?.includes(date) : !!item.done

/** Next occurrence on/after `from`, searching up to `horizon` days. */
export function nextOccurrence(item: Item, from: ISODate = todayISO(), horizon = 400): ISODate | undefined {
  if (!item.recurrence) return item.date >= from ? item.date : undefined
  const occ = expand([item], from, addDaysISO(from, horizon))
  return occ[0]?.date
}

export function weekDays(anchor: ISODate, weekStartsOn: 0 | 1): ISODate[] {
  const s = startOfWeek(fromISO(anchor), { weekStartsOn })
  return Array.from({ length: 7 }, (_, i) => toISO(addDays(s, i)))
}

export function monthGrid(anchor: ISODate, weekStartsOn: 0 | 1): ISODate[] {
  const a = fromISO(anchor)
  const first = new Date(a.getFullYear(), a.getMonth(), 1)
  const s = startOfWeek(first, { weekStartsOn })
  return Array.from({ length: 42 }, (_, i) => toISO(addDays(s, i)))
}

export function fmtTime(t?: string): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const ap = h >= 12 ? 'pm' : 'am'
  const hh = h % 12 || 12
  return m ? `${hh}:${String(m).padStart(2, '0')}${ap}` : `${hh}${ap}`
}

export function countdownLabel(n: number): string {
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  if (n < 0) return `${-n}d ago`
  return `${n} days`
}

export function greeting(d = new Date()): string {
  const h = d.getHours()
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
/**
 * Pull a date phrase out of quick-add text: today/tonight, tomorrow/tmrw, weekday names (next occurrence,
 * "next fri" = +7), "in N days", "may 3"/"3 may". Returns cleaned title and ISO date (undefined if none found).
 */
export function parseQuickDate(text: string, today: ISODate = todayISO()): { title: string; date?: ISODate } {
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  const rules: [RegExp, (m: RegExpMatchArray) => ISODate | undefined][] = [
    [/\b(?:due\s+)?(today|tonight)\b/i, () => today],
    [/\b(?:due\s+)?(tomorrow|tmrw|tmr)\b/i, () => addDaysISO(today, 1)],
    [/\b(?:due\s+)?in\s+(\d{1,3})\s+days?\b/i, (m) => addDaysISO(today, Number(m[1]))],
    [/\b(?:due\s+)?(next\s+)?(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i, (m) => {
      const target = WD.indexOf(m[2].toLowerCase())
      let diff = (target - fromISO(today).getDay() + 7) % 7
      if (diff === 0) diff = 7
      return addDaysISO(today, diff + (m[1] ? 7 : 0))
    }],
    [/\b(?:due\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i, (m) => monthDay(months.indexOf(m[1].toLowerCase()), Number(m[2]))],
    [/\b(?:due\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i, (m) => monthDay(months.indexOf(m[2].toLowerCase()), Number(m[1]))],
  ]
  function monthDay(mo: number, d: number): ISODate | undefined {
    if (d < 1 || d > 31) return undefined
    const t = fromISO(today)
    let cand = new Date(t.getFullYear(), mo, d)
    if (cand.getMonth() !== mo) return undefined
    if (toISO(cand) < today) cand = new Date(t.getFullYear() + 1, mo, d)
    return toISO(cand)
  }
  for (const [re, fn] of rules) {
    const m = text.match(re)
    if (!m) continue
    const date = fn(m)
    if (!date) continue
    const title = (text.slice(0, m.index) + text.slice(m.index! + m[0].length)).replace(/\s{2,}/g, ' ').trim()
    return { title: title || text.trim(), date }
  }
  return { title: text.trim() }
}
