import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Item } from '../../store/types'

vi.mock('idb-keyval', () => ({ createStore: () => ({}), get: async () => undefined, set: async () => {}, del: async () => {} }))
const g = vi.hoisted(() => ({ connected: true, pushItem: vi.fn(), removePushed: vi.fn() }))
vi.mock('../google', () => ({ isConnected: () => g.connected, pushItem: g.pushItem, removePushed: g.removePushed }))

const { useStore } = await import('../../store/store')
const { syncAfterSave, deleteSynced, skipSynced } = await import('../sync')

const GC = { calendarId: 'primary', eventId: 'ev1' }
const item = (p: Partial<Item> = {}): Item => ({ id: 'a', kind: 'exam', title: 'Midterm', date: '2026-12-01', createdAt: 0, ...p })
const stored = () => useStore.getState().items.find((i) => i.id === 'a')

beforeEach(() => {
  useStore.setState({ items: [] })
  g.connected = true
  g.pushItem.mockReset().mockResolvedValue(GC)
  g.removePushed.mockReset().mockResolvedValue(undefined)
})

describe('syncAfterSave', () => {
  it('pushes and attaches gcal to the stored item', async () => {
    useStore.getState().upsertItem(item())
    const r = await syncAfterSave(item(), true)
    expect(r?.ok).toBe(true)
    expect(stored()?.gcal).toEqual(GC)
  })
  it('does not resurrect an item deleted while the push was in flight', async () => {
    useStore.getState().upsertItem(item())
    g.pushItem.mockImplementation(async () => { useStore.getState().deleteItem('a'); return GC })
    await syncAfterSave(item(), true)
    expect(stored()).toBeUndefined()
  })
  it('does not overwrite edits made while the push was in flight', async () => {
    useStore.getState().upsertItem(item())
    g.pushItem.mockImplementation(async () => { useStore.getState().upsertItem(item({ title: 'Renamed' })); return GC })
    await syncAfterSave(item(), true)
    expect(stored()).toMatchObject({ title: 'Renamed', gcal: GC })
  })
  it('reports failure (not "synced") when push fails, item stays saved', async () => {
    useStore.getState().upsertItem(item())
    g.pushItem.mockRejectedValue(new Error('Google is rate-limiting'))
    const r = await syncAfterSave(item(), true)
    expect(r).toMatchObject({ ok: false })
    expect(r!.message).toMatch(/rate-limiting/)
    expect(stored()).toBeDefined()
  })
  it('push ticked while disconnected: warns, sends nothing', async () => {
    g.connected = false
    const r = await syncAfterSave(item(), true)
    expect(r).toMatchObject({ ok: false })
    expect(r!.message).toMatch(/reconnect/i)
    expect(g.pushItem).not.toHaveBeenCalled()
  })
  it('unticking push removes the Google copy and clears gcal', async () => {
    useStore.getState().upsertItem(item({ gcal: GC }))
    const r = await syncAfterSave(item({ gcal: GC }), false)
    expect(g.removePushed).toHaveBeenCalled()
    expect(r?.ok).toBe(true)
    expect(stored()?.gcal).toBeUndefined()
  })
  it('unticking while disconnected keeps gcal so the event is not orphaned', async () => {
    g.connected = false
    useStore.getState().upsertItem(item({ gcal: GC }))
    const r = await syncAfterSave(item({ gcal: GC }), false)
    expect(r?.ok).toBe(false)
    expect(stored()?.gcal).toEqual(GC)
  })
  it('unticking when the delete fails keeps gcal', async () => {
    useStore.getState().upsertItem(item({ gcal: GC }))
    g.removePushed.mockRejectedValue(new Error('offline'))
    expect((await syncAfterSave(item({ gcal: GC }), false))?.ok).toBe(false)
    expect(stored()?.gcal).toEqual(GC)
  })
  it('no push, never pushed: no-op', async () => {
    expect(await syncAfterSave(item(), false)).toBeUndefined()
    expect(g.pushItem).not.toHaveBeenCalled()
    expect(g.removePushed).not.toHaveBeenCalled()
  })
})

describe('deleteSynced', () => {
  it('deletes locally and on Google; undo restores with gcal (no duplicate on next push)', async () => {
    useStore.getState().upsertItem(item({ gcal: GC }))
    const { undo, warning } = await deleteSynced(item({ gcal: GC }))
    expect(stored()).toBeUndefined()
    expect(g.removePushed).toHaveBeenCalled()
    expect(warning).toBeUndefined()
    undo()
    expect(stored()?.gcal).toEqual(GC)
  })
  it('warns when disconnected or the Google delete fails', async () => {
    useStore.getState().upsertItem(item({ gcal: GC }))
    g.connected = false
    expect((await deleteSynced(item({ gcal: GC }))).warning).toMatch(/reconnect/i)
    g.connected = true
    useStore.getState().upsertItem(item({ gcal: GC }))
    g.removePushed.mockRejectedValue(new Error('503'))
    expect((await deleteSynced(item({ gcal: GC }))).warning).toMatch(/couldn’t be removed/)
    expect(stored()).toBeUndefined()
  })
  it('never-pushed item: no Google call', async () => {
    useStore.getState().upsertItem(item())
    await deleteSynced(item())
    expect(g.removePushed).not.toHaveBeenCalled()
  })
})

describe('skipSynced', () => {
  const rec = { recurrence: { freq: 'weekly' as const } }
  it('adds the exception and re-pushes so Google drops that date', async () => {
    useStore.getState().upsertItem(item({ ...rec, gcal: GC }))
    const r = await skipSynced('a', '2026-12-08')
    expect(stored()?.recurrence?.exceptions).toEqual(['2026-12-08'])
    expect(g.pushItem.mock.calls[0][0].recurrence.exceptions).toEqual(['2026-12-08'])
    expect(r?.ok).toBe(true)
  })
  it('skips locally even when disconnected, with a warning', async () => {
    g.connected = false
    useStore.getState().upsertItem(item({ ...rec, gcal: GC }))
    expect((await skipSynced('a', '2026-12-08'))?.ok).toBe(false)
    expect(stored()?.recurrence?.exceptions).toEqual(['2026-12-08'])
  })
  it('not pushed: no Google call', async () => {
    useStore.getState().upsertItem(item(rec))
    expect(await skipSynced('a', '2026-12-08')).toBeUndefined()
    expect(g.pushItem).not.toHaveBeenCalled()
  })
})
