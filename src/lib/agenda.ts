import { useEffect, useMemo } from 'react'
import { useStore } from '../store/store'
import type { Course, ISODate, Item } from '../store/types'
import { KIND_ACCENT } from '../theme/themes'
import { expand, isDone } from './dates'
import { fetchEvents, useGoogle, type GEvent } from './google'

export type EntryKind = Item['kind'] | 'workout' | 'google'

export interface Entry {
  key: string
  date: ISODate
  start?: string
  end?: string
  title: string
  kind: EntryKind
  color: string
  done: boolean
  location?: string
  course?: Course
  item?: Item
  workoutId?: string
  google?: GEvent
}

/** Unified, sorted view of planner items + workouts + Google events for a date range. Memoized per range. */
export function useAgenda(from: ISODate, to: ISODate): Entry[] {
  const items = useStore((s) => s.items)
  const courses = useStore((s) => s.courses)
  const workouts = useStore((s) => s.workouts)
  const settings = useStore((s) => s.settings)
  const token = useGoogle((s) => s.token)
  const gKey = `${from}|${to}`
  const gEvents = useGoogle((s) => s.events[gKey])
  const enabledCals = useMemo(() => settings.googleCalendars.filter((c) => c.enabled), [settings.googleCalendars])

  useEffect(() => {
    if (!token || !settings.showGoogle) return
    fetchEvents(enabledCals, from, to)
    const onFocus = () => fetchEvents(enabledCals, from, to)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [token, settings.showGoogle, enabledCals, from, to])

  return useMemo(() => {
    const byId = new Map(courses.map((c) => [c.id, c]))
    const out: Entry[] = expand(items, from, to).map(({ item, date }) => {
      const course = item.courseId ? byId.get(item.courseId) : undefined
      return {
        key: `${item.id}:${date}`, date, start: item.start, end: item.end, title: item.title, kind: item.kind,
        color: course?.accent ?? KIND_ACCENT[item.kind], done: isDone(item, date), location: item.location, course, item,
      }
    })
    for (const w of workouts) {
      if (w.date < from || w.date > to) continue
      out.push({ key: `w:${w.id}`, date: w.date, start: w.time, title: w.title, kind: 'workout', color: KIND_ACCENT.workout, done: w.done, workoutId: w.id })
    }
    if (settings.showGoogle && gEvents) {
      for (const g of gEvents) out.push({ key: `g:${g.calendarId}:${g.id}`, date: g.date, start: g.start, end: g.end, title: g.title, kind: 'google', color: g.color, done: false, location: g.location, google: g })
    }
    return out.sort((a, b) => a.date !== b.date ? (a.date < b.date ? -1 : 1)
      : (a.start ?? '') !== (b.start ?? '') ? (!a.start ? -1 : !b.start ? 1 : a.start < b.start ? -1 : 1)
      : a.title.localeCompare(b.title))
  }, [items, courses, workouts, gEvents, settings.showGoogle, from, to])
}

export function groupByDate(entries: Entry[]): Map<ISODate, Entry[]> {
  const m = new Map<ISODate, Entry[]>()
  for (const e of entries) {
    const arr = m.get(e.date)
    if (arr) arr.push(e); else m.set(e.date, [e])
  }
  return m
}
