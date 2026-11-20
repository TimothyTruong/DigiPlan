import { create } from 'zustand'
import { createStore, del, get, set } from 'idb-keyval'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { ROUTER_BASE } from '../../config'
import { emptyState, useStore } from '../../store/store'
import { cloudConfigured, getClient, supabaseRemote } from './client'
import { MassDeleteError, SyncEngine, type FirstSync, type Meta } from './engine'
import type { Rec } from './records'

/**
 * Accounts + background sync glue. Local data stays the source of truth for the UI; the engine reconciles it with
 * Supabase on startup, after edits (debounced), on focus/online, and every minute while visible.
 */
export type CloudStatus = 'off' | 'signed-out' | 'starting' | 'needs-choice' | 'syncing' | 'synced' | 'offline' | 'error' | 'confirm-delete'
export interface CloudUser { id: string; email?: string; name?: string; avatar?: string; provider?: string }
interface CloudState {
  status: CloudStatus
  user?: CloudUser
  error?: string
  lastSyncedAt?: number
  pending: number
  choice?: { remoteCount: number; localHasData: boolean; localIsDemo: boolean }
  massDelete?: number
}
export const useCloud = create<CloudState>(() => ({ status: cloudConfigured ? 'starting' : 'off', pending: 0 }))

const metaDb = createStore('petal-sync', 'meta')
let sb: SupabaseClient | undefined
let engine: SyncEngine | undefined
let firstRecs: Rec[] = []
let teardown: (() => void) | undefined
const redirectTo = () => `${location.origin}${ROUTER_BASE}/`

export async function initCloud() {
  if (!cloudConfigured) return
  try {
    sb = await getClient()
    const { data } = await sb.auth.getSession()
    if (data.session?.user) await start(data.session.user)
    else useCloud.setState({ status: 'signed-out' })
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user && session.user.id !== useCloud.getState().user?.id) start(session.user)
      if (event === 'SIGNED_OUT') { stop(); useCloud.setState({ status: 'signed-out', user: undefined }) }
    })
  } catch (e: any) {
    useCloud.setState({ status: 'error', error: e.message })
  }
}

export async function signInWithGoogle() {
  const c = sb ?? (await getClient())
  // Only identity scopes here. Calendar access is requested separately (Settings → Google Calendar) so sign-in
  // doesn't need Google's sensitive-scope verification.
  const { error } = await c.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo(), queryParams: { prompt: 'select_account' } } })
  if (error) throw new Error(error.message)
}

export async function signInWithEmail(email: string) {
  const c = sb ?? (await getClient())
  const { error } = await c.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirectTo(), shouldCreateUser: true } })
  if (error) throw new Error(error.message.includes('rate') ? 'Too many emails sent — try again in a little while, or use Google' : error.message)
}

/** Sign out. By default also removes the planner from this device (shared/lab computers). */
export async function signOut({ keepLocal = false } = {}) {
  const uid = useCloud.getState().user?.id
  stop()
  if (sb) await sb.auth.signOut()
  if (!keepLocal) {
    useStore.getState().replaceAll(emptyState())
    if (uid) await del(`sync:${uid}`, metaDb) // local copy is gone, so its sync bookkeeping must go too
  } else if (uid) {
    await del(`sync:${uid}`, metaDb) // kept data becomes "local only"; a later sign-in asks how to combine
  }
  useCloud.setState({ status: 'signed-out', user: undefined, lastSyncedAt: undefined, pending: 0, choice: undefined })
}

function toUser(u: User): CloudUser {
  const m = u.user_metadata ?? {}
  return { id: u.id, email: u.email, name: m.full_name ?? m.name, avatar: m.avatar_url, provider: u.app_metadata?.provider }
}

function localStatus() {
  const s = useStore.getState()
  const localHasData = [s.items, s.courses, s.recipes, s.workouts, s.habits, s.txns].some((a) => a.length > 0) || Object.keys(s.wellness).length > 0
  return { localHasData, localIsDemo: !!s.settings.demo }
}

