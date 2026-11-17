import { create } from 'zustand'
import type { Item } from '../store/types'
import { addDaysISO } from './dates'

/**
 * Google Calendar via Google Identity Services token model (browser-only, no backend).
 * Limitation: access tokens last ~1h and can't be refreshed silently without a user gesture;
 * a real refresh-token flow needs a small backend. Token is kept in sessionStorage only.
 */
const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events'
const API = 'https://www.googleapis.com/calendar/v3'
const TOKEN_KEY = 'petal.gtoken'

export interface GEvent {
  id: string
  calendarId: string
  title: string
  date: string
  start?: string
  end?: string
  location?: string
  color: string
  htmlLink?: string
}

interface GState {
  token?: string
  expiresAt?: number
  status: 'idle' | 'loading' | 'error'
  error?: string
  events: Record<string, GEvent[]> // key `${from}|${to}`
  fetchedAt: Record<string, number>
}

export const useGoogle = create<GState>(() => {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY)
    if (raw) {
      const { token, expiresAt } = JSON.parse(raw)
      if (expiresAt > Date.now() + 60_000) return { token, expiresAt, status: 'idle', events: {}, fetchedAt: {} }
    }
  } catch { /* ignore */ }
  return { status: 'idle', events: {}, fetchedAt: {} }
})

export const isConnected = () => {
  const { token, expiresAt } = useGoogle.getState()
  return !!token && !!expiresAt && expiresAt > Date.now()
}

declare global {
  interface Window { google?: any }
}

let gisPromise: Promise<void> | undefined
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  gisPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => { gisPromise = undefined; reject(new Error('Could not load Google sign-in')) }
    document.head.appendChild(s)
  })
  return gisPromise
}

export async function connectGoogle(clientId: string): Promise<void> {
  await loadGis()
  await new Promise<void>((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (resp: any) => {
        if (resp.error) { reject(new Error(resp.error_description || resp.error)); return }
        const expiresAt = Date.now() + Number(resp.expires_in) * 1000
        sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token: resp.access_token, expiresAt }))
        useGoogle.setState({ token: resp.access_token, expiresAt, error: undefined, events: {}, fetchedAt: {} })
        resolve()
      },
      error_callback: (e: any) => reject(new Error(e?.message || 'Google sign-in was closed')),
    })
    client.requestAccessToken({ prompt: '' })
  })
}

export function disconnectGoogle() {
  const { token } = useGoogle.getState()
  if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token, () => {})
  sessionStorage.removeItem(TOKEN_KEY)
  useGoogle.setState({ token: undefined, expiresAt: undefined, events: {}, fetchedAt: {} })
}

async function gfetch(path: string, init?: RequestInit) {
  const { token } = useGoogle.getState()
  if (!token || !isConnected()) throw new Error('Not connected to Google')
  const res = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init?.headers } })
  if (res.status === 401) { disconnectGoogle(); throw new Error('Google session expired — reconnect in Settings') }
  if (!res.ok) throw new Error(`Google Calendar error ${res.status}`)
  return res.status === 204 ? null : res.json()
}

export async function listCalendars(): Promise<{ id: string; summary: string; color: string }[]> {
  const data = await gfetch('/users/me/calendarList?minAccessRole=reader')
  return data.items.map((c: any) => ({ id: c.id, summary: c.summaryOverride || c.summary, color: c.backgroundColor || '#9CC3E8' }))
}

function toLocal(dt: string) {
  const d = new Date(dt)
  const pad = (n: number) => String(n).padStart(2, '0')
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }
}

