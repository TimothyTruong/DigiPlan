import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Item } from '../../store/types'

type G = typeof import('../google')

// ---- test doubles -------------------------------------------------------------------------
function memStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init))
  return {
    getItem: vi.fn((k: string) => m.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => { m.set(k, v) }),
    removeItem: vi.fn((k: string) => { m.delete(k) }),
    map: m,
  }
}

interface FakeScript { src: string; async: boolean; onload?: () => void; onerror?: () => void; remove: () => void }
let scripts: FakeScript[]
let storage: ReturnType<typeof memStorage>
let win: { google?: any }

function oauth2Mock(opts: { resp?: any; error?: any; granted?: boolean } = {}) {
  const revoke = vi.fn()
  const initTokenClient = vi.fn((cfg: any) => ({
    requestAccessToken: vi.fn(() => {
      queueMicrotask(() => (opts.error ? cfg.error_callback(opts.error) : cfg.callback(opts.resp ?? { access_token: 'tok', expires_in: 3600 })))
    }),
  }))
  return { initTokenClient, revoke, hasGrantedAllScopes: vi.fn(() => opts.granted ?? true) }
}

function json(status: number, body?: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as Response
}

const TOKEN_KEY = 'petal.gtoken'
const validToken = () => JSON.stringify({ token: 'saved', expiresAt: Date.now() + 3_600_000 })

async function load(session: Record<string, string> = {}): Promise<G> {
  vi.resetModules()
  storage = memStorage(session)
  scripts = []
  win = {}
  vi.stubGlobal('sessionStorage', storage)
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', {
    createElement: vi.fn(() => {
      const s: FakeScript = { src: '', async: false, remove: vi.fn(() => { scripts = scripts.filter((x) => x !== s) }) }
      return s
    }),
    head: { appendChild: vi.fn((s: FakeScript) => { scripts.push(s) }) },
  })
  return import('../google')
}

async function connected(): Promise<G> { return load({ [TOKEN_KEY]: validToken() }) }

const base = (p: Partial<Item>): Item => ({ id: 'it1', kind: 'exam', title: 'Exam', date: '2026-01-05', createdAt: 0, ...p })
const cal = (id: string) => ({ id, color: '#123456' })
const timed = (id: string, start: string, end: string, extra: object = {}) => ({ id, summary: id, start: { dateTime: start }, end: { dateTime: end }, ...extra })

beforeEach(() => { vi.stubEnv('TZ', 'UTC') })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })

// ---- token persistence ---------------------------------------------------------------------
describe('token persistence', () => {
  it('restores a valid token from sessionStorage', async () => {
    const g = await connected()
    expect(g.useGoogle.getState().token).toBe('saved')
    expect(g.isConnected()).toBe(true)
  })
  it.each([
    ['expired', JSON.stringify({ token: 't', expiresAt: Date.now() - 1000 })],
    ['about to expire', JSON.stringify({ token: 't', expiresAt: Date.now() + 30_000 })],
    ['corrupt JSON', '{not json'],
    ['null', 'null'],
    ['missing token', JSON.stringify({ expiresAt: Date.now() + 3_600_000 })],
    ['string expiresAt', JSON.stringify({ token: 't', expiresAt: 'soon' })],
  ])('ignores %s token', async (_, raw) => {
    const g = await load({ [TOKEN_KEY]: raw })
    expect(g.useGoogle.getState().token).toBeUndefined()
    expect(g.isConnected()).toBe(false)
  })
  it('clears an expired token from storage', async () => {
    await load({ [TOKEN_KEY]: JSON.stringify({ token: 't', expiresAt: 1 }) })
    expect(storage.map.has(TOKEN_KEY)).toBe(false)
  })
  it('survives sessionStorage throwing', async () => {
    vi.resetModules()
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('denied') } })
    const g = await import('../google')
    expect(g.isConnected()).toBe(false)
  })
  it('isConnected turns false once the token expires', async () => {
    const g = await connected()
    g.useGoogle.setState({ expiresAt: Date.now() - 1 })
    expect(g.isConnected()).toBe(false)
  })
})

