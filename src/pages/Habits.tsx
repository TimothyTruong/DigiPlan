import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { PageShell } from '../components/PageShell'
import { Empty, Modal } from '../components/ui'
import { HealthSyncButton } from '../components/Health'
import { addDaysISO, fromISO, todayISO, weekDays } from '../lib/dates'
import { uid } from '../lib/id'
import { useStore } from '../store/store'
import type { Habit, HealthMetric } from '../store/types'
import { EMOJI_PRESETS } from '../theme/themes'

const MOODS = ['😣', '😕', '😐', '🙂', '😄']
const MOOD_NAMES = ['very low', 'low', 'okay', 'good', 'great']
const ENERGY = ['🪫', '😮‍💨', '🙂', '⚡', '🚀']

/** Consecutive weeks meeting the weekly target, counting the current week only once it's met. */
export function habitStreak(h: Habit, today: string, ws: 0 | 1): number {
  let start = weekDays(today, ws)[0]
  const count = (s: string) => Array.from({ length: 7 }, (_, i) => addDaysISO(s, i)).filter((d) => h.log[d]).length
  let n = count(start) >= h.perWeek ? 1 : 0
  start = addDaysISO(start, -7)
  while (count(start) >= h.perWeek) { n++; start = addDaysISO(start, -7) }
  return n
}