async function start(u: User) {
  stop()
  useCloud.setState({ status: 'starting', user: toUser(u), error: undefined })
  const key = `sync:${u.id}`
  engine = new SyncEngine(
    supabaseRemote(sb!),
    { get: () => useStore.getState(), apply: (p) => useStore.setState(p), empty: emptyState },
    { load: () => get<Meta>(key, metaDb), save: (m) => set(key, m, metaDb) },
  )
  const known = await engine.init()
  if (known) { wire(); return run() }
  try {
    firstRecs = await supabaseRemote(sb!).pull(0)
  } catch (e: any) { useCloud.setState({ status: 'offline', error: e.message }); return }
  const remoteCount = firstRecs.filter((r) => !r.deleted && r.kind !== 'settings' && r.kind !== 'pages').length
  const { localHasData, localIsDemo } = localStatus()
  // Decide automatically when there's nothing to lose; otherwise ask.
  if (remoteCount === 0 && !localIsDemo) return resolveChoice('upload')
  if (remoteCount > 0 && (!localHasData || localIsDemo)) return resolveChoice('adopt')
  useCloud.setState({ status: 'needs-choice', choice: { remoteCount, localHasData, localIsDemo } })
}

/** Answer the first-sign-in question. 'fresh' = start the account empty (drops sample/local data). */
export async function resolveChoice(mode: FirstSync | 'fresh') {
  if (!engine) return
  useCloud.setState({ status: 'syncing', choice: undefined })
  try {
    if (mode === 'fresh') { useStore.getState().replaceAll(emptyState()); await engine.firstSync('upload', firstRecs) }
    else await engine.firstSync(mode, firstRecs)
    if (mode === 'adopt') useStore.setState((s) => ({ settings: { ...s.settings, demo: false } }))
    firstRecs = []
    wire()
    done()
  } catch (e) { fail(e) }
}

export async function confirmMassDelete(ok: boolean) {
  if (!engine) return
  if (ok) engine.allowMassDeleteOnce()
  else { // restore from the account instead
    const recs = await supabaseRemote(sb!).pull(0)
    await engine.firstSync('adopt', recs)
  }
  useCloud.setState({ massDelete: undefined })
  run()
}

export function syncNow() { return run() }

async function run() {
  if (!engine) return
  const st = useCloud.getState().status
  if (st === 'needs-choice' || st === 'confirm-delete') return
  useCloud.setState({ status: 'syncing' })
  try { await engine.sync(); done() } catch (e) { fail(e) }
}

function done() {
  useCloud.setState({ status: 'synced', error: undefined, lastSyncedAt: engine?.meta.lastSyncedAt, pending: engine?.pendingCount ?? 0 })
}
function fail(e: unknown) {
  if (e instanceof MassDeleteError) { useCloud.setState({ status: 'confirm-delete', massDelete: e.count }); return }
  const msg = e instanceof Error ? e.message : String(e)
  const offline = typeof navigator !== 'undefined' && !navigator.onLine || /fetch|network/i.test(msg)
  useCloud.setState({ status: offline ? 'offline' : 'error', error: msg, pending: engine?.pendingCount ?? 0 })
}

function wire() {
  teardown?.()
  let t: ReturnType<typeof setTimeout> | undefined
  const unsub = useStore.subscribe(() => {
    engine?.noteLocalChange()
    clearTimeout(t)
    t = setTimeout(run, 1500)
  })
  const onFocus = () => run()
  const onVis = () => { if (document.visibilityState === 'visible') run() }
  window.addEventListener('focus', onFocus)
  window.addEventListener('online', onFocus)
  document.addEventListener('visibilitychange', onVis)
  const iv = setInterval(() => { if (document.visibilityState === 'visible') run() }, 60_000)
  teardown = () => { unsub(); clearTimeout(t); clearInterval(iv); window.removeEventListener('focus', onFocus); window.removeEventListener('online', onFocus); document.removeEventListener('visibilitychange', onVis) }
}

function stop() { teardown?.(); teardown = undefined; engine = undefined }
