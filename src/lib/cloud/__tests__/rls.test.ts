import { beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { addUser, as, makeDb } from './pg'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
let db: PGlite
const push = (rows: object[]) => db.query<{ kind: string; id: string; rev: string }>('select * from push_records($1::jsonb)', [JSON.stringify(rows)])
const mine = () => db.query<{ kind: string; id: string; data: any; deleted: boolean; updated_at: string; rev: string }>('select * from records order by rev')

beforeEach(async () => { db = await makeDb(); await addUser(db, A); await addUser(db, B) }, 30_000)

describe('records RLS', () => {
  it('users only ever see their own rows', async () => {
    await as(db, A, () => push([{ kind: 'item', id: 'x', data: { title: 'A secret' }, updated_at: 1 }]))
    await as(db, B, () => push([{ kind: 'item', id: 'x', data: { title: 'B secret' }, updated_at: 1 }]))
    const a = await as(db, A, mine), b = await as(db, B, mine)
    expect(a.rows.map((r) => r.data.title)).toEqual(['A secret'])
    expect(b.rows.map((r) => r.data.title)).toEqual(['B secret'])
  })
  it('cannot write, update or delete another user\'s rows even by naming their user_id', async () => {
    await as(db, A, () => push([{ kind: 'item', id: 'x', data: { v: 1 }, updated_at: 1 }]))
    await expect(as(db, B, () => db.query(`insert into records (user_id, kind, id, data, updated_at) values ($1, 'item', 'y', '{}', 1)`, [A]))).rejects.toThrow(/row-level security/)
    const upd = await as(db, B, () => db.query(`update records set data = '{"hacked":true}' where user_id = $1`, [A]))
    const del = await as(db, B, () => db.query(`delete from records where user_id = $1`, [A]))
    expect(upd.affectedRows).toBe(0)
    expect(del.affectedRows).toBe(0)
    expect((await as(db, A, mine)).rows[0].data).toEqual({ v: 1 })
  })
  it('a payload user_id is ignored: rows always belong to the caller', async () => {
    await as(db, B, () => push([{ user_id: A, kind: 'item', id: 'z', data: {}, updated_at: 1 } as object]))
    expect((await as(db, A, mine)).rows).toHaveLength(0)
    expect((await as(db, B, mine)).rows).toHaveLength(1)
  })
  it('signed-out (anon) has no access at all', async () => {
    await as(db, A, () => push([{ kind: 'item', id: 'x', data: {}, updated_at: 1 }]))
    await expect(as(db, null, () => db.query('select * from records'))).rejects.toThrow(/permission denied/)
    await expect(as(db, null, () => push([{ kind: 'item', id: 'q', data: {}, updated_at: 1 }]))).rejects.toThrow(/permission denied/)
  })
  it('deleting the auth user cascades their data', async () => {
    await as(db, A, () => push([{ kind: 'item', id: 'x', data: {}, updated_at: 1 }]))
    await db.query('delete from auth.users where id = $1', [A])
    expect((await db.query('select count(*)::int as n from records')).rows[0]).toEqual({ n: 0 })
  })
})

describe('push_records', () => {
  it('last writer wins by updated_at; stale writes are skipped and not returned', async () => {
    await as(db, A, () => push([{ kind: 'item', id: 'x', data: { v: 'new' }, updated_at: 200 }]))
    const stale = await as(db, A, () => push([{ kind: 'item', id: 'x', data: { v: 'old' }, updated_at: 100 }]))
    expect(stale.rows).toHaveLength(0)
    expect((await as(db, A, mine)).rows[0].data).toEqual({ v: 'new' })
    const newer = await as(db, A, () => push([{ kind: 'item', id: 'x', data: { v: 'newer' }, updated_at: 300 }]))
    expect(newer.rows).toHaveLength(1)
  })
  it('every write bumps rev (usable as a pull cursor)', async () => {
    const r1 = await as(db, A, () => push([{ kind: 'item', id: 'x', data: {}, updated_at: 1 }, { kind: 'course', id: 'c', data: {}, updated_at: 1 }]))
    const r2 = await as(db, A, () => push([{ kind: 'item', id: 'x', data: { v: 2 }, updated_at: 2 }]))
    const revs1 = r1.rows.map((r) => Number(r.rev)), rev2 = Number(r2.rows[0].rev)
    expect(rev2).toBeGreaterThan(Math.max(...revs1))
    const after = await as(db, A, () => db.query('select kind, id from records where rev > $1', [Math.max(...revs1)]))
    expect(after.rows).toEqual([{ kind: 'item', id: 'x' }])
  })
  it('tombstones drop data', async () => {
    await as(db, A, () => push([{ kind: 'item', id: 'x', data: { secret: 1 }, updated_at: 1 }]))
    await as(db, A, () => push([{ kind: 'item', id: 'x', data: { secret: 1 }, deleted: true, updated_at: 2 }]))
    expect((await as(db, A, mine)).rows[0]).toMatchObject({ deleted: true, data: null })
  })
  it('validates input', async () => {
    await expect(as(db, A, () => push([{ kind: 'BAD KIND', id: 'x', data: {}, updated_at: 1 }]))).rejects.toThrow(/check constraint/)
    await expect(as(db, A, () => db.query(`select * from push_records('{"a":1}'::jsonb)`))).rejects.toThrow(/array/)
    await expect(as(db, A, () => push(Array.from({ length: 501 }, (_, i) => ({ kind: 'item', id: String(i), data: {}, updated_at: 1 }))))).rejects.toThrow(/at most 500/)
  })
})
