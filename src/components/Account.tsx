import { useState } from 'react'
import { Link } from 'wouter'
import { formatDistanceToNow } from 'date-fns'
import { cloudConfigured } from '../lib/cloud/client'
import { confirmMassDelete, resolveChoice, signInWithEmail, signInWithGoogle, signOut, syncNow, useCloud } from '../lib/cloud/cloud'
import { Modal, toast } from './ui'

const GoogleG = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
)

export function Avatar({ size = 28 }: { size?: number }) {
  const user = useCloud((s) => s.user)
  const [broken, setBroken] = useState(false)
  if (!user) return null
  const initial = (user.name || user.email || '?').trim()[0]?.toUpperCase()
  return user.avatar && !broken
    ? <img src={user.avatar} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBroken(true)} style={{ borderRadius: '50%', width: size, height: size, objectFit: 'cover' }} />
    : <span style={{ width: size, height: size, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent-ink)', fontWeight: 700, fontSize: size * 0.45 }}>{initial}</span>
}

export function statusText(s: ReturnType<typeof useCloud.getState>): string {
  switch (s.status) {
    case 'syncing': case 'starting': return 'Syncing…'
    case 'synced': return s.lastSyncedAt ? `Synced ${formatDistanceToNow(s.lastSyncedAt, { addSuffix: true })}` : 'Synced'
    case 'offline': return `Offline${s.pending ? ` · ${s.pending} change${s.pending > 1 ? 's' : ''} waiting` : ''} — will sync when you’re back online`
    case 'error': return `Sync problem: ${s.error ?? 'unknown error'}`
    case 'needs-choice': return 'Waiting for you to choose how to combine data'
    case 'confirm-delete': return 'Waiting for you to confirm a large delete'
    default: return ''
  }
}

function SignInForm() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  async function google() {
    setBusy(true)
    try { await signInWithGoogle() } catch (e: any) { toast(e.message); setBusy(false) } // success navigates away
  }
  async function magic() {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { toast('Enter a valid email'); return }
    setBusy(true)
    try { await signInWithEmail(email); setSent(true) } catch (e: any) { toast(e.message) } finally { setBusy(false) }
  }
  if (sent) return <div className="stat" style={{ background: 'var(--accent-soft)' }}><b>Check your inbox ✉️</b><div className="small muted">We sent a sign-in link to {email}. Open it on this device. No password needed.</div><button className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => setSent(false)}>Use a different email</button></div>
  return (
    <div className="stack" style={{ gap: 10, maxWidth: 420 }}>
      <button className="btn" style={{ height: 44, gap: 10, fontWeight: 600 }} onClick={google} disabled={busy}><GoogleG /> Continue with Google</button>
      <div className="row small muted" style={{ gap: 8 }}><span className="grow" style={{ height: 1, background: 'var(--border)' }} />or<span className="grow" style={{ height: 1, background: 'var(--border)' }} /></div>
      <div className="row">
        <input className="input" type="email" inputMode="email" autoComplete="email" placeholder="you@school.edu" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && magic()} aria-label="Email" />
        <button className="btn primary" onClick={magic} disabled={busy || !email.trim()}>Email me a link</button>
      </div>
    </div>
  )
}

export function AccountSection() {
  const cloud = useCloud()
  const [confirmOut, setConfirmOut] = useState(false)
  const [keepLocal, setKeepLocal] = useState(false)
  if (!cloudConfigured) {
    return (
      <section className="card stack" style={{ gap: 8 }} id="account">
        <h2>Account & sync</h2>
        <div className="small muted">Accounts aren’t switched on for this copy of the app yet. Everything is saved on this device only. (Developer: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY — see supabase/README.md.)</div>
      </section>
    )
  }
  return (
    <section className="card stack" style={{ gap: 12 }} id="account">
      <div><h2>Account & sync</h2><div className="small muted">Sign in to keep your planner in sync across your iPhone, iPad and laptop. Without an account, everything stays on this device.</div></div>
      {!cloud.user ? (cloud.status === 'starting' ? <div className="small muted">Checking your session…</div> : <SignInForm />) : (
        <>
          <div className="row" style={{ gap: 12 }}>
            <Avatar size={44} />
            <div className="grow">
              <b>{cloud.user.name ?? cloud.user.email}</b>
              <div className="small muted">{cloud.user.email}{cloud.user.provider ? ` · ${cloud.user.provider === 'google' ? 'Google' : 'Email link'}` : ''}</div>
            </div>
          </div>
          <div className="row wrap">
            <span className="small" style={{ color: cloud.status === 'error' ? 'var(--danger)' : 'var(--muted)' }}>{statusText(cloud)}</span>
            <span className="grow" />
            <button className="btn sm" onClick={() => syncNow()} disabled={cloud.status === 'syncing'}>Sync now</button>
            <button className="btn sm ghost" onClick={() => setConfirmOut(true)}>Sign out</button>
          </div>
          <div className="tiny muted">Uploaded files and photos stay on this device for now; everything else syncs.</div>
        </>
      )}
      {confirmOut && (
        <Modal open onClose={() => setConfirmOut(false)} title="Sign out?" footer={<><span /><div className="row"><button className="btn" onClick={() => setConfirmOut(false)}>Cancel</button><button className="btn primary" onClick={async () => { setConfirmOut(false); await signOut({ keepLocal }); toast(keepLocal ? 'Signed out · planner kept on this device' : 'Signed out · planner removed from this device') }}>Sign out</button></div></>}>
          <div className="stack">
            <div className="small">Your planner stays safe in your account.</div>
            <label className="row small"><input type="checkbox" className="check" checked={keepLocal} onChange={(e) => setKeepLocal(e.target.checked)} /> Keep a copy on this device (don’t tick this on a shared or lab computer)</label>
          </div>
        </Modal>
      )}
    </section>
  )
}

