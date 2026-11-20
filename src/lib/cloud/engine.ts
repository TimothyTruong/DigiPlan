import type { State } from '../../store/store'
import { applyRecords, diff, fromRecords, hashSnapshot, keyOf, snapshot, toRec, type Rec, type Snapshot } from './records'

/**
 * Local-first sync: the app always reads/writes its local store; this engine reconciles it with the server.
 * - `base` = hashes of the last version both sides agreed on, per record. Local diff vs base = what to push.
 * - `dirtyAt` = when each record was first seen changed locally (its last-writer-wins timestamp).
 * - Pull: rows with rev > cursor. A remote row is taken unless the local copy changed more recently.
 * - Push: changed/deleted records; the server keeps whichever write has the newer updated_at.
 * The cursor only advances from pulls (never from our own push revs) so writes from other devices are never skipped.
 */
export interface Remote {
  pull(since: number): Promise<Rec[]>
  push(recs: Rec[]): Promise<{ kind: string; id: string; rev: number }[]>
}
export interface LocalStore { get(): State; apply(patch: Partial<State>): void; empty(): State }
export interface Meta { cursor: number; base: Record<string, string>; dirtyAt: Record<string, number>; lastSyncedAt?: number }
export interface MetaStore { load(): Promise<Meta | undefined>; save(m: Meta): Promise<void> }
export type FirstSync = 'upload' | 'adopt' | 'merge'
export interface SyncResult { pulled: number; pushed: number; rejected: number }

const CHUNK = 200

/** Thrown instead of pushing a delete of most of the account (cleared browser, bad restore, "Clear all" by mistake). */
export class MassDeleteError extends Error {
  constructor(public count: number) { super(`This would delete ${count} things from your account`) }
}

export class SyncEngine {
  private m: Meta = { cursor: 0, base: {}, dirtyAt: {} }
  private running: Promise<SyncResult> | null = null
  private again = false
  private massDeleteOk = false

  constructor(private remote: Remote, private local: LocalStore, private metaStore: MetaStore, private now: () => number = Date.now) {}

  get meta(): Readonly<Meta> { return this.m }
  get pendingCount(): number { return this.pending().upserts.length + this.pending().deletes.length }

  /** Returns true if this device has synced with this account before. */
  async init(): Promise<boolean> {
    const saved = await this.metaStore.load()
    if (saved) this.m = saved
    return !!saved
  }

  /** Remember when local edits happened (call on every local state change, debounced). */
  noteLocalChange() {
    const { upserts, deletes } = this.pending()
    const changed = new Set([...upserts, ...deletes])
    const t = this.now()
    for (const k of changed) if (this.m.dirtyAt[k] === undefined) this.m.dirtyAt[k] = t
    for (const k of Object.keys(this.m.dirtyAt)) if (!changed.has(k)) delete this.m.dirtyAt[k] // edited back to the synced value
  }

  /** First sync on a device for an account. `recs` = the account's full contents (pull(0)). */
  async firstSync(mode: FirstSync, recs: Rec[]) {
    if (mode === 'adopt') {
      this.local.apply(fromRecords(this.local.empty(), recs.filter((r) => !r.deleted)))
      this.m = { cursor: maxRev(recs, 0), base: Object.fromEntries(hashSnapshot(snapshot(this.local.get()))), dirtyAt: {} }
    } else if (mode === 'merge') {
      const live = recs.filter((r) => !r.deleted)
      this.local.apply(applyRecords(this.local.get(), live)) // account wins on conflicts; local-only records get uploaded
      const cur = hashSnapshot(snapshot(this.local.get()))
      this.m = { cursor: maxRev(recs, 0), base: Object.fromEntries(live.map((r) => keyOf(r.kind, r.id)).filter((k) => cur.has(k)).map((k) => [k, cur.get(k)!])), dirtyAt: {} }
    } else {
      this.m = { cursor: maxRev(recs, 0), base: {}, dirtyAt: {} } // everything local is new to the server
    }
    await this.metaStore.save(this.m)
    return this.sync()
  }

  /** One pull+push round. Concurrent calls coalesce into at most one extra round. */
  sync(): Promise<SyncResult> {
    if (this.running) { this.again = true; return this.running }
    this.running = (async () => {
      let total: SyncResult = { pulled: 0, pushed: 0, rejected: 0 }
      try {
        do {
          this.again = false
          const r = await this.round()
          total = { pulled: total.pulled + r.pulled, pushed: total.pushed + r.pushed, rejected: total.rejected + r.rejected }
        } while (this.again)
        return total
      } finally { this.running = null }
    })()
    return this.running
  }

  /** The user confirmed a large delete: allow it for the next round only. */
  allowMassDeleteOnce() { this.massDeleteOk = true }

  /** Re-download everything on the next round (recovery path; cheap for planner-sized data). */
  resetCursor() { this.m.cursor = 0 }

  private pending() {
    const cur = hashSnapshot(snapshot(this.local.get()))
    return diff(new Map(Object.entries(this.m.base)), cur)
  }

  private async round(): Promise<SyncResult> {
    this.noteLocalChange()
    // 1. Pull
    const recs = await this.remote.pull(this.m.cursor)
    const accepted = recs.filter((r) => { const d = this.m.dirtyAt[keyOf(r.kind, r.id)]; return d === undefined || r.updated_at >= d })
    if (accepted.length) {
      this.local.apply(applyRecords(this.local.get(), accepted))
      const cur = hashSnapshot(snapshot(this.local.get()))
      for (const r of accepted) {
        const k = keyOf(r.kind, r.id)
        if (cur.has(k)) this.m.base[k] = cur.get(k)!; else delete this.m.base[k]
        delete this.m.dirtyAt[k]
      }
    }
    this.m.cursor = maxRev(recs, this.m.cursor)
    // 2. Push
    const snap: Snapshot = snapshot(this.local.get())
    const hashed = hashSnapshot(snap)
    const { upserts, deletes } = diff(new Map(Object.entries(this.m.base)), hashed)
    const synced = Object.keys(this.m.base).length
    if (!this.massDeleteOk && deletes.length >= 20 && deletes.length > synced / 2) throw new MassDeleteError(deletes.length)
    this.massDeleteOk = false
    const t = this.now()
    const out: Rec[] = [
      ...upserts.map((k) => toRec(snap, k, this.m.dirtyAt[k] ?? t)),
      ...deletes.map((k) => ({ ...splitRec(k), data: null, deleted: true, updated_at: this.m.dirtyAt[k] ?? t })),
    ]
    let pushed = 0, rejected = 0
    for (let i = 0; i < out.length; i += CHUNK) {
      const batch = out.slice(i, i + CHUNK)
      const applied = new Set((await this.remote.push(batch)).map((a) => keyOf(a.kind, a.id)))
      for (const r of batch) {
        const k = keyOf(r.kind, r.id)
        delete this.m.dirtyAt[k]
        if (applied.has(k)) { pushed++; if (r.deleted) delete this.m.base[k]; else this.m.base[k] = hashed.get(k)! }
        else { rejected++; this.m.cursor = 0 } // server holds a newer write we haven't seen: re-pull everything next round
      }
      await this.metaStore.save(this.m) // persist progress per chunk
    }
    this.m.lastSyncedAt = this.now()
    await this.metaStore.save(this.m)
    return { pulled: accepted.length, pushed, rejected }
  }
}

const maxRev = (recs: Rec[], start: number) => recs.reduce((m, r) => Math.max(m, Number(r.rev ?? 0)), start)
const splitRec = (k: string) => { const i = k.indexOf(':'); return { kind: k.slice(0, i), id: k.slice(i + 1) } }
