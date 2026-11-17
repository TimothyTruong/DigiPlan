import { useMemo, type CSSProperties } from 'react'
import { Link } from 'wouter'
import { format } from 'date-fns'
import { Countdowns } from '../components/Countdowns'
import { EntryRow } from '../components/EntryRow'
import { openEditor } from '../components/ItemEditor'
import { PageShell } from '../components/PageShell'
import { Empty } from '../components/ui'
import { useAgenda } from '../lib/agenda'
import { addDaysISO, fromISO, greeting, todayISO, weekDays } from '../lib/dates'
import { useStore } from '../store/store'
import type { MealSlot } from '../store/types'

const MOODS = ['😣', '😕', '😐', '🙂', '😄']

export default function Today() {
  const t = todayISO()
  const name = useStore((s) => s.settings.name)
  const items = useStore((s) => s.items)
  const courses = useStore((s) => s.courses)
  const entries = useAgenda(t, addDaysISO(t, 7))
  const today = entries.filter((e) => e.date === t)
  const schedule = today.filter((e) => e.kind !== 'task' && e.kind !== 'assignment')
  const dueToday = today.filter((e) => e.kind === 'task' || e.kind === 'assignment')
  const upcoming = entries.filter((e) => e.date > t && e.kind === 'assignment' && !e.done).slice(0, 5)
  const overdue = useMemo(() => {
    const byId = new Map(courses.map((c) => [c.id, c]))
    return items
      .filter((i) => !i.recurrence && !i.done && i.date < t && (i.kind === 'task' || i.kind === 'assignment'))
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((i) => ({ key: i.id, date: i.date, title: i.title, kind: i.kind, color: (i.courseId && byId.get(i.courseId)?.accent) || '#E8C872', done: false, item: i, course: i.courseId ? byId.get(i.courseId) : undefined, start: i.start }))
  }, [items, courses, t])

  return (
    <PageShell section="today" title={`${greeting()}${name ? `, ${name}` : ''}`} subtitle={format(new Date(), 'EEEE, MMMM d')}
      actions={<button className="btn primary" onClick={() => openEditor({ date: t })}>+ Add</button>}>
      <div className="grid dash">
        <div className="stack" style={{ gap: 16 }}>
          <section className="card">
            <div className="card-head"><h3>⏳ Countdowns</h3><Link href="/tasks?f=exam" className="small">All exams</Link></div>
            <Countdowns limit={6} />
          </section>

          <section className="card">
            <div className="card-head"><h3>🗓️ Today’s schedule</h3><Link href="/calendar" className="small">Calendar</Link></div>
            {schedule.length ? schedule.map((e) => <EntryRow key={e.key} e={e} />)
              : <Empty emoji="☁️">Nothing scheduled. A slow day — or a good one to get ahead.</Empty>}
          </section>

          <section className="card">
            <div className="card-head"><h3>✅ To do</h3><button className="btn sm ghost" onClick={() => openEditor({ kind: 'task', date: t })}>+ Task</button></div>
            {overdue.length > 0 && <>
              <div className="nav-label" style={{ paddingLeft: 10, color: 'var(--danger)' }}>Overdue · carried over</div>
              {overdue.map((e) => <EntryRow key={e.key} e={e} showDate={format(fromISO(e.date), 'MMM d')} />)}
              {dueToday.length > 0 && <div className="nav-label" style={{ paddingLeft: 10 }}>Today</div>}
            </>}
            {dueToday.map((e) => <EntryRow key={e.key} e={e} />)}
            {!overdue.length && !dueToday.length && <Empty emoji="🌷">All clear for today.</Empty>}
            {upcoming.length > 0 && <>
              <div className="nav-label" style={{ paddingLeft: 10 }}>Coming up</div>
              {upcoming.map((e) => <EntryRow key={e.key} e={e} showDate={format(fromISO(e.date), 'EEE d')} />)}
            </>}
          </section>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <WeekStrip />
          <HabitsToday />
          <MealsToday />
          <CheckIn />
        </div>
      </div>
    </PageShell>
  )
}