// ---- login ---------------------------------------------------------------------------------
describe('connectGoogle', () => {
  it('rejects a missing client id without loading anything', async () => {
    const g = await load()
    await expect(g.connectGoogle('  ')).rejects.toThrow(/client ID/)
    expect(scripts).toHaveLength(0)
  })

  it('loads the GIS script once, stores the token and resets cache', async () => {
    const g = await load()
    g.useGoogle.setState({ events: { k: [] }, fetchedAt: { k: 1 }, error: 'old' })
    const p = g.connectGoogle('cid')
    expect(scripts).toHaveLength(1)
    expect(scripts[0].src).toBe('https://accounts.google.com/gsi/client')
    const oauth2 = oauth2Mock()
    win.google = { accounts: { oauth2 } }
    scripts[0].onload!()
    await p
    expect(oauth2.initTokenClient).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'cid', scope: expect.stringContaining('calendar.events') }))
    const st = g.useGoogle.getState()
    expect(st.token).toBe('tok')
    expect(st.error).toBeUndefined()
    expect(st.events).toEqual({})
    expect(JSON.parse(storage.map.get(TOKEN_KEY)!).token).toBe('tok')
    expect(g.isConnected()).toBe(true)
    // second connect reuses the loaded library
    await g.connectGoogle('cid')
    expect(scripts).toHaveLength(1)
  })

  it('passes login_hint so Calendar uses the signed-in Google account, and omits it otherwise', async () => {
    const g = await load()
    const oauth2 = oauth2Mock()
    win.google = { accounts: { oauth2 } }
    await g.connectGoogle('cid', 'tim@gmail.com')
    expect(oauth2.initTokenClient.mock.calls[0][0].login_hint).toBe('tim@gmail.com')
    await g.connectGoogle('cid')
    expect('login_hint' in oauth2.initTokenClient.mock.calls[1][0]).toBe(false)
  })

  it('closed popup explains the test-user fix', async () => {
    const g = await load()
    win.google = { accounts: { oauth2: oauth2Mock({ error: { type: 'popup_closed' } }) } }
    await expect(g.connectGoogle('cid')).rejects.toThrow(/test user/)
  })

  it('script load failure rejects, removes the tag, and a retry injects a new one', async () => {
    const g = await load()
    const p1 = g.connectGoogle('cid')
    scripts[0].onerror!()
    await expect(p1).rejects.toThrow(/Could not load Google sign-in/)
    expect(scripts).toHaveLength(0)
    const p2 = g.connectGoogle('cid')
    expect(scripts).toHaveLength(1)
    win.google = { accounts: { oauth2: oauth2Mock() } }
    scripts[0].onload!()
    await expect(p2).resolves.toBeUndefined()
  })

  it('script loads but google.accounts is missing (blocked) → rejects and allows retry', async () => {
    const g = await load()
    const p = g.connectGoogle('cid')
    scripts[0].onload!()
    await expect(p).rejects.toThrow(/Could not load/)
    g.connectGoogle('cid').catch(() => {})
    expect(scripts).toHaveLength(1)
  })

  it.each([
    [{ type: 'popup_closed' }, /closed/],
    [{ type: 'popup_failed_to_open' }, /blocked/],
    [{ type: 'unknown', message: 'weird' }, /weird/],
    [undefined, /failed/],
  ])('error_callback %o rejects', async (err, msg) => {
    const g = await load()
    win.google = { accounts: { oauth2: oauth2Mock({ error: err ?? null }) } }
    if (!err) win.google.accounts.oauth2 = { ...oauth2Mock(), initTokenClient: (cfg: any) => ({ requestAccessToken: () => cfg.error_callback(undefined) }) }
    await expect(g.connectGoogle('cid')).rejects.toThrow(msg)
    expect(g.isConnected()).toBe(false)
  })

  it('access_denied in the token response rejects and stores nothing', async () => {
    const g = await load()
    win.google = { accounts: { oauth2: oauth2Mock({ resp: { error: 'access_denied' } }) } }
    await expect(g.connectGoogle('cid')).rejects.toThrow(/denied/)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(g.useGoogle.getState().token).toBeUndefined()
  })

  it('other token errors surface error_description', async () => {
    const g = await load()
    win.google = { accounts: { oauth2: oauth2Mock({ resp: { error: 'invalid_request', error_description: 'Bad origin' } }) } }
    await expect(g.connectGoogle('cid')).rejects.toThrow('Bad origin')
  })

  it('rejects (and revokes) when the user unticks calendar scopes', async () => {
    const g = await load()
    const oauth2 = oauth2Mock({ granted: false })
    win.google = { accounts: { oauth2 } }
    await expect(g.connectGoogle('cid')).rejects.toThrow(/allow access/)
    expect(oauth2.revoke).toHaveBeenCalledWith('tok', expect.any(Function))
    expect(g.isConnected()).toBe(false)
  })

  it('still connects when sessionStorage.setItem throws', async () => {
    const g = await load()
    storage.setItem.mockImplementation(() => { throw new Error('QuotaExceeded') })
    win.google = { accounts: { oauth2: oauth2Mock() } }
    await g.connectGoogle('cid')
    expect(g.isConnected()).toBe(true)
  })

  it('defaults expiry to an hour when expires_in is missing', async () => {
    const g = await load()
    win.google = { accounts: { oauth2: oauth2Mock({ resp: { access_token: 'tok' } }) } }
    await g.connectGoogle('cid')
    expect(g.useGoogle.getState().expiresAt! - Date.now()).toBeGreaterThan(3_500_000)
  })
})

