import type { State } from '../../store/store'

/**
 * Maps the planner state to/from flat records (one per entity) for the Supabase `records` table.
 * Pure functions — no I/O — so the sync rules are unit-testable.
 */
export interface Rec { kind: string; id: string; data: unknown; deleted: boolean; updated_at: number; rev?: number }
export type Snapshot = Map<string, string> // `${kind}:${id}` → JSON of data

// Arrays of entities with `id`. `ordered` ones keep their user-visible order via an `_i` field.
const LISTS = {
  items: { kind: 'item', ordered: false }, courses: { kind: 'course', ordered: true }, recipes: { kind: 'recipe', ordered: false },
  workouts: { kind: 'workout', ordered: false }, habits: { kind: 'habit', ordered: true }, txns: { kind: 'txn', ordered: false },
  categories: { kind: 'category', ordered: true }, grocery: { kind: 'grocery', ordered: true },
  accounts: { kind: 'account', ordered: true }, goals: { kind: 'goal', ordered: true },
} as const satisfies Partial<Record<keyof State, { kind: string; ordered: boolean }>>
// Objects keyed by date.
const MAPS = { mealPlan: 'meal', wellness: 'wellness' } as const satisfies Partial<Record<keyof State, string>>
// Device-only settings that must not travel between devices.
const LOCAL_SETTINGS = ['healthLastSync', 'onboarded', 'demo'] as const

type ListKey = keyof typeof LISTS
type MapKey = keyof typeof MAPS
export const SYNCED_KEYS = [...Object.keys(LISTS), ...Object.keys(MAPS), 'settings', 'pages'] as (keyof State)[]

export const keyOf = (kind: string, id: string) => `${kind}:${id}`
const splitKey = (k: string) => { const i = k.indexOf(':'); return [k.slice(0, i), k.slice(i + 1)] as const }

/** Every synced entity as key → JSON. */
export function snapshot(s: State): Snapshot {
  const out: Snapshot = new Map()
  for (const [field, { kind, ordered }] of Object.entries(LISTS) as [ListKey, (typeof LISTS)[ListKey]][]) {
    (s[field] as { id: string }[]).forEach((e, i) => out.set(keyOf(kind, e.id), JSON.stringify(ordered ? { ...e, _i: i } : e)))
  }
  for (const [field, kind] of Object.entries(MAPS) as [MapKey, string][]) {
    for (const [date, v] of Object.entries(s[field])) if (v && Object.keys(v).length) out.set(keyOf(kind, date), JSON.stringify(v))
  }
  const settings: Record<string, unknown> = { ...s.settings }
  for (const k of LOCAL_SETTINGS) delete settings[k]
  out.set(keyOf('settings', 'me'), JSON.stringify(settings))
  out.set(keyOf('pages', 'me'), JSON.stringify(s.pages))
  return out
}

/** What changed locally since `base` (the last state both sides agreed on). */
export function diff(base: Snapshot, cur: Snapshot): { upserts: string[]; deletes: string[] } {
  const upserts: string[] = [], deletes: string[] = []
  for (const [k, v] of cur) if (base.get(k) !== v) upserts.push(k)
  for (const k of base.keys()) if (!cur.has(k)) deletes.push(k)
  return { upserts, deletes }
}

export function toRec(snap: Snapshot, key: string, updated_at: number, deleted = false): Rec {
  const [kind, id] = splitKey(key)
  return { kind, id, deleted, updated_at, data: deleted ? null : JSON.parse(snap.get(key)!) }
}

/** Apply remote records onto a state, returning only the changed top-level fields. Unknown kinds are ignored. */
export function applyRecords(s: State, recs: Rec[]): Partial<State> {
  const patch: Partial<Record<keyof State, unknown>> = {}
  const listByKind = Object.fromEntries(Object.entries(LISTS).map(([f, v]) => [v.kind, f as ListKey]))
  const mapByKind = Object.fromEntries(Object.entries(MAPS).map(([f, k]) => [k, f as MapKey]))
  const lists = new Map<ListKey, Map<string, { e: Record<string, unknown>; i: number }>>()
  const list = (f: ListKey) => {
    let m = lists.get(f)
    if (!m) { m = new Map((s[f] as { id: string }[]).map((e, i) => [e.id, { e: e as unknown as Record<string, unknown>, i }])); lists.set(f, m) }
    return m
  }
  for (const r of recs) {
    if (listByKind[r.kind]) {
      const m = list(listByKind[r.kind])
      if (r.deleted || r.data == null) m.delete(r.id)
      else { const { _i, ...e } = r.data as Record<string, unknown>; m.set(r.id, { e, i: typeof _i === 'number' ? _i : m.get(r.id)?.i ?? 1e9 }) }
    } else if (mapByKind[r.kind]) {
      const f = mapByKind[r.kind]
      const next = { ...((patch[f] as object) ?? s[f]) } as Record<string, unknown>
      if (r.deleted || r.data == null) delete next[r.id]; else next[r.id] = r.data
      patch[f] = next
    } else if (r.kind === 'settings' && !r.deleted && r.data) {
      const keep = Object.fromEntries(LOCAL_SETTINGS.map((k) => [k, s.settings[k]]))
      patch.settings = { ...s.settings, ...(r.data as object), ...keep }
    } else if (r.kind === 'pages' && !r.deleted && r.data) {
      patch.pages = { ...s.pages, ...(r.data as object) }
    }
  }
  for (const [f, m] of lists) {
    const ordered = LISTS[f].ordered
    const arr = [...m.values()]
    if (ordered) arr.sort((a, b) => a.i - b.i)
    patch[f] = arr.map((x) => x.e)
  }
  return patch as Partial<State>
}

/** State built purely from remote records (used when a device adopts the account's data). */
export function fromRecords(empty: State, recs: Rec[]): Partial<State> {
  const blank: State = { ...empty, ...Object.fromEntries(Object.keys(LISTS).map((k) => [k, []])), mealPlan: {}, wellness: {} }
  return { ...pick(blank), ...applyRecords(blank, recs) }
}
const pick = (s: State) => Object.fromEntries(SYNCED_KEYS.map((k) => [k, s[k]])) as Partial<State>

/** Cheap stable hash so the per-device sync metadata doesn't store a second copy of all data. */
export function hash(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519) }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + s.length.toString(36)
}
export const hashSnapshot = (snap: Snapshot): Snapshot => new Map([...snap].map(([k, v]) => [k, hash(v)]))
