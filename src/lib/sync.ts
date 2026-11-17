import { useStore } from '../store/store'
import type { Item } from '../store/types'
import { isConnected, pushItem, removePushed } from './google'

/**
 * Planner ↔ Google push rules. Local state is the source of truth; Google is a mirror.
 * - Never resurrect an item deleted while a request was in flight; never overwrite newer local edits.
 * - Keep `gcal` whenever we couldn't reach Google, so a later save updates (or deletes) the same event
 *   instead of creating a duplicate or orphaning it.
 */
export type SyncResult = { ok: true; message: string } | { ok: false; message: string }

const OFFLINE = 'Google isn’t connected — reconnect in Settings to sync'

/** Attach the gcal ref to the *current* stored version of the item, if it still exists. */
function attachGcal(id: string, gcal: Item['gcal']) {
  const st = useStore.getState()
  const cur = st.items.find((i) => i.id === id)
  if (cur) st.upsertItem({ ...cur, gcal })
}

/** Call after the item has been saved locally. `wantPush` = the "put on Google Calendar" checkbox. */
export async function syncAfterSave(item: Item, wantPush: boolean): Promise<SyncResult | undefined> {
  if (wantPush) {
    if (!isConnected()) return { ok: false, message: `Saved · ${OFFLINE}` }
    try {
      const gcal = await pushItem(item)
      attachGcal(item.id, gcal)
      return { ok: true, message: 'Saved · synced to Google Calendar' }
    } catch (e: any) { return { ok: false, message: `Saved here, but Google sync failed: ${e.message}` } }
  }
  if (item.gcal) {
    if (!isConnected()) return { ok: false, message: `Saved · ${OFFLINE} (the Google copy stays until then)` }
    try {
      await removePushed(item)
      attachGcal(item.id, undefined)
      return { ok: true, message: 'Saved · removed from Google Calendar' }
    } catch (e: any) { return { ok: false, message: `Saved here, but couldn’t remove it from Google: ${e.message}` } }
  }
  return undefined
}

/** Delete locally and from Google. Returns an undo that restores the item *with* its gcal ref. */
export async function deleteSynced(item: Item): Promise<{ undo: () => void; warning?: string }> {
  useStore.getState().deleteItem(item.id)
  const undo = () => useStore.getState().addItems([item]) // keep gcal: a later push PUTs (and restores) the same event
  if (!item.gcal) return { undo }
  if (!isConnected()) return { undo, warning: 'Deleted here — reconnect Google to remove the copy there' }
  try { await removePushed(item); return { undo } } catch { return { undo, warning: 'Deleted here, but the Google copy couldn’t be removed' } }
}

/** Skip one occurrence and mirror the new EXDATE to Google. */
export async function skipSynced(id: string, date: string): Promise<SyncResult | undefined> {
  useStore.getState().skipOccurrence(id, date)
  const cur = useStore.getState().items.find((i) => i.id === id)
  if (!cur?.gcal) return undefined
  if (!isConnected()) return { ok: false, message: OFFLINE }
  try { attachGcal(id, await pushItem(cur)); return { ok: true, message: 'Skipped · updated on Google' } }
  catch (e: any) { return { ok: false, message: `Skipped here, but Google update failed: ${e.message}` } }
}