describe('disconnectGoogle', () => {
  it('revokes, clears storage, state and errors', async () => {
    const g = await connected()
    const oauth2 = oauth2Mock()
    win.google = { accounts: { oauth2 } }
    g.useGoogle.setState({ events: { k: [] }, fetchedAt: { k: 1 }, status: 'error', error: 'x' })
    g.disconnectGoogle()
    expect(oauth2.revoke).toHaveBeenCalledWith('saved', expect.any(Function))
    expect(storage.map.has(TOKEN_KEY)).toBe(false)
    expect(g.useGoogle.getState()).toMatchObject({ token: undefined, status: 'idle', error: undefined, events: {} })
  })
  it('works when GIS was never loaded', async () => {
    const g = await connected()
    expect(() => g.disconnectGoogle()).not.toThrow()
    expect(g.isConnected()).toBe(false)
  })
})

// ---- API errors ------------------------------------------------------------------------------
describe('listCalendars / request errors', () => {
  it('maps calendars and sends the bearer token', async () => {
    const g = await connected()
    const fetch = vi.fn(async () => json(200, { items: [
      { id: 'a', summary: 'A', summaryOverride: 'Mine', backgroundColor: '#f00', primary: true },
      { id: 'b', summary: 'B' },
    ] }))
    vi.stubGlobal('fetch', fetch)
    expect(await g.listCalendars()).toEqual([
      { id: 'a', summary: 'Mine', color: '#f00', primary: true },
      { id: 'b', summary: 'B', color: '#9CC3E8', primary: false },
    ])
    expect((fetch.mock.calls[0] as any)[1].headers.Authorization).toBe('Bearer saved')
  })
  it('handles a missing items array', async () => {
    const g = await connected()
    vi.stubGlobal('fetch', vi.fn(async () => json(200, {})))
    expect(await g.listCalendars()).toEqual([])
  })
  it('throws when not connected, without calling fetch', async () => {
    const g = await load()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(g.listCalendars()).rejects.toThrow(/Not connected/)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('401 disconnects and asks to reconnect', async () => {
    const g = await connected()
    vi.stubGlobal('fetch', vi.fn(async () => json(401)))
    await expect(g.listCalendars()).rejects.toThrow(/expired/)
    expect(g.isConnected()).toBe(false)
    expect(storage.map.has(TOKEN_KEY)).toBe(false)
  })
  it.each([
    [429, undefined, /rate-limiting/],
    [403, { error: { errors: [{ reason: 'rateLimitExceeded' }] } }, /rate-limiting/],
    [403, { error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, /rate-limiting/],
    [403, { error: { errors: [{ reason: 'forbidden' }] } }, /denied access/],
    [500, 'not json', /error 500/],
  ])('%i → friendly error and stays connected', async (status, body, msg) => {
    const g = await connected()
    vi.stubGlobal('fetch', vi.fn(async () => (body === 'not json' ? { status, ok: false, json: async () => { throw new SyntaxError() } } : json(status, body))))
    const err = await g.listCalendars().catch((e) => e)
    expect(err.message).toMatch(msg)
    expect(err.status).toBe(status)
    expect(g.isConnected()).toBe(true)
  })
  it('network failure (fetch throws) → readable error', async () => {
    const g = await connected()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(g.listCalendars()).rejects.toThrow(/Couldn't reach Google/)
    expect(g.isConnected()).toBe(true)
  })
})

// ---- event mapping -------------------------------------------------------------------------
describe('toGEvents', () => {
  let g: G
  beforeEach(async () => { g = await load() })
  const c = cal('c1')

  it('timed event → local date + HH:mm, keeps petalId', () => {
    const [e] = g.toGEvents(timed('e', '2026-01-05T09:30:00Z', '2026-01-05T10:45:00Z', { location: 'R1', htmlLink: 'L', extendedProperties: { private: { petalId: 'p1' } } }), c, '2026-01-01', '2026-01-31')
    expect(e).toEqual({ id: 'e', calendarId: 'c1', title: 'e', date: '2026-01-05', start: '09:30', end: '10:45', location: 'R1', color: '#123456', htmlLink: 'L', petalId: 'p1' })
  })
  it('converts offsets to local time (event at 23:30 New York = next day UTC)', () => {
    const [e] = g.toGEvents(timed('e', '2026-01-05T23:30:00-05:00', '2026-01-06T00:30:00-05:00'), c, '2026-01-01', '2026-01-31')
    expect(e).toMatchObject({ date: '2026-01-06', start: '04:30', end: '05:30' })
  })
  it('drops end time when the event crosses midnight', () => {
    const [e] = g.toGEvents(timed('e', '2026-01-05T23:00:00Z', '2026-01-06T01:00:00Z'), c, '2026-01-01', '2026-01-31')
    expect(e).toMatchObject({ date: '2026-01-05', start: '23:00', end: undefined })
  })
  it('untitled event → (busy)', () => {
    expect(g.toGEvents({ id: 'x', start: { date: '2026-01-05' }, end: { date: '2026-01-06' } }, c, '2026-01-01', '2026-01-31')[0].title).toBe('(busy)')
  })
  it('single all-day event has no time and one entry (end.date exclusive)', () => {
    const out = g.toGEvents({ id: 'x', summary: 'Hol', start: { date: '2026-01-05' }, end: { date: '2026-01-06' } }, c, '2026-01-01', '2026-01-31')
    expect(out).toHaveLength(1)
    expect(out[0].date).toBe('2026-01-05')
    expect(out[0].start).toBeUndefined()
    expect(out[0].end).toBeUndefined()
  })
  it('multi-day all-day event is expanded and clipped to the range', () => {
    const out = g.toGEvents({ id: 'x', start: { date: '2026-01-03' }, end: { date: '2026-01-08' } }, c, '2026-01-05', '2026-01-06')
    expect(out.map((e) => e.date)).toEqual(['2026-01-05', '2026-01-06'])
  })
  it('cancelled or malformed events are dropped', () => {
    expect(g.toGEvents({ id: 'x', status: 'cancelled', start: { date: '2026-01-05' } }, c, '2026-01-01', '2026-01-31')).toEqual([])
    expect(g.toGEvents({ id: 'x' }, c, '2026-01-01', '2026-01-31')).toEqual([])
  })
  it('timed event starting before the range is dropped', () => {
    expect(g.toGEvents(timed('e', '2026-01-04T23:00:00Z', '2026-01-05T01:00:00Z'), c, '2026-01-05', '2026-01-05')).toEqual([])
  })
})

// ---- syncing -------------------------------------------------------------------------------
describe('fetchEvents', () => {
  const FROM = '2026-01-05', TO = '2026-01-11', KEY = `${FROM}|${TO}`
  const okFor = (byCal: Record<string, any[] | number>) => vi.fn(async (url: string) => {
    const id = decodeURIComponent(url.match(/calendars\/([^/]+)\/events/)![1])
    const v = byCal[id]
    return typeof v === 'number' ? json(v) : json(200, { items: v })
  })

  it('fetches each calendar with the right range and stores events', async () => {
    const g = await connected()
    const fetch = okFor({ a: [timed('e1', '2026-01-06T10:00:00Z', '2026-01-06T11:00:00Z')], 'b@group': [{ id: 'e2', start: { date: '2026-01-07' }, end: { date: '2026-01-08' } }] })
    vi.stubGlobal('fetch', fetch)
    await g.fetchEvents([cal('a'), cal('b@group')], FROM, TO)
    const url = new URL((fetch.mock.calls[0] as any)[0])
    expect(url.searchParams.get('timeMin')).toBe('2026-01-05T00:00:00.000Z')
    expect(url.searchParams.get('timeMax')).toBe('2026-01-12T00:00:00.000Z')
    expect(url.searchParams.get('singleEvents')).toBe('true')
    expect((fetch.mock.calls[1] as any)[0]).toContain('/calendars/b%40group/events')
    const st = g.useGoogle.getState()
    expect(st.status).toBe('idle')
    expect(st.events[KEY].map((e) => e.id)).toEqual(['e1', 'e2'])
  })

  it('filters cancelled events but keeps pushed ones (tagged) for agenda to dedupe', async () => {
    const g = await connected()
    vi.stubGlobal('fetch', okFor({ a: [
      { id: 'x', status: 'cancelled', start: { date: '2026-01-06' } },
      { id: 'p', start: { date: '2026-01-06' }, end: { date: '2026-01-07' }, extendedProperties: { private: { petalId: 'it1' } } },
    ] }))
    await g.fetchEvents([cal('a')], FROM, TO)
    expect(g.useGoogle.getState().events[KEY]).toEqual([expect.objectContaining({ id: 'p', petalId: 'it1' })])
  })

  it('does nothing when disconnected or no calendars are enabled', async () => {
    const fetch = vi.fn()
    let g = await load()
    vi.stubGlobal('fetch', fetch)
    await g.fetchEvents([cal('a')], FROM, TO)
    g = await connected()
    vi.stubGlobal('fetch', fetch)
    await g.fetchEvents([], FROM, TO)
    expect(fetch).not.toHaveBeenCalled()
    expect(g.useGoogle.getState().status).toBe('idle')
  })

  it('caches per range for 5 minutes; force and expiry refetch; other ranges fetch separately', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-05T08:00:00Z'))
    const g = await connected()
    const fetch = okFor({ a: [] })
    vi.stubGlobal('fetch', fetch)
    await g.fetchEvents([cal('a')], FROM, TO)
    await g.fetchEvents([cal('a')], FROM, TO)
    expect(fetch).toHaveBeenCalledTimes(1)
    await g.fetchEvents([cal('a')], FROM, '2026-01-12')
    expect(fetch).toHaveBeenCalledTimes(2)
    await g.fetchEvents([cal('a')], FROM, TO, true)
    expect(fetch).toHaveBeenCalledTimes(3)
    vi.setSystemTime(new Date('2026-01-05T08:06:00Z'))
    await g.fetchEvents([cal('a')], FROM, TO)
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('dedupes concurrent requests for the same range', async () => {
    const g = await connected()
    const fetch = okFor({ a: [] })
    vi.stubGlobal('fetch', fetch)
    await Promise.all([g.fetchEvents([cal('a')], FROM, TO), g.fetchEvents([cal('a')], FROM, TO)])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('one failing calendar does not hide the others', async () => {
    const g = await connected()
    vi.stubGlobal('fetch', okFor({ a: [timed('e1', '2026-01-06T10:00:00Z', '2026-01-06T11:00:00Z')], bad: 404 }))
    await g.fetchEvents([cal('a'), cal('bad')], FROM, TO)
    const st = g.useGoogle.getState()
    expect(st.status).toBe('idle')
    expect(st.events[KEY].map((e) => e.id)).toEqual(['e1'])
    expect(st.error).toMatch(/some calendars/)
  })

  it('all calendars failing → error status, not cached, and a retry recovers and clears the error', async () => {
    const g = await connected()
    vi.stubGlobal('fetch', okFor({ a: 500 }))
    await g.fetchEvents([cal('a')], FROM, TO)
    let st = g.useGoogle.getState()
    expect(st).toMatchObject({ status: 'error', error: 'Google Calendar error 500' })
    expect(st.fetchedAt[KEY]).toBeUndefined()
    vi.stubGlobal('fetch', okFor({ a: [] }))
    await g.fetchEvents([cal('a')], FROM, TO)
    st = g.useGoogle.getState()
    expect(st).toMatchObject({ status: 'idle', error: undefined })
    expect(st.events[KEY]).toEqual([])
  })

  it('network failure never leaves status stuck on loading', async () => {
    const g = await connected()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const p = g.fetchEvents([cal('a')], FROM, TO)
    expect(g.useGoogle.getState().status).toBe('loading')
    await p
    expect(g.useGoogle.getState()).toMatchObject({ status: 'error', error: expect.stringMatching(/reach Google/) })
  })

  it('401 while syncing disconnects and shows the expired message', async () => {
    const g = await connected()
    vi.stubGlobal('fetch', okFor({ a: 401 }))
    await g.fetchEvents([cal('a')], FROM, TO)
    expect(g.isConnected()).toBe(false)
    expect(g.useGoogle.getState()).toMatchObject({ status: 'error', error: expect.stringMatching(/expired/), events: {} })
  })

  it('stays loading while another range is still in flight', async () => {
    const g = await connected()
    let release!: () => void
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('2026-01-19')) await new Promise<void>((r) => { release = r })
      return json(200, { items: [] })
    }))
    const slow = g.fetchEvents([cal('a')], '2026-01-12', '2026-01-18')
    await g.fetchEvents([cal('a')], FROM, TO)
    expect(g.useGoogle.getState().status).toBe('loading')
    release()
    await slow
    expect(g.useGoogle.getState().status).toBe('idle')
  })

  it('discards a response that was in flight when the cache was cleared (calendar toggled)', async () => {
    const g = await connected()
    let release!: () => void
    vi.stubGlobal('fetch', vi.fn(async () => { await new Promise<void>((r) => { release = r }); return json(200, { items: [timed('old', '2026-01-06T10:00:00Z', '2026-01-06T11:00:00Z')] }) }))
    const p = g.fetchEvents([cal('a')], FROM, TO)
    await Promise.resolve()
    g.clearGoogleCache()
    release()
    await p
    const st = g.useGoogle.getState()
    expect(st.events[KEY]).toBeUndefined()
    expect(st.fetchedAt[KEY]).toBeUndefined()
    expect(st.status).toBe('idle')
  })

  it('discards a response that lands after disconnect', async () => {
    const g = await connected()
    let release!: () => void
    vi.stubGlobal('fetch', vi.fn(async () => { await new Promise<void>((r) => { release = r }); return json(200, { items: [] }) }))
    const p = g.fetchEvents([cal('a')], FROM, TO)
    await Promise.resolve()
    g.disconnectGoogle()
    release()
    await p
    expect(g.useGoogle.getState()).toMatchObject({ events: {}, status: 'idle', error: undefined })
  })
})

// ---- pushing -------------------------------------------------------------------------------
describe('itemToEvent / toRRule', () => {
  let g: G
  beforeEach(async () => { g = await load() })

  it('timed item → dateTime + timeZone, default 1h end, petalId tag', () => {
    const ev = g.itemToEvent(base({ start: '09:00', location: 'Hall', notes: 'n' }), 'Europe/Berlin')
    expect(ev).toMatchObject({
      summary: 'Exam', location: 'Hall', description: 'n', status: 'confirmed',
      start: { dateTime: '2026-01-05T09:00:00', timeZone: 'Europe/Berlin' },
      end: { dateTime: '2026-01-05T10:00:00', timeZone: 'Europe/Berlin' },
      extendedProperties: { private: { petalId: 'it1' } },
    })
    expect(ev).not.toHaveProperty('recurrence')
  })
  it('end before start → 1h; late start caps at 23:59', () => {
    expect(g.itemToEvent(base({ start: '10:00', end: '09:00' }), 'UTC').end).toEqual({ dateTime: '2026-01-05T11:00:00', timeZone: 'UTC' })
    expect(g.itemToEvent(base({ start: '23:30' }), 'UTC').end).toEqual({ dateTime: '2026-01-05T23:59:00', timeZone: 'UTC' })
  })
  it('all-day item → exclusive end date (month rollover)', () => {
    expect(g.itemToEvent(base({ date: '2026-01-31' }))).toMatchObject({ start: { date: '2026-01-31' }, end: { date: '2026-02-01' } })
  })
  it('weekly byDay is sorted; default day from date', () => {
    expect(g.toRRule(base({ recurrence: { freq: 'weekly', byDay: [3, 1] } }))).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO,WE')
    expect(g.toRRule(base({ recurrence: { freq: 'weekly' } }))).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO')
  })
  it('biweekly uses INTERVAL=2 with Sunday week start (matches dates.ts)', () => {
    expect(g.toRRule(base({ recurrence: { freq: 'biweekly', byDay: [0, 2] } }))).toBe('RRULE:FREQ=WEEKLY;INTERVAL=2;WKST=SU;BYDAY=SU,TU')
  })
  it('weekdays / daily / monthly / yearly', () => {
    expect(g.toRRule(base({ recurrence: { freq: 'weekdays' } }))).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')
    expect(g.toRRule(base({ recurrence: { freq: 'daily' } }))).toBe('RRULE:FREQ=DAILY')
    expect(g.toRRule(base({ recurrence: { freq: 'monthly' } }))).toBe('RRULE:FREQ=MONTHLY')
    expect(g.toRRule(base({ recurrence: { freq: 'yearly' } }))).toBe('RRULE:FREQ=YEARLY')
  })
  it('UNTIL: DATE for all-day, UTC end of local day for timed', () => {
    expect(g.toRRule(base({ recurrence: { freq: 'daily', until: '2026-02-01' } }))).toBe('RRULE:FREQ=DAILY;UNTIL=20260201')
    expect(g.toRRule(base({ start: '09:00', recurrence: { freq: 'daily', until: '2026-02-01' } }))).toBe('RRULE:FREQ=DAILY;UNTIL=20260201T235959Z')
  })
  it('exceptions become EXDATEs', () => {
    expect(g.itemToEvent(base({ start: '09:00', recurrence: { freq: 'daily', exceptions: ['2026-01-07'] } }), 'Europe/Berlin').recurrence)
      .toEqual(['RRULE:FREQ=DAILY', 'EXDATE;TZID=Europe/Berlin:20260107T090000'])
    expect(g.toRecurrence(base({ recurrence: { freq: 'daily', exceptions: ['2026-01-07'] } })))
      .toEqual(['RRULE:FREQ=DAILY', 'EXDATE;VALUE=DATE:20260107'])
  })
})

describe('pushItem / removePushed', () => {
  it('creates a new event with POST on primary', async () => {
    const g = await connected()
    const fetch = vi.fn(async () => json(200, { id: 'new1' }))
    vi.stubGlobal('fetch', fetch)
    expect(await g.pushItem(base({}))).toEqual({ calendarId: 'primary', eventId: 'new1' })
    const [url, init] = fetch.mock.calls[0] as any
    expect(url).toMatch(/\/calendars\/primary\/events$/)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body).extendedProperties.private.petalId).toBe('it1')
  })
  it('updates an existing event with PUT', async () => {
    const g = await connected()
    const fetch = vi.fn(async () => json(200, { id: 'e1' }))
    vi.stubGlobal('fetch', fetch)
    const gcal = { calendarId: 'me@x.com', eventId: 'e1' }
    expect(await g.pushItem(base({ gcal }))).toBe(gcal)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect((fetch.mock.calls[0] as any)[0]).toMatch(/calendars\/me%40x\.com\/events\/e1$/)
    expect((fetch.mock.calls[0] as any)[1].method).toBe('PUT')
  })
  it.each([404, 410])('PUT %i (deleted on Google) falls back to POST', async (status) => {
    const g = await connected()
    const fetch = vi.fn().mockResolvedValueOnce(json(status)).mockResolvedValueOnce(json(200, { id: 'new2' }))
    vi.stubGlobal('fetch', fetch)
    expect(await g.pushItem(base({ gcal: { calendarId: 'primary', eventId: 'gone' } }))).toEqual({ calendarId: 'primary', eventId: 'new2' })
    expect(fetch.mock.calls[1][1].method).toBe('POST')
  })
  it.each([
    ['rate limit', () => json(429)],
    ['server error', () => json(500)],
    ['network', () => { throw new TypeError('Failed to fetch') }],
  ])('PUT failing with %s does NOT create a duplicate', async (_, impl) => {
    const g = await connected()
    const fetch = vi.fn(async () => impl())
    vi.stubGlobal('fetch', fetch)
    await expect(g.pushItem(base({ gcal: { calendarId: 'primary', eventId: 'e1' } }))).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('PUT 401 disconnects and does not POST', async () => {
    const g = await connected()
    const fetch = vi.fn(async () => json(401))
    vi.stubGlobal('fetch', fetch)
    await expect(g.pushItem(base({ gcal: { calendarId: 'primary', eventId: 'e1' } }))).rejects.toThrow(/expired/)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(g.isConnected()).toBe(false)
  })
  it('throws when not connected', async () => {
    const g = await load()
    await expect(g.pushItem(base({}))).rejects.toThrow(/Not connected/)
  })
  it('removePushed sends DELETE, treats 404/410 as done, rethrows offline/5xx', async () => {
    const g = await connected()
    const fetch = vi.fn(async () => json(204))
    vi.stubGlobal('fetch', fetch)
    await g.removePushed(base({ gcal: { calendarId: 'primary', eventId: 'e1' } }))
    expect((fetch.mock.calls[0] as any)[1].method).toBe('DELETE')
    fetch.mockImplementation(async () => json(410))
    await expect(g.removePushed(base({ gcal: { calendarId: 'primary', eventId: 'e1' } }))).resolves.toBeUndefined()
    fetch.mockImplementation(async () => json(404))
    await expect(g.removePushed(base({ gcal: { calendarId: 'primary', eventId: 'e1' } }))).resolves.toBeUndefined()
    fetch.mockImplementation(async () => { throw new TypeError('offline') })
    await expect(g.removePushed(base({ gcal: { calendarId: 'primary', eventId: 'e1' } }))).rejects.toThrow()
    fetch.mockImplementation(async () => json(503))
    await expect(g.removePushed(base({ gcal: { calendarId: 'primary', eventId: 'e1' } }))).rejects.toThrow()
  })
  it('removePushed is a no-op without gcal or when disconnected', async () => {
    let g = await connected()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await g.removePushed(base({}))
    g = await load()
    vi.stubGlobal('fetch', fetch)
    await g.removePushed(base({ gcal: { calendarId: 'primary', eventId: 'e1' } }))
    expect(fetch).not.toHaveBeenCalled()
  })
})
