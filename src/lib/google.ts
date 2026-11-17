import { create } from 'zustand'
import type { Item } from '../store/types'
import { addDaysISO } from './dates'

/**
 * Google Calendar via Google Identity Services token model (browser-only, no backend).
 * Limitation: access tokens last ~1h and can't be refreshed silently without a user gesture;
 * a real refresh-token flow needs a small backend. Token is kept in sessionStorage only.
 */
const SCOPE_READ = 'https://www.googleapis.com/auth/calendar.readonly'
const SCOPE_EVENTS = 'https://www.googleapis.com/auth/calendar.events'
const SCOPES = `${SCOPE_READ} ${SCOPE_EVENTS}`
const API = 'https://www.googleapis.com/calendar/v3'
const TOKEN_KEY = 'petal.gtoken'
const TTL = 5 * 60_000

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
  /** Set when this event is a copy we pushed from a planner item. */
  petalId?: string
}

interface GState {
  token?: string
  expiresAt?: number
  status: 'idle' | 'loading' | 'error'
  error?: string
  events: Record<string, GEvent[]> // key `${from}|${to}`
  fetchedAt: Record<string, number>
}

function readToken(): Pick<GState, 'token' | 'expiresAt'> {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY)
    if (!raw) return {}
    const { token, expiresAt } = JSON.parse(raw) ?? {}
    if (typeof token === 'string' && token && typeof expiresAt === 'number' && expiresAt > Date.now() + 60_000) return { token, expiresAt }
    sessionStorage.removeItem(TOKEN_KEY) // expired or malformed
  } catch { /* corrupt JSON or storage unavailable */ }
  return {}
}

export const useGoogle = create<GState>(() => ({ ...readToken(), status: 'idle', events: {}, fetchedAt: {} }))

export const isConnected = () => {
  const { token, expiresAt } = useGoogle.getState()
  return !!token && !!expiresAt && expiresAt > Date.now()
}

declare global {
  interface Window { google?: any }
}

// Bumped whenever cached events become invalid (connect, disconnect, calendar set changed),
// so responses that were in flight from before are discarded instead of re-filling the cache.
let epoch = 0
const inflight = new Map<string, Promise<void>>()
let pending = 0

/** Drop cached events (e.g. after the set of enabled calendars changed). */
export function clearGoogleCache() {
  epoch++
  inflight.clear()
  useGoogle.setState({ events: {}, fetchedAt: {} })
}

let gisPromise: Promise<void> | undefined
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  gisPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => {
      if (window.google?.accounts?.oauth2) resolve()
      else { gisPromise = undefined; s.remove(); reject(new Error('Could not load Google sign-in')) }
    }
    // Remove the dead tag so a retry injects a fresh one.
    s.onerror = () => { gisPromise = undefined; s.remove(); reject(new Error('Could not load Google sign-in — check your connection or ad blocker')) }
    document.head.appendChild(s)
  })
  return gisPromise
}

export async function connectGoogle(clientId: string): Promise<void> {
  if (!clientId?.trim()) throw new Error('Add a Google OAuth client ID first')
  await loadGis()
  const oauth2 = window.google.accounts.oauth2
  await new Promise<void>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId.trim(),
      scope: SCOPES,
      callback: (resp: any) => {
        if (resp?.error) {
          reject(new Error(resp.error === 'access_denied' ? 'Google access was denied' : resp.error_description || resp.error))
          return
        }
        if (!resp?.access_token) { reject(new Error('Google sign-in returned no token')); return }
        // Granular consent lets users untick scopes; without them every call would 403.
        if (oauth2.hasGrantedAllScopes && !oauth2.hasGrantedAllScopes(resp, SCOPE_READ, SCOPE_EVENTS)) {
          oauth2.revoke?.(resp.access_token, () => {})
          reject(new Error('Please allow access to your calendars (tick both boxes) and try again'))
          return
        }
        const expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000
        try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token: resp.access_token, expiresAt })) } catch { /* storage full/blocked: keep in memory */ }
        epoch++
        inflight.clear()
        useGoogle.setState({ token: resp.access_token, expiresAt, status: 'idle', error: undefined, events: {}, fetchedAt: {} })
        resolve()
      },
      // Fires for popup_failed_to_open / popup_closed / unknown.
      error_callback: (e: any) => reject(new Error(
        e?.type === 'popup_failed_to_open' ? 'Google sign-in popup was blocked — allow popups for this site'
          : e?.type === 'popup_closed' ? 'Google sign-in was closed' : e?.message || 'Google sign-in failed')),
    })
    client.requestAccessToken({ prompt: '' })
  })
}