function WeekStrip() {
  const t = todayISO()
  const ws = useStore((s) => s.settings.weekStartsOn)
  const days = weekDays(t, ws)
  const entries = useAgenda(days[0], days[6])
  const counts = useMemo(() => { const m: Record<string, number> = {}; for (const e of entries) m[e.date] = (m[e.date] ?? 0) + 1; return m }, [entries])
  return (
    <section className="card" style={{ padding: 12 }}>
      <div className="row between">
        {days.map((d) => (
          <Link key={d} href={`/calendar?d=${d}`} style={{ textDecoration: 'none', color: 'inherit', textAlign: 'center', flex: 1, padding: '6px 0', borderRadius: 12, background: d === t ? 'var(--accent-soft)' : undefined }}>
            <div className="tiny muted">{format(fromISO(d), 'EEEEE')}</div>
            <div style={{ fontWeight: 650 }}>{format(fromISO(d), 'd')}</div>
            <div className="row" style={{ justifyContent: 'center', gap: 2, height: 6 }}>
              {Array.from({ length: Math.min(3, counts[d] ?? 0) }, (_, i) => <span key={i} className="dot" style={{ width: 4, height: 4 }} />)}
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}

function HabitsToday() {
  const t = todayISO()
  const habits = useStore((s) => s.habits)
  const accent = useStore((s) => s.pages.habits.accent)
  const toggle = useStore((s) => s.toggleHabit)
  const active = habits.filter((h) => !h.archived)
  return (
    <section className="card" style={{ '--accent': accent } as CSSProperties}>
      <div className="card-head"><h3>🌿 Habits</h3><Link href="/habits" className="small">Open</Link></div>
      {active.length ? (
        <div className="row wrap">
          {active.map((h) => (
            <button key={h.id} className={`chip${h.log[t] ? '' : ' outline'}`} style={{ height: 32, fontSize: 13 }} aria-pressed={!!h.log[t]} onClick={() => toggle(h.id, t)}>
              {h.emoji} {h.name}{h.log[t] ? ' ✓' : ''}
            </button>
          ))}
        </div>
      ) : <Empty emoji="🌱"><Link href="/habits">Add a habit</Link></Empty>}
    </section>
  )
}

function MealsToday() {
  const t = todayISO()
  const day = useStore((s) => s.mealPlan[t])
  const recipes = useStore((s) => s.recipes)
  const accent = useStore((s) => s.pages.meals.accent)
  const slots: MealSlot[] = ['breakfast', 'lunch', 'dinner']
  return (
    <section className="card" style={{ '--accent': accent } as CSSProperties}>
      <div className="card-head"><h3>🥗 Meals</h3><Link href="/meals" className="small">Plan</Link></div>
      <div className="stack" style={{ gap: 6 }}>
        {slots.map((s) => {
          const e = day?.[s]
          const r = e?.recipeId ? recipes.find((x) => x.id === e.recipeId) : undefined
          return (
            <div key={s} className="row">
              <span className="small muted" style={{ width: 70, textTransform: 'capitalize' }}>{s}</span>
              <span className="grow ellipsis" style={{ fontWeight: 550, color: e ? undefined : 'var(--faint)' }}>{r ? `${r.emoji} ${r.name}` : e?.text ?? '—'}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function CheckIn() {
  const t = todayISO()
  const w = useStore((s) => s.wellness[t])
  const set = useStore((s) => s.setWellness)
  const accent = useStore((s) => s.pages.habits.accent)
  return (
    <section className="card" style={{ '--accent': accent } as CSSProperties}>
      <div className="card-head"><h3>💭 Check in</h3><Link href="/habits" className="small">Trends</Link></div>
      <div className="scale" role="radiogroup" aria-label="Mood">
        {MOODS.map((m, i) => <button key={m} role="radio" aria-checked={w?.mood === i + 1} className={w?.mood === i + 1 ? 'on' : ''} onClick={() => set(t, { mood: i + 1 })}>{m}</button>)}
      </div>
      <div className="row" style={{ marginTop: 12, gap: 16 }}>
        <label className="row small grow">💧 <input type="number" min={0} max={20} className="input" style={{ width: 64 }} value={w?.water ?? ''} placeholder="0" onChange={(e) => set(t, { water: e.target.value === '' ? undefined : Number(e.target.value) })} /> glasses</label>
        <label className="row small grow">😴 <input type="number" min={0} max={16} step={0.5} className="input" style={{ width: 64 }} value={w?.sleep ?? ''} placeholder="0" onChange={(e) => set(t, { sleep: e.target.value === '' ? undefined : Number(e.target.value) })} /> hrs</label>
      </div>
    </section>
  )
}
