import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { State } from '../../../store/store'
import type { Item } from '../../../store/types'
import { MassDeleteError, SyncEngine, type Meta, type Remote } from '../engine'
import type { Rec } from '../records'
import { addUser, as, makeDb } from './pg'

vi.mock('idb-keyval', () => ({ createStore: () => ({}), get: async () => undefined, set: async () => {}, del: async () => {} }))
const { emptyState, demoState } = await import('../../../store/store')

const U = '00000000-0000-4000-8000-0000000000aa'
const V = '00000000-0000-4000-8000-0000000000bb'
let db: PGlite
let clock = 1_000

/** Remote backed by real Postgres + the production migration, calling it exactly like supabase-js would. */
function pgRemote(user: string, opts: { offline?: () => boolean } = {}): Remote {
  return {
    async pull(since) {
      if (opts.offline?.()) throw new TypeError('Failed to fetch')
      const r = await as(db, user, () => db.query<Rec>('select kind, id, data, deleted, updated_at::float8 as updated_at, rev::float8 as rev from records where rev > $1 order by rev', [since]))
      return r.rows
    },
    async push(recs) {
      if (opts.offline?.()) throw new TypeError('Failed to fetch')
      const r = await as(db, user, () => db.query<{ kind: string; id: string; rev: number }>('select kind, id, rev::float8 as rev from push_records($1::jsonb)', [JSON.stringify(recs)]))
      return r.rows
    },
  }
}
function device(user = U, init: State = emptyState(), opts: { offline?: () => boolean } = {}) {
  let state = init
  let meta: Meta | undefined
  const local = { get: () => state, apply: (p: Partial<State>) => { state = { ...state, ...p } }, empty: emptyState }
  const engine = new SyncEngine(pgRemote(user, opts), local, { load: async () => meta, save: async (m) => { meta = structuredClone(m) } }, () => clock)
  return {
    engine, get state() { return state },
    edit(fn: (s: State) => Partial<State>) { clock += 10; state = { ...state, ...fn(state) }; engine.noteLocalChange() },
    async savedMeta() { return meta },
  }
}
const item = (id: string, title: string): Item => ({ id, kind: 'task', title, date: '2026-11-20', createdAt: 0 })
const titles = (s: State) => s.items.map((i) => i.title).sort()

beforeEach(async () => { db = await makeDb(); await addUser(db, U); await addUser(db, V); clock = 1_000 }, 30_000)