export function disconnectGoogle() {
  const { token } = useGoogle.getState()
  if (token && window.google?.accounts?.oauth2) {
    try { window.google.accounts.oauth2.revoke(token, () => {}) } catch { /* best effort */ }
  }
  try { sessionStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ }
  epoch++
  inflight.clear()
  useGoogle.setState({ token: undefined, expiresAt: undefined, status: 'idle', error: undefined, events: {}, fetchedAt: {} })
}

export class GoogleApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

const EXPIRED_MSG = 'Google session expired — reconnect in Settings'

async function gfetch(path: string, init?: RequestInit) {
  const { token } = useGoogle.getState()
  if (!token || !isConnected()) throw new GoogleApiError('Not connected to Google', 0)
  let res: Response
  try {
    res = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init?.headers } })
  } catch {
    throw new GoogleApiError("Couldn't reach Google — check your connection", 0)
  }
  if (res.status === 401) {
    // Only drop the session if it's still the token this request used.
    if (useGoogle.getState().token === token) disconnectGoogle()
    throw new GoogleApiError(EXPIRED_MSG, 401)
  }
  if (!res.ok) {
    let reason = ''
    try { reason = (await res.json())?.error?.errors?.[0]?.reason ?? '' } catch { /* non-JSON body */ }
    if (res.status === 429 || /rateLimit/i.test(reason)) throw new GoogleApiError('Google is rate-limiting requests — try again in a minute', res.status)
    if (res.status === 403) throw new GoogleApiError('Google denied access to this calendar', 403)
    throw new GoogleApiError(`Google Calendar error ${res.status}`, res.status)
  }
  return res.status === 204 ? null : res.json()
}

export async function listCalendars(): Promise<{ id: string; summary: string; color: string; primary: boolean }[]> {
  const data = await gfetch('/users/me/calendarList?minAccessRole=reader')
  return ((data?.items ?? []) as any[]).map((c) => ({ id: c.id, summary: c.summaryOverride || c.summary || c.id, color: c.backgroundColor || '#9CC3E8', primary: !!c.primary }))
}

function toLocal(dt: string) {
  const d = new Date(dt)
  const pad = (n: number) => String(n).padStart(2, '0')
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }
}

/**
 * Map one Google API event to GEvents within [from, to] (local dates).
 * All-day events spanning several days yield one entry per day; timed events land on their local start date.
 */
export function toGEvents(e: any, cal: { id: string; color: string }, from: string, to: string): GEvent[] {
  if (e?.status === 'cancelled' || !e?.start) return []
  const base = { id: e.id, calendarId: cal.id, title: e.summary || '(busy)', location: e.location, color: cal.color, htmlLink: e.htmlLink, petalId: e.extendedProperties?.private?.petalId }
  if (e.start.date) {
    const last = e.end?.date && e.end.date > e.start.date ? addDaysISO(e.end.date, -1) : e.start.date // end.date is exclusive
    const out: GEvent[] = []
    for (let d = e.start.date < from ? from : e.start.date; d <= last && d <= to; d = addDaysISO(d, 1)) out.push({ ...base, date: d })
    return out
  }
  if (!e.start.dateTime) return []
  const s = toLocal(e.start.dateTime)
  if (s.date < from || s.date > to) return []
  const en = e.end?.dateTime ? toLocal(e.end.dateTime) : undefined
  return [{ ...base, date: s.date, start: s.time, end: en && en.date === s.date ? en.time : undefined }]
}

/**
 * Fetch events for enabled calendars in [from, to]. Cached per range for 5 minutes.
 * One failing calendar doesn't hide the others; status is 'error' only when every calendar failed.
 */
export function fetchEvents(calendars: { id: string; color: string }[], from: string, to: string, force = false): Promise<void> {
  const key = `${from}|${to}`
  if (!isConnected() || !calendars.length) return Promise.resolve()
  const st = useGoogle.getState()
  if (!force && st.fetchedAt[key] && Date.now() - st.fetchedAt[key] < TTL) return Promise.resolve()
  const running = inflight.get(key)
  if (running && !force) return running
  const p = loadRange(calendars, from, to, key).finally(() => { if (inflight.get(key) === p) inflight.delete(key) })
  inflight.set(key, p)
  return p
}