/** Fetch events for enabled calendars in [from, to]. Cached per range for 5 minutes. */
export async function fetchEvents(calendars: { id: string; color: string }[], from: string, to: string, force = false) {
  const key = `${from}|${to}`
  const st = useGoogle.getState()
  if (!isConnected() || !calendars.length) return
  if (!force && st.fetchedAt[key] && Date.now() - st.fetchedAt[key] < 5 * 60_000) return
  useGoogle.setState({ status: 'loading' })
  try {
    const timeMin = new Date(`${from}T00:00:00`).toISOString()
    const timeMax = new Date(`${addDaysISO(to, 1)}T00:00:00`).toISOString()
    const results = await Promise.all(calendars.map(async (cal) => {
      const q = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '500' })
      const data = await gfetch(`/calendars/${encodeURIComponent(cal.id)}/events?${q}`)
      return (data.items as any[]).filter((e) => e.status !== 'cancelled' && !e.extendedProperties?.private?.petalId).map((e): GEvent => {
        const allDay = !!e.start.date
        const s = allDay ? { date: e.start.date, time: undefined } : toLocal(e.start.dateTime)
        const en = allDay ? undefined : toLocal(e.end.dateTime)
        return { id: e.id, calendarId: cal.id, title: e.summary || '(busy)', date: s.date, start: s.time, end: en?.time, location: e.location, color: cal.color, htmlLink: e.htmlLink }
      })
    }))
    useGoogle.setState((s) => ({ status: 'idle', events: { ...s.events, [key]: results.flat() }, fetchedAt: { ...s.fetchedAt, [key]: Date.now() } }))
  } catch (e: any) {
    useGoogle.setState({ status: 'error', error: e.message })
  }
}

function itemToEvent(item: Item) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  let start: object, end: object
  if (item.start) {
    // Local wall-clock times + timeZone; Google needs a timeZone for recurring timed events.
    const endT = item.end && item.end > item.start ? item.end : addHour(item.start)
    start = { dateTime: `${item.date}T${item.start}:00`, timeZone }
    end = { dateTime: `${item.date}T${endT}:00`, timeZone }
  } else {
    start = { date: item.date }
    end = { date: addDaysISO(item.date, 1) }
  }
  return {
    summary: item.title, location: item.location, description: item.notes, start, end,
    ...(item.recurrence && { recurrence: [toRRule(item)] }),
    extendedProperties: { private: { petalId: item.id } },
  }
}

const addHour = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h >= 23 ? '23:59' : `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function toRRule(item: Item): string {
  const r = item.recurrence!
  const days = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
  const until = r.until ? `;UNTIL=${r.until.replace(/-/g, '')}T235959Z` : ''
  switch (r.freq) {
    case 'daily': return `RRULE:FREQ=DAILY${until}`
    case 'weekdays': return `RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR${until}`
    case 'weekly': case 'biweekly': {
      const by = (r.byDay?.length ? r.byDay : [new Date(`${item.date}T00:00`).getDay()]).map((d) => days[d]).join(',')
      return `RRULE:FREQ=WEEKLY${r.freq === 'biweekly' ? ';INTERVAL=2' : ''};BYDAY=${by}${until}`
    }
    case 'monthly': return `RRULE:FREQ=MONTHLY${until}`
    case 'yearly': return `RRULE:FREQ=YEARLY${until}`
  }
}

/** Push (create or update) a planner item to Google. Returns the gcal reference to store on the item. */
export async function pushItem(item: Item, calendarId = 'primary'): Promise<{ calendarId: string; eventId: string }> {
  const body = JSON.stringify(itemToEvent(item))
  if (item.gcal) {
    try {
      await gfetch(`/calendars/${encodeURIComponent(item.gcal.calendarId)}/events/${item.gcal.eventId}`, { method: 'PUT', body })
      return item.gcal
    } catch { /* fall through and recreate if it was deleted on Google's side */ }
  }
  const ev = await gfetch(`/calendars/${encodeURIComponent(calendarId)}/events`, { method: 'POST', body })
  return { calendarId, eventId: ev.id }
}

export async function removePushed(item: Item) {
  if (!item.gcal || !isConnected()) return
  try { await gfetch(`/calendars/${encodeURIComponent(item.gcal.calendarId)}/events/${item.gcal.eventId}`, { method: 'DELETE' }) } catch { /* already gone */ }
}