/** Global dialogs the sync engine can raise. */
export function CloudDialogs() {
  const { status, choice, massDelete } = useCloud()
  if (status === 'needs-choice' && choice) {
    const remoteHas = choice.remoteCount > 0
    return (
      <Modal open onClose={() => {}} title={remoteHas ? 'Combine with your account?' : 'Bring this planner into your account?'}>
        <div className="stack" style={{ gap: 12 }}>
          {remoteHas ? <>
            <div className="small">Your account already has a planner, and this device has its own{choice.localIsDemo ? ' (including sample data)' : ''}.</div>
            <button className="btn primary" style={{ height: 'auto', padding: '10px 14px', justifyContent: 'flex-start', textAlign: 'left', whiteSpace: 'normal' }} onClick={() => resolveChoice('adopt')}><span><b>Use my account’s planner</b><br /><span className="small" style={{ fontWeight: 400 }}>Replace what’s on this device.</span></span></button>
            <button className="btn" style={{ height: 'auto', padding: '10px 14px', justifyContent: 'flex-start', textAlign: 'left', whiteSpace: 'normal' }} onClick={() => resolveChoice('merge')}><span><b>Merge both</b><br /><span className="small muted" style={{ fontWeight: 400 }}>Keep everything; where the same thing exists twice, the account’s version wins.</span></span></button>
          </> : <>
            <div className="small">This device has {choice.localIsDemo ? 'the built-in sample planner' : 'a planner'} and your account is empty.</div>
            <button className="btn primary" style={{ height: 'auto', padding: '10px 14px', justifyContent: 'flex-start', textAlign: 'left', whiteSpace: 'normal' }} onClick={() => resolveChoice('upload')}><span><b>Upload what’s here</b><br /><span className="small" style={{ fontWeight: 400 }}>{choice.localIsDemo ? 'Keep the sample data as a starting point.' : 'Your account starts with this planner.'}</span></span></button>
            <button className="btn" style={{ height: 'auto', padding: '10px 14px', justifyContent: 'flex-start', textAlign: 'left', whiteSpace: 'normal' }} onClick={() => resolveChoice('fresh')}><span><b>Start empty</b><br /><span className="small muted" style={{ fontWeight: 400 }}>Clear this device and begin with a blank planner.</span></span></button>
          </>}
        </div>
      </Modal>
    )
  }
  if (status === 'confirm-delete' && massDelete) {
    return (
      <Modal open onClose={() => {}} title="Delete from your account?" footer={<><button className="btn danger" onClick={() => confirmMassDelete(true)}>Yes, delete {massDelete}</button><button className="btn primary" onClick={() => confirmMassDelete(false)}>Restore from account</button></>}>
        <div className="small">This device is about to remove <b>{massDelete}</b> things from your account on every device. If you didn’t mean to (for example the browser’s data was cleared), restore from your account instead.</div>
      </Modal>
    )
  }
  return null
}

/** Small account row for the sidebar footer. */
export function SidebarAccount() {
  const cloud = useCloud()
  if (cloud.status === 'off') return null
  const dot = cloud.status === 'synced' ? '#7CC48B' : cloud.status === 'error' ? 'var(--danger)' : cloud.status === 'offline' ? '#E8C872' : 'var(--faint)'
  return (
    <Link href="/settings#account" className="nav-link side-account" title={cloud.user ? statusText(cloud) : 'Sign in to sync'} aria-label={cloud.user ? `Account: ${statusText(cloud)}` : 'Sign in to sync'}>
      {cloud.user
        ? <><span className="nav-icon" style={{ position: 'relative', background: 'none' }}><Avatar size={26} /><span style={{ position: 'absolute', right: -1, bottom: -1, width: 9, height: 9, borderRadius: '50%', background: dot, border: '2px solid var(--surface-2)' }} /></span><span className="ellipsis">{cloud.user.name?.split(' ')[0] ?? cloud.user.email}</span></>
        : <><span className="nav-icon">👤</span>Sign in</>}
    </Link>
  )
}