async function loadRange(calendars: { id: string; color: string }[], from: string, to: string, key: string) {
  const myEpoch = epoch
  pending++
  useGoogle.setState({ status: 'loading' })
  const timeMin = new Date(`${from}T00:00:00`).toISOString()
  const timeMax = new Date(`${addDaysISO(to, 1)}T00:00:00`).toISOString()
  const results = await Promise.allSettled(calendars.map(async (cal) => {
    const q = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '2500' })
    const data = await gfetch(`/calendars/${encodeURIComponent(cal.id)}/events?${q}`)
    return ((data?.items ?? []) as any[]).flatMap((e) => toGEvents(e, cal, from, to))
  }))
  pending--
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  const error = failed.length ? (failed.find((f) => f.reason?.status === 401) ?? failed[0]).reason?.message ?? 'Google Calendar error' : undefined
  if (myEpoch !== epoch) {
    // Cache was reset while we were loading (disconnect / reconnect / calendars changed): drop the data.
    useGoogle.setState((s) => ({ status: pending ? 'loading' : s.status === 'loading' ? 'idle' : s.status, ...(error === EXPIRED_MSG && { status: 'error' as const, error }) }))
    return
  }
  const ok = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
  const allFailed = failed.length === results.length
  useGoogle.setState((s) => ({
    status: pending ? 'loading' : allFailed ? 'error' : 'idle',
    error: error && !allFailed ? `${error} (some calendars couldn't be loaded)` : error,
    ...(!allFailed && { events: { ...s.events, [key]: ok }, fetchedAt: { ...s.fetchedAt, [key]: Date.now() } }),
  }))
}

export function itemToEvent(item: Item, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
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
    status: 'confirmed', // a PUT on an event deleted in Google restores it
    ...(item.recurrence && { recurrence: toRecurrence(item, timeZone) }),
    extendedProperties: { private: { petalId: item.id } },
  }
}

const addHour = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h >= 23 ? '23:59' : `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const compact = (d: string) => d.replace(/-/g, '')

/** RRULE string for an item's recurrence. UNTIL is inclusive of the whole local `until` day. */
export function toRRule(item: Item): string {
  const r = item.recurrence!
  const days = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
  let until = ''
  if (r.until) {
    // RFC 5545: UNTIL must be a DATE for all-day events, a UTC DATE-TIME for timed ones.
    until = item.start
      ? `;UNTIL=${new Date(`${r.until}T23:59:59`).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`
      : `;UNTIL=${compact(r.until)}`
  }
  switch (r.freq) {
    case 'daily': return `RRULE:FREQ=DAILY${until}`
    case 'weekdays': return `RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR${until}`
    case 'weekly': case 'biweekly': {
      const by = (r.byDay?.length ? [...r.byDay].sort((a, b) => a - b) : [new Date(`${item.date}T00:00`).getDay()]).map((d) => days[d]).join(',')
      // WKST=SU matches dates.ts (weeks start Sunday) so biweekly picks the same weeks.
      return `RRULE:FREQ=WEEKLY${r.freq === 'biweekly' ? ';INTERVAL=2;WKST=SU' : ''};BYDAY=${by}${until}`
    }
    case 'monthly': return `RRULE:FREQ=MONTHLY${until}`
    case 'yearly': return `RRULE:FREQ=YEARLY${until}`
  }
}

/** RRULE plus EXDATE lines for skipped occurrences. */
export function toRecurrence(item: Item, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): string[] {
  const ex = item.recurrence?.exceptions ?? []
  return [toRRule(item), ...ex.map((d) => (item.start
    ? `EXDATE;TZID=${timeZone}:${compact(d)}T${item.start.replace(':', '')}00`
    : `EXDATE;VALUE=DATE:${compact(d)}`))]
}

/** Push (create or update) a planner item to Google. Returns the gcal reference to store on the item. */
export async function pushItem(item: Item, calendarId = 'primary'): Promise<{ calendarId: string; eventId: string }> {
  const body = JSON.stringify(itemToEvent(item))
  if (item.gcal) {
    try {
      await gfetch(`/calendars/${encodeURIComponent(item.gcal.calendarId)}/events/${encodeURIComponent(item.gcal.eventId)}`, { method: 'PUT', body })
      return item.gcal
    } catch (e) {
      // Recreate only if the event (or its calendar) is gone; anything else (rate limit, offline, 5xx)
      // must not POST a duplicate.
      if (!(e instanceof GoogleApiError && (e.status === 404 || e.status === 410))) throw e
    }
  }
  const ev = await gfetch(`/calendars/${encodeURIComponent(calendarId)}/events`, { method: 'POST', body })
  return { calendarId, eventId: ev.id }
}

export async function removePushed(item: Item) {
  if (!item.gcal || !isConnected()) return
  try {
    await gfetch(`/calendars/${encodeURIComponent(item.gcal.calendarId)}/events/${encodeURIComponent(item.gcal.eventId)}`, { method: 'DELETE' })
  } catch { /* already gone (404/410) or offline — best effort */ }
}