describe('sync engine (two devices, real Postgres + RLS)', () => {
  it('upload from one device, adopt on another', async () => {
    const a = device()
    a.edit((s) => ({ items: [...s.items, item('1', 'Essay'), item('2', 'Lab')] }))
    await a.engine.firstSync('upload', await pgRemote(U).pull(0))
    const b = device()
    await b.engine.firstSync('adopt', await pgRemote(U).pull(0))
    expect(titles(b.state)).toEqual(['Essay', 'Lab'])
    expect((await b.engine.sync()).pushed).toBe(0) // adopting doesn't echo everything back
  })

  it('edits to different records on two devices both survive', async () => {
    const a = device(); await a.engine.firstSync('upload', [])
    const b = device(); await b.engine.firstSync('adopt', await pgRemote(U).pull(0))
    a.edit((s) => ({ items: [...s.items, item('a', 'From iPhone')] }))
    b.edit((s) => ({ items: [...s.items, item('b', 'From iPad')] }))
    await a.engine.sync(); await b.engine.sync(); await a.engine.sync()
    expect(titles(a.state)).toEqual(['From iPad', 'From iPhone'])
    expect(titles(b.state)).toEqual(['From iPad', 'From iPhone'])
  })

  it('same record edited on both: the later edit wins everywhere', async () => {
    const a = device(); a.edit(() => ({ items: [item('x', 'v0')] })); await a.engine.firstSync('upload', [])
    const b = device(); await b.engine.firstSync('adopt', await pgRemote(U).pull(0))
    a.edit(() => ({ items: [item('x', 'A early')] }))
    b.edit(() => ({ items: [item('x', 'B later')] }))
    await a.engine.sync()
    expect(titles(a.state)).toEqual(['A early'])  // its own echo must not revert it
    await b.engine.sync()
    expect(titles(b.state)).toEqual(['B later'])  // pulling an older remote edit must not clobber a newer local one
    await a.engine.sync()
    expect(titles(a.state)).toEqual(['B later'])
    expect(titles(b.state)).toEqual(['B later'])
    // and the reverse order of syncing gives the same result
    a.edit(() => ({ items: [item('x', 'A newest')] }))
    await b.engine.sync(); await a.engine.sync(); await b.engine.sync()
    expect(titles(b.state)).toEqual(['A newest'])
  })

  it('deletes propagate; a newer offline edit wins over an older delete (last writer wins)', async () => {
    const a = device(); a.edit(() => ({ items: [item('x', 'keep?'), item('y', 'gone')] })); await a.engine.firstSync('upload', [])
    const b = device(); await b.engine.firstSync('adopt', await pgRemote(U).pull(0))
    a.edit((s) => ({ items: s.items.filter((i) => i.id !== 'y') }))
    await a.engine.sync(); await b.engine.sync()
    expect(titles(b.state)).toEqual(['keep?'])
    a.edit(() => ({ items: [] }))            // A deletes x…
    b.edit(() => ({ items: [item('x', 'edited after')] })) // …then B edits it later
    await a.engine.sync(); await b.engine.sync(); await a.engine.sync()
    expect(titles(a.state)).toEqual(['edited after'])
  })

  it('offline: nothing is lost, it all goes up when back online', async () => {
    let offline = false
    const a = device(U, emptyState(), { offline: () => offline })
    await a.engine.firstSync('upload', [])
    offline = true
    a.edit((s) => ({ items: [...s.items, item('o', 'written on the train')] }))
    await expect(a.engine.sync()).rejects.toThrow(/fetch/)
    expect(a.engine.pendingCount).toBeGreaterThan(0)
    offline = false
    const r = await a.engine.sync()
    expect(r.pushed).toBeGreaterThan(0)
    const b = device(); await b.engine.firstSync('adopt', await pgRemote(U).pull(0))
    expect(titles(b.state)).toEqual(['written on the train'])
  })

  it('keeps user ordering, date-keyed maps and settings; device-only settings stay local', async () => {
    const a = device(U, demoState())
    a.edit((s) => ({ settings: { ...s.settings, name: 'Tim', healthLastSync: 123, demo: true } }))
    await a.engine.firstSync('upload', [])
    const b = device(); await b.engine.firstSync('adopt', await pgRemote(U).pull(0))
    expect(b.state.courses.map((c) => c.name)).toEqual(a.state.courses.map((c) => c.name))
    expect(b.state.categories.map((c) => c.name)).toEqual(a.state.categories.map((c) => c.name))
    expect(Object.keys(b.state.wellness).sort()).toEqual(Object.keys(a.state.wellness).sort())
    expect(b.state.mealPlan).toEqual(a.state.mealPlan)
    expect(b.state.settings.name).toBe('Tim')
    expect(b.state.settings.healthLastSync).toBeUndefined()
    expect(b.state.settings.demo).toBeUndefined()
  })

  it('merge on first sign-in: account wins conflicts, local-only records are uploaded', async () => {
    const a = device(); a.edit(() => ({ items: [item('shared', 'account version'), item('acct', 'account only')] })); await a.engine.firstSync('upload', [])
    const b = device(); b.edit(() => ({ items: [item('shared', 'local version'), item('loc', 'local only')] }))
    await b.engine.firstSync('merge', await pgRemote(U).pull(0))
    expect(titles(b.state)).toEqual(['account only', 'account version', 'local only'])
    await a.engine.sync()
    expect(titles(a.state)).toEqual(['account only', 'account version', 'local only'])
  })

  it('accounts are isolated end to end', async () => {
    const a = device(U); a.edit(() => ({ items: [item('1', 'U private')] })); await a.engine.firstSync('upload', [])
    const v = device(V); await v.engine.firstSync('adopt', await pgRemote(V).pull(0))
    expect(v.state.items).toEqual([])
  })

  it('persists progress and resumes from saved metadata', async () => {
    const a = device(); a.edit(() => ({ items: [item('1', 'x')] })); await a.engine.firstSync('upload', [])
    const m = await a.savedMeta()
    expect(m!.cursor).toBeGreaterThanOrEqual(0)
    expect(Object.keys(m!.base).length).toBeGreaterThan(0)
    expect(m!.lastSyncedAt).toBe(clock)
    expect(a.engine.pendingCount).toBe(0)
  })

  it('concurrent sync() calls coalesce', async () => {
    const a = device(); await a.engine.firstSync('upload', [])
    a.edit(() => ({ items: [item('1', 'x')] }))
    const [r1, r2] = await Promise.all([a.engine.sync(), a.engine.sync()])
    expect(r1).toBe(r2)
    expect(a.engine.pendingCount).toBe(0)
  })

  it('refuses to delete most of the account without confirmation', async () => {
    const a = device(U, demoState()); await a.engine.firstSync('upload', [])
    const total = a.state.items.length
    a.edit(() => ({ items: [], courses: [], recipes: [], workouts: [], habits: [], wellness: {}, txns: [] }))
    await expect(a.engine.sync()).rejects.toBeInstanceOf(MassDeleteError)
    const b = device(); await b.engine.firstSync('adopt', await pgRemote(U).pull(0))
    expect(b.state.items.length).toBe(total) // nothing was deleted server-side
    a.engine.allowMassDeleteOnce()
    await a.engine.sync()
    await b.engine.sync()
    expect(b.state.items).toEqual([])
  })
})