export default function Habits() {
  const t = todayISO()
  const ws = useStore((s) => s.settings.weekStartsOn)
  const habits = useStore((s) => s.habits)
  const toggle = useStore((s) => s.toggleHabit)
  const [anchor, setAnchor] = useState(t)
  const [editing, setEditing] = useState<Habit | null>(null)
  const days = weekDays(anchor, ws)
  const active = habits.filter((h) => !h.archived)

  return (
    <PageShell section="habits" actions={<button className="btn primary" onClick={() => setEditing({ id: uid(), name: '', emoji: '🌱', perWeek: 7, log: {} })}>+ Habit</button>}>
      <section className="card" style={{ marginBottom: 16 }}>
        <div className="cal-toolbar">
          <button className="btn icon" onClick={() => setAnchor(addDaysISO(anchor, -7))} aria-label="Previous week">‹</button>
          <button className="btn sm" onClick={() => setAnchor(t)}>This week</button>
          <button className="btn icon" onClick={() => setAnchor(addDaysISO(anchor, 7))} aria-label="Next week" disabled={days[6] >= t}>›</button>
          <div className="cal-title">{format(fromISO(days[0]), 'MMM d')} – {format(fromISO(days[6]), 'MMM d')}</div>
        </div>
        {!active.length ? <Empty emoji="🌱">Habits can be daily or a few times a week — a rest day never breaks your streak.</Empty> : (
          <div className="hgrid">
            <div className="hspacer" />
            {days.map((d) => <div key={d} className="tiny muted" style={{ textAlign: 'center' }}>{format(fromISO(d), 'EEEEE')}<br />{format(fromISO(d), 'd')}</div>)}
            <div className="hstat tiny muted">Week · streak</div>
            {active.map((h) => {
              const n = days.filter((d) => h.log[d]).length
              const s = habitStreak(h, t, ws)
              return [
                <button key={h.id} className="linkish row hname" style={{ all: 'unset', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center', minHeight: 36 }} onClick={() => setEditing(h)}>
                  <span style={{ fontSize: 18 }}>{h.emoji}</span>
                  <span className="ellipsis" style={{ fontWeight: 550 }}>{h.name}<span className="tiny muted" style={{ display: 'block', fontWeight: 400 }}>{h.perWeek === 7 ? 'daily' : `${h.perWeek}× a week`}</span></span>
                </button>,
                ...days.map((d) => (
                  <button key={h.id + d} className={`hcell${h.log[d] ? ' on' : ''}${d === t ? ' today' : ''}`} disabled={d > t}
                    aria-label={`${h.name} ${format(fromISO(d), 'EEE MMM d')}`} aria-pressed={!!h.log[d]} onClick={() => toggle(h.id, d)} style={d > t ? { opacity: .35, cursor: 'default' } : undefined}>✓</button>
                )),
                <div key={h.id + 's'} className="hstat small"><b style={{ color: n >= h.perWeek ? 'var(--accent-ink)' : undefined }}>{n}/{h.perWeek}</b> · {s > 0 ? `🔥 ${s}w` : '—'}</div>,
              ]
            })}
          </div>
        )}
      </section>
      <Wellbeing />
      {editing && <HabitEditor h={editing} onClose={() => setEditing(null)} />}
    </PageShell>
  )
}

function Wellbeing() {
  const t = todayISO()
  const wellness = useStore((s) => s.wellness)
  const set = useStore((s) => s.setWellness)
  const { stepGoal, sleepGoal } = useStore((s) => s.settings)
  const today = wellness[t] ?? {}
  const series = useMemo(() => Array.from({ length: 30 }, (_, i) => addDaysISO(t, i - 29)), [t])
  const prev = useMemo(() => Array.from({ length: 30 }, (_, i) => addDaysISO(t, i - 59)), [t])
  type K = 'mood' | 'energy' | 'sleep' | 'water' | 'steps'
  const metrics: { k: K; label: string; max: number; unit: string }[] = [
    { k: 'steps', label: 'Steps', max: Math.max(stepGoal * 1.5, 1), unit: '' }, { k: 'sleep', label: 'Sleep', max: Math.max(sleepGoal * 1.25, 1), unit: 'h' },
    { k: 'mood', label: 'Mood', max: 5, unit: '/5' }, { k: 'energy', label: 'Energy', max: 5, unit: '/5' },
    { k: 'water', label: 'Water', max: 10, unit: ' glasses' },
  ]
  const fmt = (k: K, v: number) => (k === 'steps' ? Math.round(v).toLocaleString() : v.toFixed(1))
  const avg = (days: string[], k: K) => {
    const v = days.map((d) => wellness[d]?.[k]).filter((x): x is number => x !== undefined)
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined
  }
  return (
    <div className="grid dash">
      <section className="card">
        <div className="card-head"><h3>Last 30 days</h3><span className="tiny muted">Missed days are gaps, not zeros</span></div>
        <div className="grid cols-2" style={{ gap: 20 }}>
          {metrics.map((m) => {
            const a = avg(series, m.k), p = avg(prev, m.k)
            const diff = a !== undefined && p !== undefined ? a - p : undefined
            return (
              <div key={m.k}>
                <div className="row between"><b>{m.label}</b><span className="small">{a !== undefined ? `${fmt(m.k, a)}${m.unit}` : '—'}{diff !== undefined && Math.abs(diff) >= (m.k === 'steps' ? 50 : 0.1) && <span className="muted"> {diff > 0 ? '↑' : '↓'}{fmt(m.k, Math.abs(diff))}</span>}</span></div>
                <div className="spark" style={{ marginTop: 8 }} aria-label={`${m.label} last 30 days`}>
                  {series.map((d) => { const v = wellness[d]?.[m.k]; return <i key={d} className={v === undefined ? 'gap' : ''} title={`${format(fromISO(d), 'MMM d')}: ${v ?? '—'}`} style={v !== undefined ? { height: `${Math.max(6, (Math.min(v, m.max) / m.max) * 100)}%` } : undefined} /> })}
                </div>
              </div>
            )
          })}
        </div>
      </section>
      <section className="card stack" style={{ gap: 14 }}>
        <div className="row between"><h3>Today</h3>{today.fromHealth?.length ? <span className="chip outline">Apple Health</span> : <HealthSyncButton className="btn sm ghost" />}</div>
        <label className="field"><span>Steps</span><input type="number" min={0} inputMode="numeric" className="input" placeholder="Synced from Health, or type it" value={today.steps ?? ''} onChange={(e) => set(t, { steps: e.target.value === '' ? undefined : Math.round(Number(e.target.value)) })} /></label>
        <div className="field"><span>Mood</span><div className="scale">{MOODS.map((e, i) => <button key={e} aria-label={`Mood ${MOOD_NAMES[i]}`} className={today.mood === i + 1 ? 'on' : ''} aria-pressed={today.mood === i + 1} onClick={() => set(t, { mood: i + 1 })}>{e}</button>)}</div></div>
        <div className="field"><span>Energy</span><div className="scale">{ENERGY.map((e, i) => <button key={e} aria-label={`Energy ${MOOD_NAMES[i]}`} className={today.energy === i + 1 ? 'on' : ''} aria-pressed={today.energy === i + 1} onClick={() => set(t, { energy: i + 1 })}>{e}</button>)}</div></div>
        <div className="grid cols-2">
          <label className="field"><span>Sleep (hrs)</span><input type="number" step={0.5} min={0} max={16} className="input" value={today.sleep ?? ''} onChange={(e) => set(t, { sleep: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
          <div className="field"><span>Water</span>
            <div className="row"><button className="btn icon" aria-label="Less water" onClick={() => set(t, { water: Math.max(0, (today.water ?? 0) - 1) })}>−</button><b style={{ minWidth: 24, textAlign: 'center' }}>{today.water ?? 0}</b><button className="btn icon" aria-label="More water" onClick={() => set(t, { water: (today.water ?? 0) + 1 })}>+</button></div>
          </div>
        </div>
      </section>
    </div>
  )
}

function HabitEditor({ h: init, onClose }: { h: Habit; onClose: () => void }) {
  const exists = useStore((s) => s.habits.some((x) => x.id === init.id))
  const { upsertHabit, deleteHabit } = useStore.getState()
  const [h, setH] = useState(init)
  return (
    <Modal open onClose={onClose} title={exists ? 'Edit habit' : 'New habit'} footer={<>
      <div className="row">{exists && <><button className="btn ghost danger" onClick={() => { deleteHabit(h.id); onClose() }}>Delete</button><button className="btn ghost" onClick={() => { upsertHabit({ ...h, archived: true }); onClose() }}>Archive</button></>}</div>
      <div className="row"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!h.name.trim()} onClick={() => { upsertHabit({ ...h, name: h.name.trim() }); onClose() }}>Save</button></div>
    </>}>
      <div className="stack" style={{ gap: 14 }}>
        <input className="input" autoFocus placeholder="e.g. Stretch, Journal, No phone after 11" value={h.name} onChange={(e) => setH({ ...h, name: e.target.value })} />
        <div className="field"><span>Tick automatically</span>
          <div className="row wrap">
            <select className="select" style={{ width: 'auto' }} value={h.auto?.metric ?? ''} aria-label="Health metric"
              onChange={(e) => setH({ ...h, auto: e.target.value ? { metric: e.target.value as HealthMetric, min: h.auto?.min ?? (e.target.value === 'steps' ? 8000 : 8) } : undefined })}>
              <option value="">Off — I tick it myself</option><option value="steps">When steps reach…</option><option value="sleep">When sleep reaches…</option><option value="water">When water reaches…</option>
            </select>
            {h.auto && <><input type="number" min={0} className="input" style={{ width: 110 }} value={h.auto.min} aria-label="Target" onChange={(e) => setH({ ...h, auto: { ...h.auto!, min: Number(e.target.value) || 0 } })} />
              <span className="small muted">{h.auto.metric === 'steps' ? 'steps' : h.auto.metric === 'sleep' ? 'hours' : 'glasses'}</span></>}
          </div>
          {h.auto?.metric && h.auto.metric !== 'water' && <span className="tiny muted" style={{ fontWeight: 400 }}>Uses data synced from Apple Health (or typed on the Habits page).</span>}
        </div>
        <div className="field"><span>How often</span>
          <div className="row wrap">{[1, 2, 3, 4, 5, 6, 7].map((n) => <button key={n} className={`chip${h.perWeek === n ? '' : ' outline'}`} onClick={() => setH({ ...h, perWeek: n })}>{n === 7 ? 'Daily' : `${n}×/wk`}</button>)}</div>
        </div>
        <div className="field"><span>Icon</span><div className="emoji-grid">{EMOJI_PRESETS.map((e) => <button key={e} aria-label={`Icon ${e}`} aria-pressed={h.emoji === e} className={h.emoji === e ? 'on' : ''} onClick={() => setH({ ...h, emoji: e })}>{e}</button>)}</div></div>
      </div>
    </Modal>
  )
}
