import { useState, type CSSProperties } from 'react'
import { PageShell } from '../components/PageShell'
import { StylePicker } from '../components/StylePicker'
import { IconView, Seg, toast } from '../components/ui'
import { HealthSyncButton, importHealthText } from '../components/Health'
import { clearGoogleCache, connectGoogle, disconnectGoogle, isConnected, listCalendars, useGoogle } from '../lib/google'
import { icsToItems, parseIcs } from '../lib/ics'
import { uid } from '../lib/id'
import { exportData, useStore, type State } from '../store/store'
import type { SectionId } from '../store/types'
import { ACCENTS, SECTIONS } from '../theme/themes'

const ENV_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

export default function Settings() {
  const settings = useStore((s) => s.settings)
  const pages = useStore((s) => s.pages)
  const { setSettings, setPage, replaceAll, clearAll, addItems } = useStore.getState()
  const [picker, setPicker] = useState<SectionId | null>(null)

  async function importIcs(f?: File) {
    if (!f) return
    try {
      const seen = new Set(useStore.getState().items.map((i) => i.sourceUid).filter(Boolean))
      const parsed = icsToItems(parseIcs(await f.text()), uid)
      const items = parsed.filter((i) => !i.sourceUid || !seen.has(i.sourceUid))
      if (!parsed.length) { toast('No events found in that file'); return }
      if (!items.length) { toast('Everything in that file is already imported'); return }
      addItems(items)
      toast(`Imported ${items.length} events (${items.filter((i) => i.kind === 'class').length} classes, ${items.filter((i) => i.kind === 'exam').length} exams)`)
    } catch { toast('Couldn’t read that .ics file') }
  }
  function download() {
    const blob = new Blob([JSON.stringify(exportData(), null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `planner-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  async function restore(f?: File) {
    if (!f) return
    try {
      const data = JSON.parse(await f.text()) as Partial<State>
      if (!Array.isArray(data.items)) throw new Error()
      if (!confirm('Replace everything in this planner with the backup?')) return
      replaceAll(data)
      toast('Backup restored')
    } catch { toast('That file isn’t a planner backup') }
  }

  return (
    <PageShell section="settings">
      <div className="stack" style={{ gap: 16, maxWidth: 820 }}>
        <section className="card stack" style={{ gap: 14 }}>
          <h2>You</h2>
          <div className="grid cols-3">
            <label className="field"><span>Your name</span><input className="input" placeholder="For the greeting" value={settings.name} onChange={(e) => setSettings({ name: e.target.value })} /></label>
            <label className="field"><span>Week starts on</span>
              <select className="select" value={settings.weekStartsOn} onChange={(e) => setSettings({ weekStartsOn: Number(e.target.value) as 0 | 1 })}><option value={1}>Monday</option><option value={0}>Sunday</option></select></label>
            <label className="field"><span>Currency symbol</span><input className="input" maxLength={3} value={settings.currency} onChange={(e) => setSettings({ currency: e.target.value })} /></label>
          </div>
          <div className="field"><span>Appearance</span>
            <Seg value={settings.colorMode} onChange={(colorMode) => setSettings({ colorMode })} options={[{ value: 'system', label: 'System' }, { value: 'light', label: '☀️ Light' }, { value: 'dark', label: '🌙 Dark' }]} />
          </div>
        </section>

        <section className="card stack" style={{ gap: 12 }}>
          <div><h2>Page themes</h2><div className="small muted">Every page has its own colour, cover and icon. Pick a preset or upload your own.</div></div>
          <div className="row wrap">
            <span className="small muted">Apply one colour everywhere:</span>
            {ACCENTS.map((a) => <button key={a.key} className="swatch" style={{ background: a.hex, width: 24, height: 24 }} aria-label={`All pages ${a.name}`} onClick={() => SECTIONS.forEach((s) => setPage(s.id, { accent: a.hex }))} />)}
            <button className="btn sm ghost" onClick={() => SECTIONS.forEach((s) => setPage(s.id, { ...s.style }))}>Reset to pastel mix</button>
          </div>
          {SECTIONS.map((s) => (
            <div key={s.id} className="lrow" style={{ '--accent': pages[s.id].accent } as CSSProperties}>
              <span className="nav-icon" style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', overflow: 'hidden' }}><IconView icon={pages[s.id].icon} /></span>
              <span className="grow lrow-title">{s.label}</span>
              <div className="swatches inline-swatches" style={{ gap: 4 }}>
                {ACCENTS.slice(0, 9).map((a) => <button key={a.key} className={`swatch${pages[s.id].accent === a.hex ? ' on' : ''}`} style={{ background: a.hex, width: 20, height: 20 }} aria-label={`${s.label} ${a.name}`} onClick={() => setPage(s.id, { accent: a.hex })} />)}
              </div>
              <button className="btn sm" onClick={() => setPicker(s.id)}>Customize</button>
            </div>
          ))}
        </section>

        <GoogleSection />

        <HealthSection />

        <section className="card stack" style={{ gap: 10 }}>
          <h2>Import a timetable</h2>
          <div className="small muted">Most university portals export your schedule as an <b>.ics</b> file. Drop it here: lectures become repeating classes, and anything that says “exam” or “midterm” gets a countdown.</div>
          <label className="drop">Choose .ics file<input type="file" accept=".ics,text/calendar" className="sr-only" onChange={(e) => { importIcs(e.target.files?.[0]); e.target.value = '' }} /></label>
        </section>

        <section className="card stack" style={{ gap: 10 }}>
          <h2>Your data</h2>
          <div className="small muted">Everything is stored privately in this browser — no account, nothing sent anywhere (except to Google, if you connect it). Back up regularly; clearing browser data erases it. Uploaded files and images aren’t included in the backup yet.</div>
          <div className="row wrap">
            <button className="btn" onClick={download}>Download backup</button>
            <label className="btn">Restore backup<input type="file" accept="application/json" className="sr-only" onChange={(e) => { restore(e.target.files?.[0]); e.target.value = '' }} /></label>
            <button className="btn danger" onClick={() => { if (confirm('Remove all classes, items, recipes, workouts, habits and money entries? Themes are kept.')) { clearAll(); toast('Cleared — fresh start') } }}>Clear all / remove demo data</button>
          </div>
        </section>
      </div>
      {picker && <StylePicker open onClose={() => setPicker(null)} value={pages[picker]} onChange={(v) => setPage(picker, v)} title={`Customize ${SECTIONS.find((s) => s.id === picker)!.label}`} />}
    </PageShell>
  )
}

function GoogleSection() {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const token = useGoogle((s) => s.token)
  const err = useGoogle((s) => s.error)
  const [clientId, setClientId] = useState(settings.googleClientId ?? '')
  const [busy, setBusy] = useState(false)
  const effectiveId = ENV_CLIENT_ID || settings.googleClientId

  async function connect() {
    const id = ENV_CLIENT_ID || clientId.trim()
    if (!id) { toast('Add a Google OAuth client ID first'); return }
    setBusy(true)
    try {
      if (!ENV_CLIENT_ID) setSettings({ googleClientId: id })
      await connectGoogle(id)
      const cals = await listCalendars()
      const prev = new Map(settings.googleCalendars.map((c) => [c.id, c.enabled]))
      // New calendars default to on only for the primary one (calendarList order isn't guaranteed).
      setSettings({ googleCalendars: cals.map((c) => ({ id: c.id, summary: c.summary, color: c.color, enabled: prev.get(c.id) ?? c.primary })) })
      clearGoogleCache()
      toast('Google Calendar connected')
    } catch (e: any) { toast(e.message) } finally { setBusy(false) }
  }

  return (
    <section className="card stack" style={{ gap: 12 }}>
      <div className="row between wrap">
        <div><h2>Google Calendar</h2><div className="small muted">See your Google events alongside your planner, and push exams and deadlines back to Google.</div></div>
        {token && isConnected()
          ? <button className="btn" onClick={() => { disconnectGoogle(); toast('Disconnected') }}>Disconnect</button>
          : <button className="btn primary" onClick={connect} disabled={busy}>{busy ? 'Connecting…' : settings.googleCalendars.length ? 'Reconnect' : 'Connect Google'}</button>}
      </div>
      {!ENV_CLIENT_ID && (
        <details open={!effectiveId}>
          <summary className="small" style={{ cursor: 'pointer' }}>Developer setup: OAuth client ID</summary>
          <div className="stack" style={{ gap: 6, marginTop: 8 }}>
            <div className="tiny muted">Create a Web OAuth client in Google Cloud Console, enable the Calendar API, and add this site’s URL to Authorized JavaScript origins. Or set VITE_GOOGLE_CLIENT_ID at build time.</div>
            <input className="input" placeholder="xxxxxxxx.apps.googleusercontent.com" value={clientId} onChange={(e) => setClientId(e.target.value)} />
          </div>
        </details>
      )}
      {err && <div className="small" style={{ color: 'var(--danger)' }}>{err}</div>}
      {settings.googleCalendars.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <label className="row small"><input type="checkbox" className="check" checked={settings.showGoogle} onChange={(e) => setSettings({ showGoogle: e.target.checked })} /> Show Google events in my planner</label>
          <div className="nav-label" style={{ padding: '8px 0 2px' }}>Calendars</div>
          {settings.googleCalendars.map((c) => (
            <label key={c.id} className="row small"><input type="checkbox" className="check" checked={c.enabled}
              onChange={(e) => {
                setSettings({ googleCalendars: settings.googleCalendars.map((x) => (x.id === c.id ? { ...x, enabled: e.target.checked } : x)) })
                clearGoogleCache() // calendar set changed: drop cached ranges (and in-flight results)
              }} />
              <span className="dot" style={{ background: c.color }} />{c.summary}</label>
          ))}
          {!token && <div className="tiny muted">Google sessions last about an hour in this browser-only version — press Reconnect to refresh.</div>}
        </div>
      )}
    </section>
  )
}

function HealthSection() {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const link = `${location.origin}${import.meta.env.BASE_URL}#health=`
  const sample = JSON.stringify({ days: [{ date: new Date().toISOString().slice(0, 10), steps: 8432, sleep: 7.4 }] })
  return (
    <section className="card stack" style={{ gap: 12 }}>
      <div className="row between wrap">
        <div><h2>Apple Health</h2><div className="small muted">Bring in steps and sleep each day. They show on Today, Fitness and Habits, and can tick habits for you.</div></div>
        <HealthSyncButton className="btn primary" />
      </div>
      <div className="grid cols-2">
        <label className="field"><span>Daily step goal</span><input type="number" min={0} step={500} className="input" value={settings.stepGoal} onChange={(e) => setSettings({ stepGoal: Math.max(0, Number(e.target.value) || 0) })} /></label>
        <label className="field"><span>Sleep goal (hours)</span><input type="number" min={0} max={14} step={0.5} className="input" value={settings.sleepGoal} onChange={(e) => setSettings({ sleepGoal: Math.max(0, Number(e.target.value) || 0) })} /></label>
      </div>
      <details>
        <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>Set up the iPhone shortcut (one time, ~3 minutes)</summary>
        <div className="md small" style={{ marginTop: 8 }}>
          <p className="muted">Websites can’t read Apple Health directly, so a Shortcut on your iPhone reads it and hands it to {''}this planner. Nothing leaves your phone except into this browser.</p>
          <ol>
            <li>Open <b>Shortcuts</b> → <b>+</b> → name it <b>Petal Health</b>.</li>
            <li><b>Find Health Samples</b> — Type: <b>Steps</b>, Start Date: <b>is today</b>. Then <b>Calculate Statistics</b> → <b>Sum</b>. Rename the result <code>Steps</code>.</li>
            <li><b>Find Health Samples</b> — Type: <b>Sleep Analysis</b>, Start Date: <b>is in the last 1 day</b>, Value: <b>is not In Bed</b> and <b>is not Awake</b>. Then <b>Get Details of Health Samples</b> → <b>Duration</b>, then <b>Calculate Statistics</b> → <b>Sum</b>. Rename it <code>Sleep</code>. (Hours or minutes both work.)</li>
            <li><b>Format Date</b> — Current Date, Custom format <code>yyyy-MM-dd</code>.</li>
            <li><b>Text</b>: <code>{'{"days":[{"date":"'}<i>Formatted Date</i>{'","steps":'}<i>Steps</i>{',"sleep":'}<i>Sleep</i>{'}]}'}</code></li>
            <li>Finish with <b>one</b> of:
              <ul>
                <li><b>Copy to Clipboard</b> — then tap <b>❤️ Sync from Health</b> here. Use this if you added the planner to your Home Screen.</li>
                <li><b>URL Encode</b> the text, then <b>Open URLs</b>: <code>{link}</code><i>URL Encoded Text</i> — fully automatic, but only updates the planner in <b>Safari</b> (Home Screen apps keep separate storage on iOS).</li>
              </ul>
            </li>
            <li>Automation tab → <b>+</b> → <b>Time of Day</b> (e.g. 9:30pm, Daily) → <b>Run Immediately</b> → choose <b>Petal Health</b>.</li>
          </ol>
          <p className="muted">Sleep is stored on the day you wake up. Re-running the same day just updates it. Android/Google Fit isn’t supported: Google is shutting down the Fit web API and Health Connect has no web access.</p>
        </div>
      </details>
      <div className="row wrap"><button className="btn sm ghost" onClick={() => importHealthText(sample)}>Try it with sample data</button></div>
    </section>
  )
}
